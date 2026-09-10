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
// existente), apoi completeaza numar, titlu si URL DoodStream.
// =====================================================================

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
        `SELECT e.id, e.series_id, e.episode_number, e.title, e.doodstream_url, e.views, e.created_at,
                s.title AS series_title
         FROM episodes e JOIN anime_series s ON s.id = e.series_id
         WHERE e.series_id = ? ORDER BY e.episode_number ASC LIMIT 2000`
      ).bind(sid.value).all();
    } else {
      res = await env.DB.prepare(
        `SELECT e.id, e.series_id, e.episode_number, e.title, e.doodstream_url, e.views, e.created_at,
                s.title AS series_title
         FROM episodes e JOIN anime_series s ON s.id = e.series_id
         ORDER BY e.id DESC LIMIT 500`
      ).all();
    }
    return json({ episodes: res.results || [] });
  } catch (e) {
    console.error('GET /api/admin/episodes esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca episoadele');
  }
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
        `INSERT INTO episodes (series_id, episode_number, title, doodstream_url, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(v.value.series_id, v.value.episode_number, v.value.title, v.value.doodstream_url, admin.id)
      .run();

    const id = res.meta?.last_row_id;
    await logAdminAction(
      env, admin, 'create_episode', 'episode', id,
      `Ep. ${v.value.episode_number} din „${series.title}"`
    );

    return json({ success: true, id, episode: { id, ...v.value } }, { status: 201 });
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
