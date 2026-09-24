// POST /api/shop/buy — {item_id}. Scaderea gold-ului e atomica
// (UPDATE ... WHERE gold >= pret): doua cumparari simultane nu pot
// duce niciodata in negativ, fara tranzactii explicite.
//
// Dupa plata, acordarea depinde de felul articolului (vezi shop.js):
//   - stocabil (chei, jetoane, permanente): rand in user_items.
//   - pachet (set de chei): crediteaza articolul-tinta, nu pe sine.
//   - instant (misterios, boost, tom): efectul se aplica pe loc si
//     raspunsul aduce detaliile (recompensa / boost_until / xp).
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { findItem, ownedItems } from '../../lib/shop.js';
import { addActivity } from '../../lib/xp.js';

export const XP_BOOST_MS = 24 * 60 * 60 * 1000;
export const XP_TOME_AMOUNT = 200;

// Cufarul misterios: pret 200, valoare medie ~330 — uneori iesi in pierdere,
// alteori lovesti cheia (150) + gold gras. Random pe server, ca la cufar.
const MYSTERY_REWARDS = [
  { reward: 'gold', weight: 100, min: 100, max: 400, text: 'Ai găsit {amount} Gold!' },
  { reward: 'xp', weight: 80, min: 20, max: 120, text: 'Ai primit {amount} XP!' },
  { reward: 'key', weight: 25, min: 1, max: 1, text: 'Ai găsit o cheie de cufăr! 🗝️' },
  { reward: 'nothing', weight: 10, min: 0, max: 0, text: 'Cufărul era gol… Mai încearcă!' },
];

function pickMystery() {
  const total = MYSTERY_REWARDS.reduce((s, r) => s + r.weight, 0);
  let roll = Math.floor(Math.random() * total) + 1;
  for (const r of MYSTERY_REWARDS) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return MYSTERY_REWARDS[0];
}

async function grantInstant(env, userId, item) {
  // Tomul intelepciunii: +200 XP pe loc (boost-ul, daca e activ, il dubleaza;
  // punctele lunare tin pasul — vezi addActivity).
  if (item.id === 'xp_tome') {
    const r = await addActivity(env, userId, XP_TOME_AMOUNT);
    const granted = XP_TOME_AMOUNT * (r.boosted ? 2 : 1);
    return { xp_granted: granted, boosted: r.boosted, refetch: true };
  }
  // Boost XP: prelungeste cu 24h de la max(acum, expirare curenta).
  if (item.id === 'xp_boost') {
    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE users SET xp_boost_until =
           CASE WHEN COALESCE(xp_boost_until, 0) > ? THEN xp_boost_until + ? ELSE ? END
         WHERE id = ?`
      )
      .bind(now, XP_BOOST_MS, now + XP_BOOST_MS, userId)
      .run();
    const row = await env.DB.prepare('SELECT xp_boost_until FROM users WHERE id = ?').bind(userId).first();
    return { boost_until: row?.xp_boost_until || null, refetch: true };
  }
  // Cufarul misterios: se deschide pe loc, fara rand in inventar.
  if (item.id === 'mystery_box') {
    const r = pickMystery();
    const amount = r.min + Math.floor(Math.random() * (r.max - r.min + 1));
    if (r.reward === 'gold') {
      await env.DB.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').bind(amount, userId).run();
    } else if (r.reward === 'xp') {
      await addActivity(env, userId, amount);
    } else if (r.reward === 'key') {
      await env.DB
        .prepare(
          `INSERT INTO user_items (user_id, item_id, qty) VALUES (?, 'chest_key', 1)
           ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1`
        )
        .bind(userId)
        .run();
    }
    return {
      reward: r.reward,
      reward_amount: r.reward === 'nothing' ? 0 : amount,
      reward_text: r.text.replace('{amount}', String(amount)),
      refetch: true,
    };
  }
  return { refetch: true };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `shop:${gate.user.id}`, 20, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const item = findItem(String(body?.item_id || ''));
  if (!item) return errorResponse(400, 'Articolul nu există');
  if (item.seasonal) return errorResponse(400, 'Temă de sezon — o activează adminul pentru toată lumea');

  const owned = await ownedItems(env, gate.user.id);
  if (!item.consumable && (owned[item.id] || 0) > 0) {
    return errorResponse(409, 'Deții deja acest articol');
  }

  const charge = await env.DB
    .prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?')
    .bind(item.price, gate.user.id, item.price)
    .run();
  if (!charge.meta?.changes) return errorResponse(400, 'Gold insuficient');

  // Articolele instant nu lasa urma in inventar: efectul se aplica acum.
  if (item.instant) {
    const extra = await grantInstant(env, gate.user.id, item);
    const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(gate.user.id).first();
    return json({ success: true, item_id: item.id, gold: me?.gold || 0, qty: 0, ...extra });
  }

  // Pachetul crediteaza articolul-tinta (set de chei → 3× chest_key).
  const grantId = item.bundle || item.id;
  const grantQty = item.bundle_qty || 1;
  await env.DB
    .prepare(
      `INSERT INTO user_items (user_id, item_id, qty) VALUES (?, ?, ?)
       ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?`
    )
    .bind(gate.user.id, grantId, grantQty, grantQty)
    .run();

  const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(gate.user.id).first();
  const after = await ownedItems(env, gate.user.id);
  return json({
    success: true,
    item_id: item.id,
    gold: me?.gold || 0,
    qty: after[item.id] || 0,
    ...(grantId !== item.id ? { linked: { id: grantId, qty: after[grantId] || 0 }, refetch: true } : {}),
  });
}
