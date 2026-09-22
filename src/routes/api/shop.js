// GET /api/shop — catalogul + ce detine userul + gold, intr-o singura cerere.
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { SHOP_ITEMS, NAME_COLORS, SITE_THEMES, ownedItems } from '../../lib/shop.js';
import { getSeasonalTheme, seasonalThemes } from '../../lib/season.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const me = await env.DB.prepare('SELECT gold, active_name_color, active_theme, xp_boost_until FROM users WHERE id = ?').bind(gate.user.id).first();
  const gold = me?.gold || 0;
  const boostUntil = me?.xp_boost_until || null;
  const owned = await ownedItems(env, gate.user.id);
  const decorate = (i) => ({
    ...i,
    owned: (owned[i.id] || 0) > 0,
    active: i.id === me?.active_name_color || i.id === me?.active_theme,
    can_buy: gold >= i.price && !(owned[i.id] > 0),
  });

  return json({
    gold,
    active_name_color: me?.active_name_color || null,
    active_theme: me?.active_theme || null,
    boost_until: boostUntil,
    boost_active: !!boostUntil && Date.now() < boostUntil,
    items: SHOP_ITEMS.map((i) => ({
      ...i,
      qty: owned[i.id] || 0,
      owned: !i.consumable && (owned[i.id] || 0) > 0,
      can_buy: gold >= i.price && (i.consumable || !(owned[i.id] > 0)),
    })),
    colors: NAME_COLORS.map(decorate),
    themes: SITE_THEMES.filter((t) => !t.seasonal).map(decorate),
    // Sezonul curent (daca e activat): cardul Standard il arata ca implicit.
    seasonal: await (async () => {
      const id = await getSeasonalTheme(env);
      if (!id) return null;
      const t = seasonalThemes().find((x) => x.id === id);
      return t ? { id: t.id, name: t.name } : null;
    })(),
  });
}
