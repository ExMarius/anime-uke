// =====================================================================
// /api/leaderboard — TOP-ul SAPTAMANAL, premiat in gold
//
//   GET /api/leaderboard → { weekly, alltime, viewer, prize, settled }
//
// Ce sunt „punctele": +10 per episod marcat vizionat. Nu se cheltuiesc —
// ele te claseaza in TOP-ul saptamanii, iar TOP-ul platin in GOLD la
// finalul saptamanii (🥇 500, 🥈 300, 🥉 200). Asa punctele au un scop
// clar: muncesti pentru podium, podiumul plateste in moneda din shop.
//
// Platoarea premiilor e „lena" (lazy): nu avem cron pe planul gratuit.
// Prima cerere de clasament dintr-o saptamana noua constata ca saptamana
// trecuta nu are randuri in lb_prizes si o premiaza pe loc (INSERT OR
// IGNORE + UPDATE gold ...). Cost D1: o singura data pe saptamana.
// =====================================================================
import { json, errorResponse } from '../../lib/http.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

const TOP_N = 20;

// Saptamana = luni 00:00 UTC → duminica 24:00. Cheile sunt datele ISO.
export const PRIZES = [
  { place: 1, gold: 500 },
  { place: 2, gold: 300 },
  { place: 3, gold: 200 },
];

function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

/** Luni 00:00 UTC a saptamanii in care cade data d. */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // luni=0 … duminica=6
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

/** Cheia saptamanii (data de luni), plus limitele SQL (incluziv). */
function weekInfo(offsetWeeks = 0) {
  const start = weekStart(new Date());
  start.setUTCDate(start.getUTCDate() - 7 * offsetWeeks);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { key: dayKey(start), start: dayKey(start), end: dayKey(end) };
}

/** Acorda premiile saptamanii `w` daca nu sunt deja acordate. Idempotent. */
async function settleWeek(env, w) {
  const existing = await env.DB
    .prepare('SELECT 1 AS x FROM lb_prizes WHERE week = ? LIMIT 1')
    .bind(w.key)
    .first();
  if (existing) return false;

  const top = await env.DB
    .prepare(
      `SELECT w.user_id AS user_id, SUM(w.points) AS pts
       FROM watched_history w
       JOIN users u ON u.id = w.user_id
       WHERE u.is_banned = 0 AND w.watched_at >= ? AND w.watched_at < ?
       GROUP BY w.user_id
       ORDER BY pts DESC, user_id ASC
       LIMIT ${PRIZES.length}`
    )
    .bind(`${w.start} 00:00:00`, `${w.end} 00:00:00`)
    .all();

  const rows = (top.results || []).map((r, i) => (PRIZES[i] ? [w.key, r.user_id, PRIZES[i].place, PRIZES[i].gold, r.pts || 0] : null)).filter(Boolean);
  if (!rows.length) return false;

  const stmts = rows.map((row) =>
    env.DB.prepare('INSERT OR IGNORE INTO lb_prizes (week, user_id, place, gold, points) VALUES (?, ?, ?, ?, ?)').bind(...row)
  );
  await env.DB.batch(stmts);

  // gold-ul chiar doar pentru randurile scrise acum (idempotent la re-rulare)
  const paid = await env.DB
    .prepare('SELECT user_id, gold FROM lb_prizes WHERE week = ?')
    .bind(w.key)
    .all();
  for (const p of paid.results || []) {
    await env.DB.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(p.gold, p.user_id).run();
  }
  return true;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `lb:${gate.user.id}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  try {
    const thisWeek = weekInfo(0);
    const lastWeek = weekInfo(1);
    const settled = await settleWeek(env, lastWeek);

    // TOP-ul saptamanii curente (cel care se premiaza duminica)
    const weekly = await env.DB
      .prepare(
        `SELECT u.username, u.level, u.rank_theme, u.is_admin, u.is_mod, up.avatar_url AS avatar,
                SUM(w.points) AS pts, COUNT(*) AS eps
         FROM watched_history w
         JOIN users u ON u.id = w.user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE u.is_banned = 0 AND w.watched_at >= ?
         GROUP BY u.id
         ORDER BY pts DESC, eps DESC, u.id ASC
         LIMIT ${TOP_N}`
      )
      .bind(`${thisWeek.start} 00:00:00`)
      .all();

    // Prestigiul de tot timpul, secundar
    const alltime = await env.DB
      .prepare(
        `SELECT u.username, u.points, u.level, u.rank_theme, u.is_admin, u.is_mod, up.avatar_url AS avatar
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE u.is_banned = 0
         ORDER BY u.points DESC, u.id ASC
         LIMIT ${TOP_N}`
      )
      .all();

    // Poziția săptămânii a vizitatorului
    const me = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS pts
         FROM watched_history WHERE user_id = ? AND watched_at >= ?`
      )
      .bind(gate.user.id, `${thisWeek.start} 00:00:00`)
      .first();

    const themes = await loadRankThemes(env);
    const mapWeekly = (weekly.results || []).map((r, i) => ({
      username: r.username,
      avatar: r.avatar || '',
      pts: r.pts || 0,
      eps: r.eps || 0,
      prize: PRIZES[i]?.gold || 0,
      rank: identity(r, themes).rank,
      staff: identity(r, themes).staff,
    }));

    return json({
      weekly: mapWeekly,
      alltime: (alltime.results || []).map((r) => ({
        username: r.username,
        avatar: r.avatar || '',
        points: r.points || 0,
        rank: identity(r, themes).rank,
        staff: identity(r, themes).staff,
      })),
      viewer: {
        username: gate.user.username,
        week_points: me?.pts || 0,
      },
      prize: {
        rewards: PRIZES,
        ends_at: `${thisWeek.end} 00:00 UTC`,
        week_start: thisWeek.start,
      },
      last_week_settled_now: settled,
    });
  } catch (e) {
    console.error('leaderboard esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca clasamentul');
  }
}
