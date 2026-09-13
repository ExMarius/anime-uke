// =====================================================================
// Misiuni zilnice + streak — sistemul care da LOGICA economiei.
//
// Regula de aur (fiecare valoare are o singura identitate, explicabila
// intr-o fraza):
//   ⭐ PUNCTE  = trofeu de VIZIONARE (+10/episod). Clasament = cat ai vazut.
//   ⚔️ XP      = activitate orice -> NIVEL -> RANG vizibil (Genin..Hokage).
//   🪙 GOLD    = bani de shop. Din cufar (noroc) si MISIUNI (sigur).
//   🎯 MISIUNI = 3/zi: vezi un episod, comenteaza, deschide cufarul.
//   🔥 STREAK  = zile consecutive cu cel putin o misiune facuta.
//
// Ziua e UTC, identica pentru toti — resetarea nu poate fi „vazuta" in
// avans de nimeni si nu poate fi abuzata cu fus orar.
// =====================================================================

import { addActivity } from './xp.js';

export const MISSIONS = [
  {
    key: 'watch',
    icon: '📺',
    label: 'Privește un episod (15 min)',
    target: 1,
    gold: 15,
    xp: 10,
  },
  {
    key: 'comment',
    icon: '💬',
    label: 'Scrie un comentariu',
    target: 1,
    gold: 10,
    xp: 10,
  },
  {
    key: 'chest',
    icon: '🎁',
    label: 'Deschide cufărul',
    target: 1,
    gold: 5,
    xp: 5,
  },
];

export function findMission(key) {
  return MISSIONS.find((m) => m.key === key) || null;
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Progres +1 pentru o misiune (idempotent peste target prin MIN). */
export async function bumpMission(env, userId, key) {
  if (!findMission(key)) return;
  await env.DB
    .prepare(
      `INSERT INTO daily_missions (user_id, day, mission, progress) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, day, mission) DO UPDATE SET
         progress = MIN(progress + 1, ?)`
    )
    .bind(userId, todayKey(), key, findMission(key).target)
    .run();
}

/**
 * Streak: ultima zi de activitate vs. azi.
 *   azi    -> nimic (deja numarat)
 *   ieri   -> current + 1
 *   restul -> 1
 * O singura scriere atomică pe condiție.
 */
export async function streakTouch(env, userId) {
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  const row = await env.DB
    .prepare('SELECT current, best, last_day FROM user_streak WHERE user_id = ?')
    .bind(userId)
    .first();

  let current = 1;
  if (row) {
    if (row.last_day === today) current = row.current;
    else if (row.last_day === yesterday) current = row.current + 1;
  }
  const best = Math.max(row?.best || 0, current);
  await env.DB
    .prepare(
      `INSERT INTO user_streak (user_id, current, best, last_day) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET current = excluded.current, best = excluded.best, last_day = excluded.last_day`
    )
    .bind(userId, current, best, today)
    .run();
  return { current, best };
}

export async function getStreak(env, userId) {
  const row = await env.DB
    .prepare('SELECT current, best, last_day FROM user_streak WHERE user_id = ?')
    .bind(userId)
    .first();
  const today = todayKey();
  // Streak-ul expira vizual daca nu ai mai fost activ azi sau ieri.
  if (!row || (row.last_day !== today && row.last_day !== todayKey(new Date(Date.now() - 86400000)))) {
    return { current: 0, best: row?.best || 0, active_today: false };
  }
  return { current: row.current, best: row.best, active_today: row.last_day === today };
}

/** Starea celor 3 misiuni de azi (o singura citire indexata). */
export async function getMissionState(env, userId) {
  const res = await env.DB
    .prepare('SELECT mission, progress, claimed FROM daily_missions WHERE user_id = ? AND day = ?')
    .bind(userId, todayKey())
    .all();
  const map = {};
  for (const r of res.results || []) map[r.mission] = { progress: r.progress, claimed: !!r.claimed };
  return MISSIONS.map((m) => ({
    key: m.key,
    icon: m.icon,
    label: m.label,
    target: m.target,
    gold: m.gold,
    xp: m.xp,
    progress: Math.min(map[m.key]?.progress || 0, m.target),
    claimed: !!map[m.key]?.claimed,
  }));
}

/**
 * Revendicarea: valida DOAR daca progresul a atins targetul si nu e deja
 * luata. Gold + XP+puncte lunare intr-o cadenta atomica de verificari.
 * Returneaza null daca misiunea nu e (inca) revendicabila.
 */
export async function claimMission(env, userId, key) {
  const m = findMission(key);
  if (!m) return null;
  const row = await env.DB
    .prepare('SELECT progress, claimed FROM daily_missions WHERE user_id = ? AND day = ? AND mission = ?')
    .bind(userId, todayKey(), key)
    .first();
  if (!row || row.claimed || row.progress < m.target) return null;

  const upd = await env.DB
    .prepare('UPDATE daily_missions SET claimed = 1 WHERE user_id = ? AND day = ? AND mission = ? AND claimed = 0')
    .bind(userId, todayKey(), key)
    .run();
  if (!upd.meta?.changes) return null; // cursa intre doua claim-uri paralele

  await env.DB
    .prepare('UPDATE users SET gold = gold + ? WHERE id = ?')
    .bind(m.gold, userId)
    .run();
  const act = await addActivity(env, userId, m.xp);
  return { gold: m.gold, xp: m.xp, leveledUp: act.leveledUp };
}
