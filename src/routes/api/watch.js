import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

// =====================================================================
// POST /api/watch — marcheaza un episod ca vizionat si acorda puncte.
//
// Puncte per episod = 10; un episod se marcheaza o singura data per user.
//
// ANTI-RACE CONDITION: in v1 se facea intai un SELECT de verificare, apoi
// INSERT. Doua click-uri rapide treceau ambele de verificare si acordau
// 20 de puncte. Aici folosim `INSERT OR IGNORE` + `meta.changes`, care e
// atomic: al doilea request primeste changes=0 si nu mai acorda puncte.
// UNIQUE(user_id, episode_id) din schema e plasa de siguranta.
// =====================================================================

export const POINTS_PER_EPISODE = 10;

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `watch:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const id = validatePositiveInt(body.episode_id, 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  const episode = await env.DB.prepare('SELECT id FROM episodes WHERE id = ?').bind(id.value).first();
  if (!episode) return errorResponse(404, 'Episodul nu există');

  try {
    const insert = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO watched_history (user_id, episode_id, points) VALUES (?, ?, ?)`
      )
      .bind(user.id, id.value, POINTS_PER_EPISODE)
      .run();

    const alreadyWatched = (insert.meta?.changes ?? 0) === 0;

    if (alreadyWatched) {
      const current = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first();
      return json({
        success: true,
        alreadyWatched: true,
        pointsAdded: 0,
        points: current?.points ?? user.points,
        message: 'Deja ai marcat episodul ăsta ca vizionat',
      });
    }

    await env.DB
      .prepare('UPDATE users SET points = points + ? WHERE id = ?')
      .bind(POINTS_PER_EPISODE, user.id)
      .run();

    const updated = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first();

    return json({
      success: true,
      alreadyWatched: false,
      pointsAdded: POINTS_PER_EPISODE,
      points: updated?.points ?? user.points + POINTS_PER_EPISODE,
      message: `+${POINTS_PER_EPISODE} puncte!`,
    });
  } catch (e) {
    console.error('POST /api/watch esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut marca episodul');
  }
}

export function onRequestGet() {
  return errorResponse(405, 'Metodă nepermisă');
}
