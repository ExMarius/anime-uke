// =====================================================================
// GET /api/continue — rândul „Continuă vizionarea"
//
// Nu stocheaza nimic nou: citeste din watch_progress (timp acumulat real),
// ultimele 8 episoade atinse de utilizator, cu seria si episodul alaturate.
// Un singur query indexat pe user, deci costul e constant indiferent de
// marimea catalogului.
// =====================================================================
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rows = await env.DB
    .prepare(
      `SELECT wp.episode_id, wp.seconds, wp.updated_at,
              e.episode_number, e.title AS episode_title,
              s.id AS series_id, s.title AS series_title, s.cover_image
       FROM watch_progress wp
       JOIN episodes e ON e.id = wp.episode_id
       JOIN anime_series s ON s.id = e.series_id
       WHERE wp.user_id = ? AND wp.seconds >= 30
       ORDER BY wp.updated_at DESC
       LIMIT 8`
    )
    .bind(user.id)
    .all();

  return json({ items: rows.results || [] });
}
