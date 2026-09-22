// =====================================================================
// Economie: XP cu niveluri, puncte lunare, insigne.
//
// Nivelul creste progresiv: xpNecesar(n) = 100n² + 500n (600 XP la
// nivelul 1, 1.400 la 2, 2.700 la 3…). Formulele din spec erau calibrate
// pentru un site cu mii de voturi pe zi; asta creste la fel de progresiv
// dar se simte miscare si pe un site la inceput.
//
// Fiecare acordare de XP face SI o acordare de puncte lunare, ca in spec:
// doua contoare separate, aceleasi actiuni.
// =====================================================================

export const MONTHLY_GOAL = 10000;

export const BADGES = {
  first_watch:  { name: 'Primul episod', icon: '🎬' },
  watcher_50:   { name: '50 de episoade', icon: '📺' },
  commenter_25: { name: 'Comentator', icon: '💬' },
  chest_10:     { name: 'Căutător de comori', icon: '🎁' },
  month_active: { name: 'Utilizator activ', icon: '🏅' },
};

export function xpNeeded(level) {
  return 100 * level * level + 500 * level;
}

export function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Insigne: o singura data per (user, insigna, luna). INSERT OR IGNORE face
 *  re-acordarea idempotenta fara citiri in plus. */
export async function grantBadge(env, userId, badge, month = '') {
  await env.DB
    .prepare('INSERT OR IGNORE INTO user_badges (user_id, badge, month) VALUES (?, ?, ?)')
    .bind(userId, badge, month)
    .run();
}

/** Adauga XP si rezolva nivelurile in bucla (cat timp trece de prag). */
export async function addXp(env, userId, amount) {
  if (!amount) return { leveledUp: false, boosted: false };
  // Boost-ul din shop (⚡ Boost XP 24h) dubleaza XP-ul din ORICE sursa cat e
  // activ — o citire pe cheia primara, aceeasi ca in bucla de mai jos.
  let boosted = false;
  const b = await env.DB.prepare('SELECT xp_boost_until FROM users WHERE id = ?').bind(userId).first();
  if (b?.xp_boost_until && Date.now() < b.xp_boost_until) {
    amount *= 2;
    boosted = true;
  }
  await env.DB.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, userId).run();

  let leveledUp = false;
  for (let guard = 0; guard < 50; guard++) {
    const u = await env.DB.prepare('SELECT xp, level FROM users WHERE id = ?').bind(userId).first();
    if (!u) break;
    const need = xpNeeded(u.level);
    if (u.xp < need) break;
    await env.DB
      .prepare('UPDATE users SET xp = xp - ?, level = level + 1 WHERE id = ? AND level = ?')
      .bind(need, userId, u.level)
      .run();
    leveledUp = true;
  }
  return { leveledUp, boosted };
}

/** Puncte lunare + insigna „Utilizator activ" cand treci de pragul lunii. */
export async function addMonthly(env, userId, amount) {
  if (!amount) return;
  const mk = monthKey();
  await env.DB
    .prepare(
      `INSERT INTO user_monthly_points (user_id, month, points) VALUES (?, ?, ?)
       ON CONFLICT(user_id, month) DO UPDATE SET points = points + ?`
    )
    .bind(userId, mk, amount, amount)
    .run();
  const row = await env.DB
    .prepare('SELECT points FROM user_monthly_points WHERE user_id = ? AND month = ?')
    .bind(userId, mk)
    .first();
  if ((row?.points || 0) >= MONTHLY_GOAL) await grantBadge(env, userId, 'month_active', mk);
}

/** Perechea standard din spec: aceeasi actiune hraneste ambele contoare. */
export async function addActivity(env, userId, amount) {
  const r = await addXp(env, userId, amount);
  // Punctele lunare tin pasul cu XP-ul FINAL (dublat de boost): altfel
  // boost-ul ar umfla nivelul fara sa miste clasamentul lunar.
  await addMonthly(env, userId, r.boosted ? amount * 2 : amount);
  return r;
}
