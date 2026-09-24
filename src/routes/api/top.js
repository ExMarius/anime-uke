// GET /api/top — două clasamente ieftine, o singură cerere:
//   weekly → cele mai vizionate serii în ultimele 7 zile (din secundele
//            reale de vizionare, nu din contoare umflate)
//   rated  → cele mai bine notate serii (media + nr. voturi)
//
// BUGET D1 (măsurat cu scripts/bench-scale.mjs la 1.000 serii / 1.000 useri):
//
//   weekly, înainte: `WHERE updated_at >= datetime('now','-7 days')` pe
//     watch_progress FĂRĂ index pe updated_at → scanare completă de tabel:
//     199.011 rânduri citite pentru o singură afișare a primei pagini. Din
//     cota de 5M/zi ieșeau ~21 de vizite pe zi. Acum:
//       - migrarea 0028 a pus idx_progress_updated → căutare în interval;
//       - rezultatul se ține în `leaderboard_cache` (tabelul creat pentru
//         exact asta în 0008 și rămas nefolosit) o ORĂ întreagă, deci
//         recalculul costă ~4.000 rânduri de 24 de ori pe zi, iar cererile
//         obișnuite citesc 1 rând.
//     Un top „al săptămânii" nu are nevoie de prospețime de minut — are
//     nevoie să nu coste cât tot site-ul.
//   rated, înainte: GROUP BY pe tot series_ratings (29.578 rânduri citite
//     la fiecare cerere). Acum media stă pe rândul seriei (0028) și
//     clasamentul e o citire de 5 rânduri dintr-un index.
import { json } from '../../lib/http.js';

/**
 * Cât timp e bun un top săptămânal (și cât de des se plătește recalculul).
 *
 * O oră, nu un minut: recalculul citește toate rândurile de progres din
 * ultimele 7 zile (mii), iar un clasament „al săptămânii" nu are nevoie de
 * prospețime de minut. Se poate coborî prin `TOP_CACHE_MINUTES` (0 = mereu
 * proaspăt), exact ca plafoanele din limits.js — testele locale îl pun pe 0
 * ca să vadă imediat efectul unei vizionări.
 */
export const DEFAULT_CACHE_MINUTES = 60;
const WEEKLY_KEY = 'top_weekly';

/** Minutele de cache, din env sau implicitul de producție. */
export function cacheMinutes(env) {
  const raw = Number(env?.TOP_CACHE_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_CACHE_MINUTES;
}

const WEEKLY_SQL = `
  SELECT e.series_id AS id, s.title, s.cover_image,
         COUNT(DISTINCT w.user_id) AS watchers, SUM(w.seconds) AS seconds
  FROM watch_progress w
  JOIN episodes e ON e.id = w.episode_id
  JOIN anime_series s ON s.id = e.series_id
  WHERE w.updated_at >= datetime('now', '-7 days')
  GROUP BY e.series_id
  ORDER BY watchers DESC, seconds DESC
  LIMIT 5`;

const RATED_SQL = `
  SELECT id, title, cover_image,
         ROUND(rating_avg, 1) AS average, rating_count AS votes
  FROM anime_series
  WHERE rating_count > 0
  ORDER BY rating_avg DESC, rating_count DESC
  LIMIT 5`;

/**
 * Topul săptămânal, din cache-ul D1 dacă e proaspăt.
 *
 * `leaderboard_cache` e partajat între izolate (memoria unui izolat nu e),
 * deci ține locul unui cron: cine ajunge primul după expirare recalculează,
 * restul citesc rândul. Scriem cu ON CONFLICT ca să nu conteze ordinea.
 */
async function weeklyTop(env) {
  const minutes = cacheMinutes(env);
  try {
    // minutes = 0 → nu se citește cache-ul deloc (folosit de teste și de
    // dezvoltarea locală: vezi TOP_CACHE_MINUTES).
    if (minutes > 0) {
      const hit = await env.DB
        .prepare(
          `SELECT value FROM leaderboard_cache
            WHERE key = ? AND updated_at >= datetime('now', ?)`
        )
        .bind(WEEKLY_KEY, `-${minutes} minutes`)
        .first();
      if (hit?.value) return JSON.parse(hit.value);
    }
  } catch (e) {
    console.error('top weekly: citirea cache-ului a eșuat:', e?.message || e);
  }

  const res = await env.DB.prepare(WEEKLY_SQL).all();
  const rows = res.results || [];

  // Cache-ul e o optimizare: dacă scrierea pică, răspunsul rămâne corect.
  try {
    await env.DB
      .prepare(
        `INSERT INTO leaderboard_cache (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(WEEKLY_KEY, JSON.stringify(rows))
      .run();
  } catch (e) {
    console.error('top weekly: scrierea cache-ului a eșuat:', e?.message || e);
  }

  return rows;
}

export async function onRequestGet(context) {
  const { env } = context;

  const [week, rated] = await Promise.all([
    weeklyTop(env),
    env.DB.prepare(RATED_SQL).all(),
  ]);

  return json(
    { weekly: week, rated: rated.results || [] },
    { headers: { 'cache-control': 'private, max-age=60' } }
  );
}
