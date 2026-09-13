// POST /api/shop/buy — {item_id}. Scaderea gold-ului e atomica
// (UPDATE ... WHERE gold >= pret): doua cumparari simultane nu pot
// duce niciodata in negativ, fara tranzactii explicite.
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { findItem, ownedItems } from '../../lib/shop.js';

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

  const owned = await ownedItems(env, gate.user.id);
  if (!item.consumable && (owned[item.id] || 0) > 0) {
    return errorResponse(409, 'Deții deja acest articol');
  }

  const charge = await env.DB
    .prepare('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?')
    .bind(item.price, gate.user.id, item.price)
    .run();
  if (!charge.meta?.changes) return errorResponse(400, 'Gold insuficient');

  await env.DB
    .prepare(
      `INSERT INTO user_items (user_id, item_id, qty) VALUES (?, ?, 1)
       ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + 1`
    )
    .bind(gate.user.id, item.id)
    .run();

  const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(gate.user.id).first();
  const after = await ownedItems(env, gate.user.id);
  return json({ success: true, item_id: item.id, gold: me?.gold || 0, qty: after[item.id] || 0 });
}
