// =====================================================================
// /api/chest — cufărul cu comori global, o dată la 4 ore
//
//   GET  → gold, deschideri, când se poate deschide din nou
//   POST → deschide: cooldown server-side, recompensă ponderată,
//          animațiile sunt treaba browserului, decizia e aici
//
// Recompense ponderate ca în spec (gold des, xp des, nimic uneori).
// Random-ul e pe server: clientul nu poate „alege" recompensa.
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { addActivity, grantBadge } from '../../lib/xp.js';
import { bumpMission, streakTouch } from '../../lib/missions.js';

export const CHEST_COOLDOWN_MS = 4 * 60 * 60 * 1000;

const REWARDS = [
  { reward: 'gold', weight: 100, min: 10, max: 100, text: 'Ai găsit {amount} Gold!' },
  { reward: 'xp', weight: 80, min: 5, max: 50, text: 'Ai primit {amount} XP!' },
  { reward: 'nothing', weight: 20, min: 0, max: 0, text: 'Cufărul era gol… Mai încearcă!' },
];

function pickReward() {
  const total = REWARDS.reduce((s, r) => s + r.weight, 0);
  let roll = Math.floor(Math.random() * total) + 1;
  for (const r of REWARDS) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return REWARDS[0];
}

async function chestState(env, userId) {
  const row = await env.DB
    .prepare('SELECT last_opened_at, opens FROM chest_cooldown WHERE user_id = ?')
    .bind(userId)
    .first();
  if (!row) return { opens: 0, available: true, next_open_at: null, remaining_ms: 0 };
  const last = Date.parse(String(row.last_opened_at).replace(' ', 'T') + 'Z');
  const remaining = last + CHEST_COOLDOWN_MS - Date.now();
  return {
    opens: row.opens,
    available: remaining <= 0,
    next_open_at: row.last_opened_at,
    remaining_ms: Math.max(0, remaining),
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(gate.user.id).first();
  return json({ gold: me?.gold || 0, chest: await chestState(env, gate.user.id) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `chest:${user.id}`, 60, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const state = await chestState(env, user.id);
  let usedKey = false;
  if (!state.available) {
    // 🗝️ Cheia din shop sare peste cooldown — se consuma la folosire.
    if (!body.use_key) {
      return errorResponse(409, 'cooldown', { 'x-remaining-ms': String(state.remaining_ms) });
    }
    const spent = await env.DB
      .prepare(`UPDATE user_items SET qty = qty - 1 WHERE user_id = ? AND item_id = 'chest_key' AND qty > 0`)
      .bind(user.id)
      .run();
    if (!spent.meta?.changes) return errorResponse(409, 'Nu ai nicio cheie — poți cumpăra una din Shop.');
    usedKey = true;
  }

  const chosen = pickReward();
  const amount = chosen.min === chosen.max && chosen.min === 0
    ? 0
    : chosen.min + Math.floor(Math.random() * (chosen.max - chosen.min + 1));

  if (chosen.reward === 'gold') {
    await env.DB.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(amount, user.id).run();
  } else if (chosen.reward === 'xp') {
    await addActivity(env, user.id, amount);
  }
  // Deschiderea in sine valoreaza +5 XP / +5 puncte lunare, ca in spec.
  await addActivity(env, user.id, 5);
  // Misiunea zilnica „deschide cufarul" + streak.
  await bumpMission(env, user.id, 'chest');
  await streakTouch(env, user.id);

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const up = await env.DB
    .prepare(
      `INSERT INTO chest_cooldown (user_id, last_opened_at, opens) VALUES (?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET last_opened_at = excluded.last_opened_at, opens = opens + 1`
    )
    .bind(user.id, stamp)
    .run();
  void up;
  const after = await chestState(env, user.id);
  if (after.opens >= 10) await grantBadge(env, user.id, 'chest_10');

  const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(user.id).first();

  return json({
    success: true,
    used_key: usedKey,
    reward: chosen.reward,
    amount,
    text: chosen.text.replace('{amount}', String(amount)),
    gold: me?.gold || 0,
    chest: after,
  });
}
