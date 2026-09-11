import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validateEpisode, validatePositiveInt } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// =====================================================================
// /api/admin/episodes — CRUD episoade, doar pentru admini.
// GET lista (optional ?series_id=N) · POST creare · DELETE ?id=N
//
// FLUXUL DIN SPEC: adminul alege seria din dropdown (populat cu seriile
// existente), apoi completeaza numar, titlu si una sau mai multe surse
// video. Sursele stau in episode_sources, nu pe randul episodului.
// =====================================================================

/**
 * Incarca sursele pentru o lista de episoade dintr-o singura interogare.
 *
 * De ce nu un JOIN in query-ul de episoade? Pentru ca un JOIN ar multiplica
 * randurile (un episod cu 4 surse ar aparea de 4 ori), iar apoi am deduplica
 * in JS oricum. Mai important: D1 taxeaza la randuri CITITE, deci un episod
 * cu multe surse ar umfla consumul de cota gratuita. O a doua interogare cu
 * `IN (...)` e mai ieftina si mai lizibila.
 *
 * @returns {Promise<Map<number, Array>>}
 */
async function loadSourcesForEpisodes(env, episodeIds) {
  const map = new Map();
  if (!episodeIds.length) return map;

  // D1/SQLite limiteaza numarul de parametri; taiem in bucati de 80 ca sa
  // ramanem mult sub limita si sa nu spargem listele mari de episoade.
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
        id: row.id,
        label: row.label,
        kind: row.kind,
        url: row.url,
        sort_order: row.sort_order,
        is_active: row.is_active,
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
  const seriesIdParam = url.searchParams.get('series_id');

  try {
    let res;
    if (seriesIdParam) {
      const sid = validatePositiveInt(seriesIdParam, 'ID-ul seriei');
      if (!sid.ok) return errorResponse(400, sid.error);
      res = await env.DB.prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title, e.views, e.created_at,
                s.title AS series_title
         FROM episodes e JOIN anime_series s ON s.id = e.series_id
         WHERE e.series_id = ? ORDER BY e.episode_number ASC LIMIT 2000`
      ).bind(sid.value).all();
    } else {
      res = await env.DB.prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title, e.views, e.created_at,
                s.title AS series_title
         FROM episodes e JOIN anime_series s ON s.id = e.series_id
         ORDER BY e.id DESC LIMIT 500`
      ).all();
    }

    const episodes = res.results || [];
    const sourcesByEp = await loadSourcesForEpisodes(env, episodes.map((e) => e.id));

    return json({
      episodes: episodes.map((e) => ({ ...e, sources: sourcesByEp.get(e.id) || [] })),
    });
  } catch (e) {
    console.error('GET /api/admin/episodes esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca episoadele');
  }
}

/** Scrie sursele unui episod. Folosita la creare si la inlocuire completa. */
async function insertSources(env, episodeId, sources) {
  if (!sources.length) return;
  const stmt = env.DB.prepare(
    `INSERT INTO episode_sources (episode_id, label, kind, url, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  );
  // batch() trimite totul intr-o singura calatorie spre D1 — la 12 surse
  // inseamna 1 round-trip in loc de 12.
  await env.DB.batch(sources.map((s, i) =>
    stmt.bind(episodeId, s.label, s.kind, s.url, s.sort_order ?? i)
  ));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-ep:${admin.id}`, 200, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const v = validateEpisode(body);
  if (!v.ok) return errorResponse(400, v.error);

  try {
    const series = await env.DB
      .prepare('SELECT id, title FROM anime_series WHERE id = ?')
      .bind(v.value.series_id)
      .first();
    if (!series) return errorResponse(400, 'Seria selectată nu există');

    const res = await env.DB
      .prepare(
        `INSERT INTO episodes (series_id, episode_number, title, created_by)
         VALUES (?, ?, ?, ?)`
      )
      .bind(v.value.series_id, v.value.episode_number, v.value.title, admin.id)
      .run();

    const id = res.meta?.last_row_id;
    if (!id) throw new Error('last_row_id lipsa');

    await insertSources(env, id, v.value.sources);

    const srcSummary = v.value.sources.length
      ? v.value.sources.map((s) => s.label).join(', ')
      : 'fără sursă';
    await logAdminAction(
      env, admin, 'create_episode', 'episode', id,
      `Ep. ${v.value.episode_number} din „${series.title}" — surse: ${srcSummary}`
    );

    return json(
      { success: true, id, episode: { id, ...v.value } },
      { status: 201 }
    );
  } catch (e) {
    // UNIQUE(series_id, episode_number) => mesaj clar, nu eroare generica
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) {
      return errorResponse(409, `Episodul ${v.value.episode_number} există deja pentru seria asta`);
    }
    console.error('POST /api/admin/episodes esuat:', msg);
    return errorResponse(500, 'Nu am putut adăuga episodul');
  }
}

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
      .prepare('SELECT id, episode_number, title FROM episodes WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Episodul nu există');

    // ON DELETE CASCADE sterge si sursele; nu e nevoie de DELETE separat.
    await env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(id.value).run();
    await logAdminAction(
      env, admin, 'delete_episode', 'episode', id.value,
      `Ep. ${existing.episode_number} — ${existing.title}`
    );

    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/episodes esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge episodul');
  }
}
