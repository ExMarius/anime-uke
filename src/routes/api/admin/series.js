import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validateSeries, validateSeriesPatch, validatePositiveInt, SERIES_DETAIL_FIELDS } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { parsePaging, parseQuery, parseSort, sortSql, sortOptions, escapeLike, readMeta, bumpMetaStmt, counterStmts } from '../../../lib/paging.js';
import { DEFAULT_LIMIT_SERIES, resolveLimit, seriesFullMessage } from '../../../lib/limits.js';

// =====================================================================
// /api/admin/series — CRUD serii, doar pentru admini.
//
//   GET    lista cu cautare+paginare · sau ?id=N pentru o singura serie
//   POST   creare
//   PATCH  editare partiala (titlu, descriere, status, gen, an, coperta)
//   DELETE ?id=N stergere (cascade la episoade si surse)
//
// Lista e paginata pentru ca la 1000+ serii un `LIMIT 500` ar ascunde
// jumatate din catalog, iar un tabel cu toate randurile ar fi inutilizabil.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);

  try {
    // ?id=N -> detaliul unei singure serii, pentru pagina /admin/serie/<id>.
    // Un endpoint separat ar fi duplicat logica de autorizare.
    const idParam = url.searchParams.get('id');
    if (idParam) {
      const id = validatePositiveInt(idParam, 'ID-ul seriei');
      if (!id.ok) return errorResponse(400, id.error);

      const row = await env.DB
        .prepare(
          `SELECT s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year,
                  ${SERIES_DETAIL_FIELDS.map((f) => `s.${f}`).join(', ')},
                  s.episode_count, s.created_at, u.username AS created_by_name
           FROM anime_series s LEFT JOIN users u ON u.id = s.created_by
           WHERE s.id = ?`
        )
        .bind(id.value)
        .first();
      if (!row) return errorResponse(404, 'Seria nu există');

      const views = await env.DB
        .prepare('SELECT COALESCE(SUM(views), 0) AS total FROM episodes WHERE series_id = ?')
        .bind(id.value)
        .first();

      return json({ series: { ...row, total_views: views?.total ?? 0 } });
    }

    const { page, perPage, offset } = parsePaging(url);
    const q = parseQuery(url);
    const sort = parseSort(url, 'latest');

    const where = [];
    const params = [];
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push(`(s.title LIKE ? ESCAPE '\\' OR s.genre LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await env.DB
      .prepare(
        `SELECT s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year,
                s.episode_count, s.created_at, u.username AS created_by_name
         FROM anime_series s LEFT JOIN users u ON u.id = s.created_by
         ${whereSql}
         ORDER BY ${sortSql(sort)}
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage + 1, offset)
      .all();

    const rows = res.results || [];
    const hasMore = rows.length > perPage;

    let total;
    if (q) {
      const c = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM anime_series s ${whereSql}`)
        .bind(...params)
        .first();
      total = c?.n ?? 0;
    } else {
      total = await readMeta(env, 'series_total');
    }

    return json({
      series: hasMore ? rows.slice(0, perPage) : rows,
      page, per_page: perPage, has_more: hasMore, total,
      pages: Math.max(1, Math.ceil(total / perPage)),
      q, sort, sorts: sortOptions(),
    });
  } catch (e) {
    console.error('GET /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca seriile');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-series:${admin.id}`, 200, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const v = validateSeries(body);
  if (!v.ok) return errorResponse(400, v.error);

  try {
    // Plafonul catalogului: misiunea e buget 0, deci max LIMIT_SERIES serii.
    // COUNT pe un tabel de max ~1000 randuri costa putin si e invocat doar
    // la creare (operatiune rara, exclusiv admin).
    const maxSeries = resolveLimit(env, 'LIMIT_SERIES', DEFAULT_LIMIT_SERIES);
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM anime_series').first();
    if ((cnt?.n ?? 0) >= maxSeries) {
      return errorResponse(403, seriesFullMessage(maxSeries));
    }

    const res = await env.DB
      .prepare(
        `INSERT INTO anime_series (title, description, cover_image, status, genre, year, created_by, episode_count,
                                   alt_titles, themes, age_rating, ep_duration, release_date, country, external_url, team,
                                   next_ep_note, next_ep_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(v.value.title, v.value.description, v.value.cover_image, v.value.status, v.value.genre, v.value.year, admin.id,
        v.value.alt_titles, v.value.themes, v.value.age_rating, v.value.ep_duration, v.value.release_date,
        v.value.country, v.value.external_url, v.value.team, v.value.next_ep_note, v.value.next_ep_at)
      .run();

    const id = res.meta?.last_row_id;

    // Contorul de serii si logarea, in aceeasi tranzactie ca INSERT-ul.
    // D1 batch() e tranzactional: ori se aplica toate, ori niciuna — deci
    // contorul nu poate deriva fata de continutul real al tabelului.
    await env.DB.batch([
      bumpMetaStmt(env, 'series_total', 1),
      env.DB.prepare(
        `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
         VALUES (?, ?, 'create_series', 'series', ?, ?)`
      ).bind(admin.id, admin.username, id, `„${v.value.title}"`),
    ]);

    return json({ success: true, id, series: { id, episode_count: 0, ...v.value } }, { status: 201 });
  } catch (e) {
    console.error('POST /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut adăuga seria');
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-series:${admin.id}`, 200, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.id, 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare(`SELECT id, title, description, cover_image, status, genre, year, ${SERIES_DETAIL_FIELDS.join(', ')}
                FROM anime_series WHERE id = ?`)
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Seria nu există');

    const v = validateSeriesPatch(body, existing);
    if (!v.ok) return errorResponse(400, v.error);

    const fields = Object.keys(v.value);
    if (!fields.length) return json({ success: true, unchanged: true, series: existing });

    const sets = fields.map((f) => `${f} = ?`).join(', ');
    await env.DB.batch([
      env.DB.prepare(`UPDATE anime_series SET ${sets} WHERE id = ?`)
        .bind(...fields.map((f) => v.value[f]), id.value),
      env.DB.prepare(
        `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
         VALUES (?, ?, 'edit_series', 'series', ?, ?)`
      ).bind(admin.id, admin.username, id.value,
        `„${existing.title}" — modificat: ${fields.join(', ')}`),
    ]);

    return json({ success: true, series: { ...existing, ...v.value } });
  } catch (e) {
    console.error('PATCH /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut actualiza seria');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('id'), 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, title, episode_count FROM anime_series WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Seria nu există');

    // ON DELETE CASCADE sterge episoadele, iar cascade mai departe sterge
    // sursele si istoricul de vizionari. Totul intr-o singura tranzactie.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM anime_series WHERE id = ?').bind(id.value),
      ...counterStmts(env, { series: -1, episodes: -(existing.episode_count || 0) }),
      env.DB.prepare(
        `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
         VALUES (?, ?, 'delete_series', 'series', ?, ?)`
      ).bind(admin.id, admin.username, id.value,
        `„${existing.title}" + ${existing.episode_count} episoade`),
    ]);

    return json({ success: true, deleted_episodes: existing.episode_count });
  } catch (e) {
    console.error('DELETE /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge seria');
  }
}
