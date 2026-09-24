// =====================================================================
// GET /api/continue — rândul „Continuă vizionarea"
//
// Nu stocheaza nimic nou: citeste din watch_progress (timp acumulat real),
// ultimele 8 episoade atinse de utilizator, cu seria si episodul alaturate.
// Un singur query indexat pe user, deci costul e constant indiferent de
// marimea catalogului.
//
// ep_duration vine din ACELASI rand de serie (JOIN pe cheia primara), ca
// pagina sa poata desena bara de progres: „ai vazut 40% din episod". Fara
// o durata reala am afisa procente inventate, deci daca seriei nu i s-a
// completat durata, pagina scrie „Ai inceput" in loc de un procent fals.
//
// URMĂTORUL EPISOD (adăugat 2026-09-24): fiecare item vine cu
// next_episode_id / next_episode_number, ca pagina să poată duce direct la
// episodul următor când cel curent e terminat — fără o a doua cerere și
// fără să ghicească din numere (episoadele nu sunt mereu consecutive).
// Subinterogarea e o singură descindere în idx_episodes_series (creat încă
// din 0001 ca (series_id, episode_number) — verificat cu EXPLAIN QUERY PLAN:
// „SEARCH e2 USING COVERING INDEX idx_episodes_series (series_id=? AND
// episode_number>?)”), nu o sortare a tuturor episoadelor seriei. Deci nu a
// fost nevoie de nicio migrare nouă: indexul exista deja.
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
              s.id AS series_id, s.title AS series_title, s.cover_image, s.ep_duration,
              (SELECT e2.id FROM episodes e2
                WHERE e2.series_id = e.series_id AND e2.episode_number > e.episode_number
                ORDER BY e2.episode_number ASC LIMIT 1) AS next_episode_id,
              (SELECT e3.episode_number FROM episodes e3
                WHERE e3.series_id = e.series_id AND e3.episode_number > e.episode_number
                ORDER BY e3.episode_number ASC LIMIT 1) AS next_episode_number
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
