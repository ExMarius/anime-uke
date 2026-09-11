import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validateEpisode, validateEpisodePatch, validatePositiveInt } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { parsePaging, parseQuery, escapeLike, counterStmts } from '../../../lib/paging.js';

// =====================================================================
// /api/admin/episodes — CRUD episoade, doar pentru admini.
//
//   GET    ?series_id=N cu paginare+cautare · sau toate (paginat)
//   POST   creare: un episod, sau { bulk: [...] } pentru mai multe deodata
//   PATCH  editare partiala (titlu, numar, serie)
//   DELETE ?id=N stergere
//
// SURSELE
//   Un episod are 0..12 surse in episode_sources. POST le primeste ca lista;
//   sursele individuale se editeaza apoi prin /api/admin/episode-sources.
// =====================================================================

/** D1 batch() accepta maximum 100 de instructiuni; ramane sub limita. */
const BATCH_LIMIT = 90;
/** Cate episoade putem crea intr-o singura cerere de bulk. */
const MAX_BULK = 300;

// ---------------------------------------------------------------- GET

/**
 * Incarca sursele pentru o lista de episoade dintr-o singura interogare.
 *
 * Nu folosim JOIN: un JOIN ar multiplica randurile (un episod cu 4 surse ar
 * aparea de 4 ori) si, mai important, D1 taxeaza randurile CITITE — deci un
 * episod cu multe surse ar umfla consumul de cota gratuita.
 */
async function loadSourcesForEpisodes(env, episodeIds) {
  const map = new Map();
  if (!episodeIds.length) return map;

  const CHUNK = 80;
  for (let i = 0; i < episodeIds.length; i += CHUNK) {
    const slice = episodeIds.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const res = await env.DB
      .prepare(
        `SELECT id, episode_id, label, kind, url, sort_order, is_active
         FROM episode_sources
         WHERE episode_id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`
      )
      .bind(...slice)
      .all();

    for (const row of res.results || []) {
      const list = map.get(row.episode_id) || [];
      list.push({
        id: row.id, label: row.label, kind: row.kind, url: row.url,
        sort_order: row.sort_order, is_active: row.is_active,
      });
      map.set(row.episode_id, list);
    }
  }
  return map;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const { page, perPage, offset } = parsePaging(url, 50);
  const q = parseQuery(url);

  // ?id=N -> un singur episod, pentru panoul de surse.
  const idParam = url.searchParams.get('id');
  if (idParam) {
    const id = validatePositiveInt(idParam, 'ID-ul episodului');
    if (!id.ok) return errorResponse(400, id.error);
    try {
      const ep = await env.DB
        .prepare(
          `SELECT e.id, e.series_id, e.episode_number, e.title, e.views, e.created_at,
                  s.title AS series_title
           FROM episodes e JOIN anime_series s ON s.id = e.series_id
           WHERE e.id = ?`
        )
        .bind(id.value)
        .first();
      if (!ep) return errorResponse(404, 'Episodul nu există');
      const sourcesByEp = await loadSourcesForEpisodes(env, [ep.id]);
      return json({ episode: { ...ep, sources: sourcesByEp.get(ep.id) || [] } });
    } catch (e) {
      console.error('GET /api/admin/episodes?id esuat:', e?.message || e);
      return errorResponse(500, 'Nu am putut încărca episodul');
    }
  }

  const where = [];
  const params = [];
  const seriesIdParam = url.searchParams.get('series_id');

  if (seriesIdParam) {
    const sid = validatePositiveInt(seriesIdParam, 'ID-ul seriei');
    if (!sid.ok) return errorResponse(400, sid.error);
    where.push('e.series_id = ?');
    params.push(sid.value);
  }

  if (q) {
    // Cautam in titlul episodului, al seriei sau dupa numarul episodului.
    // Cast-ul la TEXT e necesar ca LIKE sa functioneze pe o coloana INTEGER.
    const like = `%${escapeLike(q)}%`;
    where.push(`(e.title LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\' OR CAST(e.episode_number AS TEXT) = ?)`);
    params.push(like, like, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const res = await env.DB
      .prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title, e.subtitle_url, e.views, e.created_at,
                s.title AS series_title
         FROM episodes e JOIN anime_series s ON s.id = e.series_id
         ${whereSql}
         ORDER BY ${seriesIdParam ? 'e.episode_number ASC' : 'e.id DESC'}
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage + 1, offset)
      .all();

    const rows = res.results || [];
    const hasMore = rows.length > perPage;
    const episodes = hasMore ? rows.slice(0, perPage) : rows;
    const sourcesByEp = await loadSourcesForEpisodes(env, episodes.map((e) => e.id));

    let total;
    if (q || seriesIdParam) {
      const c = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM episodes e JOIN anime_series s ON s.id = e.series_id ${whereSql}`)
        .bind(...params)
        .first();
      total = c?.n ?? 0;
    } else {
      total = null; // fara cautare, lista completa nu e numarata (ar costa un scan)
    }

    return json({
      episodes: episodes.map((e) => ({ ...e, sources: sourcesByEp.get(e.id) || [] })),
      page, per_page: perPage, has_more: hasMore, total, q,
    });
  } catch (e) {
    console.error('GET /api/admin/episodes esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca episoadele');
  }
}

// ---------------------------------------------------------------- POST

/** Statement-ele de INSERT pentru sursele unui episod. */
function sourceInserts(env, seriesId, episodeNumber, sources) {
  // Nu putem folosi last_row_id() in interiorul aceluiasi batch, deci
  // legam sursele prin (series_id, episode_number), care e UNIQUE. Asta ne
  // lasa sa cream episodul si sursele lui intr-o SINGURA tranzactie —
  // altfel un esec la jumatate ar lasa episoade fara surse.
  return sources.map((s, i) =>
    env.DB.prepare(
      `INSERT INTO episode_sources (episode_id, label, kind, url, sort_order, is_active)
       SELECT id, ?, ?, ?, ?, 1 FROM episodes WHERE series_id = ? AND episode_number = ?`
    ).bind(s.label, s.kind, s.url, s.sort_order ?? i, seriesId, episodeNumber)
  );
}

function bumpEpisodeCount(env, seriesId, delta) {
  return env.DB
    .prepare('UPDATE anime_series SET episode_count = MAX(0, episode_count + ?) WHERE id = ?')
    .bind(delta, seriesId);
}

async function createOne(context, admin, body) {
  const { env } = context;

  const v = validateEpisode(body);
  if (!v.ok) return errorResponse(400, v.error);

  const series = await env.DB
    .prepare('SELECT id, title FROM anime_series WHERE id = ?')
    .bind(v.value.series_id)
    .first();
  if (!series) return errorResponse(400, 'Seria selectată nu există');

  const stmts = [
    env.DB.prepare(
      `INSERT INTO episodes (series_id, episode_number, title, subtitle_url, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(v.value.series_id, v.value.episode_number, v.value.title, v.value.subtitle_url || '', admin.id),
    ...sourceInserts(env, v.value.series_id, v.value.episode_number, v.value.sources),
    bumpEpisodeCount(env, v.value.series_id, 1),
    ...counterStmts(env, { episodes: 1 }),
  ];

  const results = await env.DB.batch(stmts);
  const id = results[0]?.meta?.last_row_id;

  const srcSummary = v.value.sources.length ? v.value.sources.map((s) => s.label).join(', ') : 'fără sursă';
  await logAdminAction(env, admin, 'create_episode', 'episode', id,
    `Ep. ${v.value.episode_number} din „${series.title}" — surse: ${srcSummary}`);

  return json({ success: true, id, episode: { id, ...v.value } }, { status: 201 });
}

/**
 * POST in modul bulk: { series_id, episodes: [{episode_number,title,sources}, …] }
 *
 * Episoadele care exista deja sunt SARITE, nu respinse — la 100 de episoade
 * lipite dintr-o lista, unul duplicat nu trebuie sa anuleze tot lotul.
 */
async function createBulk(context, admin, body) {
  const { env } = context;

  const seriesId = validatePositiveInt(body.series_id, 'ID-ul seriei');
  if (!seriesId.ok) return errorResponse(400, seriesId.error);

  if (!Array.isArray(body.episodes) || !body.episodes.length) {
    return errorResponse(400, 'Lista de episoade e goală');
  }
  if (body.episodes.length > MAX_BULK) {
    return errorResponse(400, `Maximum ${MAX_BULK} de episoade într-o singură postare în bloc`);
  }

  const series = await env.DB
    .prepare('SELECT id, title FROM anime_series WHERE id = ?')
    .bind(seriesId.value)
    .first();
  if (!series) return errorResponse(400, 'Seria selectată nu există');

  // Validam TOT inainte sa scriem nimic: un lot cu o eroare la linia 47 nu
  // trebuie sa lase 46 de episoade create si apoi sa crape.
  const prepared = [];
  const errors = [];
  const seen = new Set();

  for (let i = 0; i < body.episodes.length; i++) {
    const item = body.episodes[i];
    const v = validateEpisode({ ...item, series_id: seriesId.value });
    if (!v.ok) { errors.push({ line: i + 1, error: v.error }); continue; }
    if (seen.has(v.value.episode_number)) {
      errors.push({ line: i + 1, error: `Episodul ${v.value.episode_number} apare de două ori în listă` });
      continue;
    }
    seen.add(v.value.episode_number);
    prepared.push({ line: i + 1, ...v.value });
  }

  // Sarim episoadele care exista deja in baza.
  let existingNumbers = new Set();
  if (prepared.length) {
    const nums = prepared.map((p) => p.episode_number);
    const CH = 80;
    for (let i = 0; i < nums.length; i += CH) {
      const slice = nums.slice(i, i + CH);
      const res = await env.DB
        .prepare(`SELECT episode_number FROM episodes WHERE series_id = ? AND episode_number IN (${slice.map(() => '?').join(',')})`)
        .bind(seriesId.value, ...slice)
        .all();
      for (const r of res.results || []) existingNumbers.add(r.episode_number);
    }
  }

  const skipped = prepared.filter((p) => existingNumbers.has(p.episode_number));
  const toCreate = prepared.filter((p) => !existingNumbers.has(p.episode_number));
  for (const s of skipped) errors.push({ line: s.line, error: `Episodul ${s.episode_number} există deja — a fost sărit` });

  // Scriem in transe ca sa respectam limita de instructiuni a batch-ului.
  let created = 0;
  let cursor = 0;
  while (cursor < toCreate.length) {
    const chunk = [];
    let stmtCount = 0;
    while (cursor < toCreate.length) {
      const cost = 2 + toCreate[cursor].sources.length; // insert episod + counter + surse
      if (stmtCount + cost > BATCH_LIMIT && chunk.length) break;
      chunk.push(toCreate[cursor]);
      stmtCount += cost;
      cursor++;
    }

    const stmts = [];
    for (const ep of chunk) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO episodes (series_id, episode_number, title, subtitle_url, created_by) VALUES (?, ?, ?, ?, ?)`
        ).bind(seriesId.value, ep.episode_number, ep.title, ep.subtitle_url || '', admin.id),
        ...sourceInserts(env, seriesId.value, ep.episode_number, ep.sources)
      );
    }
    stmts.push(bumpEpisodeCount(env, seriesId.value, chunk.length));
    stmts.push(...counterStmts(env, { episodes: chunk.length }));

    await env.DB.batch(stmts);
    created += chunk.length;
  }

  if (created) {
    await logAdminAction(env, admin, 'bulk_create_episodes', 'series', seriesId.value,
      `${created} episoade în „${series.title}"${skipped.length ? ` (${skipped.length} sărite)` : ''}`);
  }

  return json({
    success: true,
    created,
    skipped: skipped.length,
    errors,
    series_id: seriesId.value,
  }, { status: created ? 201 : 200 });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-ep:${admin.id}`, 400, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  try {
    if (Array.isArray(body.episodes)) return await createBulk(context, admin, body);
    return await createOne(context, admin, body);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) {
      return errorResponse(409, 'Episodul ăsta există deja pentru seria selectată');
    }
    console.error('POST /api/admin/episodes esuat:', msg);
    return errorResponse(500, 'Nu am putut adăuga episodul');
  }
}

// ---------------------------------------------------------------- PATCH

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-ep:${admin.id}`, 400, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.id, 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, series_id, episode_number, title FROM episodes WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Episodul nu există');

    const v = validateEpisodePatch(body, existing);
    if (!v.ok) return errorResponse(400, v.error);

    const fields = Object.keys(v.value);
    if (!fields.length) return json({ success: true, unchanged: true, episode: existing });

    const sets = fields.map((f) => `${f} = ?`).join(', ');
    const stmts = [
      env.DB.prepare(`UPDATE episodes SET ${sets} WHERE id = ?`)
        .bind(...fields.map((f) => v.value[f]), id.value),
    ];

    // Mutarea in alta serie trebuie sa mute si contoarele ambelor serii.
    if (v.value.series_id && v.value.series_id !== existing.series_id) {
      stmts.push(bumpEpisodeCount(env, existing.series_id, -1));
      stmts.push(bumpEpisodeCount(env, v.value.series_id, 1));
    }

    await env.DB.batch(stmts);
    await logAdminAction(env, admin, 'edit_episode', 'episode', id.value,
      `Ep. ${existing.episode_number} — modificat: ${fields.join(', ')}`);

    return json({ success: true, episode: { ...existing, ...v.value } });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) return errorResponse(409, 'Există deja un episod cu numărul ăsta în seria respectivă');
    console.error('PATCH /api/admin/episodes esuat:', msg);
    return errorResponse(500, 'Nu am putut actualiza episodul');
  }
}

// ---------------------------------------------------------------- DELETE

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('id'), 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const existing = await env.DB
      .prepare('SELECT id, series_id, episode_number, title FROM episodes WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Episodul nu există');

    // ON DELETE CASCADE sterge si sursele episodului.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(id.value),
      bumpEpisodeCount(env, existing.series_id, -1),
      ...counterStmts(env, { episodes: -1 }),
      env.DB.prepare(
        `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
         VALUES (?, ?, 'delete_episode', 'episode', ?, ?)`
      ).bind(admin.id, admin.username, id.value,
        `Ep. ${existing.episode_number} — ${existing.title || '(fără titlu)'}`),
    ]);

    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/episodes esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge episodul');
  }
}
