// =====================================================================
// /api/missions — misiunile zilnice, inima „logicii pentru utilizatori".
//   GET  → cele 3 misiuni de azi + streak (o singura citire indexata)
//   POST { mission: 'watch' } → revendica recompensa cand progresul e plin
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { getMissionState, getStreak, claimMission } from '../../lib/missions.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const [missions, streak] = await Promise.all([
    getMissionState(env, gate.user.id),
    getStreak(env, gate.user.id),
  ]);
  return json({ missions, streak });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'Cerere invalidă'); }

  const result = await claimMission(env, gate.user.id, String(body?.mission || ''));
  if (!result) return errorResponse(409, 'Misiunea nu e gata sau e deja revendicată');

  const [missions, streak] = await Promise.all([
    getMissionState(env, gate.user.id),
    getStreak(env, gate.user.id),
  ]);
  const me = await env.DB
    .prepare('SELECT gold, points, level, xp FROM users WHERE id = ?')
    .bind(gate.user.id)
    .first();

  return json({ success: true, reward: result, missions, streak, me });
}
