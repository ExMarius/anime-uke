import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validateSeries, validatePositiveInt } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// =====================================================================
// /api/admin/series — CRUD serii, doar pentru admini.
// GET lista · POST creare · DELETE ?id=N stergere
//
// In v1 nu exista stergere, iar formularul de adaugare nu dezactiva
// butonul la click — de aceea ai in baza de date „One Piece" de doua ori.
// Aici: validare + buton dezactivat in front + log in admin_log.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    const res = await env.DB.prepare(
      `SELECT
         s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year, s.created_at,
         u.username AS created_by_name,
         (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id) AS episode_count
       FROM anime_series s
       LEFT JOIN users u ON u.id = s.created_by
       ORDER BY s.id DESC LIMIT 500`
    ).all();
    return json({ series: res.results || [] });
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

  const rl = await checkRateLimit(env, `admin-series:${admin.id}`, 60, 60 * 60 * 1000);
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
    const res = await env.DB
      .prepare(
        `INSERT INTO anime_series (title, description, cover_image, status, genre, year, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(v.value.title, v.value.description, v.value.cover_image, v.value.status, v.value.genre, v.value.year, admin.id)
      .run();

    const id = res.meta?.last_row_id;
    await logAdminAction(env, admin, 'create_series', 'series', id, `„${v.value.title}"`);

    return json({ success: true, id, series: { id, ...v.value } }, { status: 201 });
  } catch (e) {
    console.error('POST /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut adăuga seria');
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
      .prepare('SELECT id, title FROM anime_series WHERE id = ?')
      .bind(id.value)
      .first();
    if (!existing) return errorResponse(404, 'Seria nu există');

    // ON DELETE CASCADE pe episodes sterge si episoadele, iar cascade pe
    // watched_history sterge istoricul aferent.
    await env.DB.prepare('DELETE FROM anime_series WHERE id = ?').bind(id.value).run();
    await logAdminAction(env, admin, 'delete_series', 'series', id.value, `„${existing.title}" + episoadele aferente`);

    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge seria');
  }
}
