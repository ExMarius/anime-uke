// GET /api/shop — catalogul + ce detine userul + gold, intr-o singura cerere.
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { SHOP_ITEMS, ownedItems } from '../../lib/shop.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const me = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(gate.user.id).first();
  const gold = me?.gold || 0;
  const owned = await ownedItems(env, gate.user.id);

  return json({
    gold,
    items: SHOP_ITEMS.map((i) => ({
      ...i,
      qty: owned[i.id] || 0,
      owned: !i.consumable && (owned[i.id] || 0) > 0,
      can_buy: gold >= i.price && (i.consumable || !(owned[i.id] > 0)),
    })),
  });
}
