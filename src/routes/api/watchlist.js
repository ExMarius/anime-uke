import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { validatePositiveInt } from '../../lib/validate.js';

// =====================================================================
// /api/watchlist — lista „Serii de vizionat" din Acces rapid.
//
// Fiecare utilizator isi vede doar propria lista; nu exista acces la
// lista altcuiva decat prin numarul afisat pe profilul public.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  try {
    const { results } = await env.DB
      .prepare(
        `SELECT w.series_id, w.added_at,
                s.title, s.cover_image, s.status, s.genre, s.year,
                s.episode_count
         FROM watchlist w JOIN anime_series s ON s.id = w.series_id
         WHERE w.user_id = ?
         ORDER BY w.added_at DESC, w.id DESC
         LIMIT 100`
      )
      .bind(user.id)
      .all();

    return json({ watchlist: results || [], count: (results || []).length },
      { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('GET /api/watchlist esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca lista');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.series_id, 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const series = await env.DB
      .prepare('SELECT id, title FROM anime_series WHERE id = ?')
      .bind(id.value)
      .first();
    if (!series) return errorResponse(404, 'Seria nu există');

    // INSERT OR IGNORE: UNIQUE(user_id, series_id) face ca a doua adaugare
    // sa fie un no-op, nu o eroare. Verificam apoi daca randul e al nostru.
    const res = await env.DB
      .prepare('INSERT OR IGNORE INTO watchlist (user_id, series_id) VALUES (?, ?)')
      .bind(user.id, id.value)
      .run();

    const added = (res.meta?.changes ?? 0) === 1;
    return json({ success: true, added, alreadyInList: !added, series_id: id.value },
      { status: added ? 201 : 200 });
  } catch (e) {
    console.error('POST /api/watchlist esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut adăuga seria în listă');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('series_id'), 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const res = await env.DB
      .prepare('DELETE FROM watchlist WHERE user_id = ? AND series_id = ?')
      .bind(user.id, id.value)
      .run();

    return json({ success: true, removed: (res.meta?.changes ?? 0) === 1 });
  } catch (e) {
    console.error('DELETE /api/watchlist esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge seria din listă');
  }
}
