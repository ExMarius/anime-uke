// GET /api/top — două clasamente ieftine, o singură cerere:
//   weekly → cele mai vizionate serii în ultimele 7 zile (din secundele
//            reale de vizionare, nu din contoare umflate)
//   rated  → cele mai bine notate serii (media + nr. voturi)
// Ambele sunt GROUP BY pe indexurile existente; 60 s de cache privat
// ca să nu plătim agregarea la fiecare refresh.
import { json } from '../../lib/http.js';
export async function onRequestGet(context) {
  const { env } = context;

  const [week, rated] = await Promise.all([
    env.DB
      .prepare(
        `SELECT e.series_id AS id, s.title, s.cover_image,
                COUNT(DISTINCT w.user_id) AS watchers, SUM(w.seconds) AS seconds
         FROM watch_progress w
         JOIN episodes e ON e.id = w.episode_id
         JOIN anime_series s ON s.id = e.series_id
         WHERE w.updated_at >= datetime('now', '-7 days')
         GROUP BY e.series_id
         ORDER BY watchers DESC, seconds DESC
         LIMIT 5`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT r.series_id AS id, s.title, s.cover_image,
                ROUND(AVG(r.rating), 1) AS average, COUNT(*) AS votes
         FROM series_ratings r
         JOIN anime_series s ON s.id = r.series_id
         GROUP BY r.series_id
         ORDER BY average DESC, votes DESC
         LIMIT 5`
      )
      .all(),
  ]);

  return json(
    { weekly: week.results || [], rated: rated.results || [] },
    { headers: { 'cache-control': 'private, max-age=60' } }
  );
}
