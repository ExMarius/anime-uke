// =====================================================================
// /api/chests — cufere cu comori, deblocate de timpul real petrecut pe o serie
//
//   GET  /api/chests?series_id=N  → praguri, progres, cufere deschise
//   POST /api/chests              → { series_id, tier } deschide un cufar
//
// De ce exista: punctele de la 15 minute rasplatesc un episod, dar nu spun
// nimic despre cine sta zece ore pe acelasi anime. Cuferele transforma timpul
// acumulat intr-o recompensa vizibila, cu praguri care merita urmarite.
//
// Reguli de siguranta, aceleasi ca la /api/progress:
//   - progresul se recalculeaza INTOTDEAUNA pe server la deschidere; clientul
//     nu poate afirma ca a atins un prag, poate doar sa ceara deschiderea
//   - dubla deschidere e imposibila prin PK(user_id, series_id, tier) +
//     INSERT OR IGNORE, verificat prin meta.changes, nu prin citiri separate
//   - punctele se acorda doar cand insertul chiar a scris un rand
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

// Praguri in secunde de vizionare acumulata pe serie si punctele aferente.
// Valorile sunt alese ca trepte simtite: o jumatate de episod lung, un
// maraton de seara, apoi un weekend intreg pe acelasi anime.
export const CHEST_TIERS = [
  { tier: 1, name: 'Cufăr de bronz', seconds: 1800, points: 5, icon: '🥉' },
  { tier: 2, name: 'Cufăr de argint', seconds: 7200, points: 15, icon: '🥈' },
  { tier: 3, name: 'Cufăr de aur', seconds: 21600, points: 40, icon: '🥇' },
];

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Secunde acumulate de un utilizator pe o serie, din watch_progress. */
async function seriesWatchSeconds(env, userId, seriesId) {
  const row = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(wp.seconds), 0) AS total
       FROM watch_progress wp
       JOIN episodes e ON e.id = wp.episode_id
       WHERE wp.user_id = ? AND e.series_id = ?`
    )
    .bind(userId, seriesId)
    .first();
  return Number(row?.total || 0);
}

async function claimedTiers(env, userId, seriesId) {
  const rows = await env.DB
    .prepare('SELECT tier FROM chests_claimed WHERE user_id = ? AND series_id = ?')
    .bind(userId, seriesId)
    .all();
  return new Set((rows.results || []).map((r) => r.tier));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('series_id'), 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  const series = await env.DB.prepare('SELECT id, title FROM anime_series WHERE id = ?').bind(id.value).first();
  if (!series) return errorResponse(404, 'Seria nu există');

  const total = await seriesWatchSeconds(env, user.id, id.value);
  const claimed = await claimedTiers(env, user.id, id.value);

  return json({
    series_id: series.id,
    series_title: series.title,
    total_seconds: total,
    chests: CHEST_TIERS.map((t) => ({
      ...t,
      claimed: claimed.has(t.tier),
      unlocked: total >= t.seconds,
    })),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `chests:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const sid = validatePositiveInt(body.series_id, 'ID-ul seriei');
  if (!sid.ok) return errorResponse(400, sid.error);
  const tierNo = validatePositiveInt(body.tier, 'Treapta cufarului');
  if (!tierNo.ok) return errorResponse(400, tierNo.error);

  const tierDef = CHEST_TIERS.find((t) => t.tier === tierNo.value);
  if (!tierDef) return errorResponse(400, 'Treapta nu există');

  const series = await env.DB.prepare('SELECT id FROM anime_series WHERE id = ?').bind(sid.value).first();
  if (!series) return errorResponse(404, 'Seria nu există');

  // Progresul se verifica pe server, in momentul cererii. Un client care ar
  // trimite tier=3 din consola primeste 409, nu puncte.
  const total = await seriesWatchSeconds(env, user.id, sid.value);
  if (total < tierDef.seconds) {
    return errorResponse(409, `Cufărul se deblochează la ${Math.round(tierDef.seconds / 60)} de minute de vizionare pe seria asta`);
  }

  try {
    const ins = await env.DB
      .prepare('INSERT OR IGNORE INTO chests_claimed (user_id, series_id, tier) VALUES (?, ?, ?)')
      .bind(user.id, sid.value, tierDef.tier)
      .run();

    let pointsAdded = 0;
    if (ins.meta.changes > 0) {
      await env.DB.prepare('UPDATE users SET points = points + ? WHERE id = ?').bind(tierDef.points, user.id).run();
      pointsAdded = tierDef.points;
    }

    const me = await env.DB.prepare('SELECT points FROM users WHERE id = ?').bind(user.id).first();

    return json({
      success: true,
      alreadyClaimed: pointsAdded === 0,
      pointsAdded,
      points: me?.points ?? 0,
      total_seconds: total,
    });
  } catch (e) {
    console.error('chests claim:', e);
    return errorResponse(500, 'Nu am putut deschide cufărul');
  }
}
