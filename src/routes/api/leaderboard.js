// =====================================================================
// /api/leaderboard — top utilizatori dupa puncte + activitatea saptamanii
//
//   GET /api/leaderboard → { top: [{username, points, week}], viewer, updated_at }
//
// De ce cu cache: un clasament „la zi" ar scana tabelul users la fiecare
// cerere. La 1000 de utilizatori/zi ar fi milioane de randuri citite zilnic
// din plafonul gratuit D1. Asa: un singur rand citit pe cerere, iar
// scanarea completa se intampla doar cand cache-ul e mai vechi de 15
// minute (~96 de recalculari/zi, indiferent de trafic).
//
// „Saptamana" inseamna ultimele 7 zile de marcaje „vizionat" — singurul
// semnal de activitate pe care il stocam oricum, deci nu adaugam scrieri
// doar de dragul clasamentului.
// =====================================================================
import { json, errorResponse } from '../../lib/http.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

const CACHE_KEY = 'top';
const CACHE_TTL_SECONDS = 15 * 60;
const TOP_N = 20;

function ageSeconds(updatedAt) {
  const t = Date.parse(String(updatedAt).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 1000;
}

async function computeTop(env) {
  // gradele tematice se calculeaza din nivel + tema fiecarui om
  const top = await env.DB
    .prepare(
      `SELECT username, points, level, rank_theme, is_admin, is_mod FROM users
       WHERE is_banned = 0
       ORDER BY points DESC, id ASC
       LIMIT ${TOP_N}`
    )
    .all();

  // Activitatea saptamanii, intr-o singura cerere grupata, doar pentru
  // utilizatorii care chiar apar in top.
  const week = await env.DB
    .prepare(
      `SELECT u.username AS username, COUNT(*) AS n
       FROM watched_history w
       JOIN users u ON u.id = w.user_id
       WHERE w.watched_at >= datetime('now', '-7 days')
       GROUP BY u.username`
    )
    .all();
  const weekByUser = new Map((week.results || []).map((r) => [r.username, r.n]));

  const themes = await loadRankThemes(env);
  return (top.results || []).map((r) => ({
    username: r.username,
    points: r.points,
    week: weekByUser.get(r.username) || 0,
    rank: identity(r, themes).rank,
    staff: identity(r, themes).staff,
  }));
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `leaderboard:${user.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let top = null;
  let updatedAt = null;

  const cached = await env.DB
    .prepare('SELECT value, updated_at FROM leaderboard_cache WHERE key = ?')
    .bind(CACHE_KEY)
    .first();

  if (cached && ageSeconds(cached.updated_at) < CACHE_TTL_SECONDS) {
    try { top = JSON.parse(cached.value); updatedAt = cached.updated_at; } catch { top = null; }
  }

  if (!top) {
    top = await computeTop(env);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    try {
      await env.DB
        .prepare(
          `INSERT INTO leaderboard_cache (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        )
        .bind(CACHE_KEY, JSON.stringify(top))
        .run();
    } catch (e) {
      // Cache-ul e o optimizare, nu o dependenta: daca scrierea esueaza,
      // servim totusi rezultatul proaspat calculat.
      console.error('leaderboard cache write:', e);
    }
    updatedAt = stamp;
  }

  const me = await env.DB.prepare('SELECT username, points FROM users WHERE id = ?').bind(user.id).first();

  return json({
    top,
    updated_at: updatedAt,
    ttl_seconds: CACHE_TTL_SECONDS,
    viewer: me ? { username: me.username, points: me.points, in_top: top.some((t) => t.username === me.username) } : null,
  });
}
