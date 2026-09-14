// POST /api/shop/activate — { type: 'color'|'theme', id }
// Comută un cosmetic DEȚINUT (sau revine la standard cu id='theme_standard'
// / fără culoare). Nu costă nimic: plata s-a întâmplat la cumpărare.
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { NAME_COLORS, SITE_THEMES } from '../../lib/shop.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `activate:${gate.user.id}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const type = String(body?.type || '');
  const id = String(body?.id || '');

  if (type === 'color') {
    // fără id / necunoscut => revenim la culoarea standard (NULL)
    const known = id && NAME_COLORS.some((c) => c.id === id);
    if (known) {
      const own = await env.DB
        .prepare('SELECT qty FROM user_items WHERE user_id = ? AND item_id = ?')
        .bind(gate.user.id, id)
        .first();
      if (!own || !(own.qty > 0)) return errorResponse(403, 'Nu deții această culoare');
    }
    await env.DB
      .prepare('UPDATE users SET active_name_color = ? WHERE id = ?')
      .bind(known ? id : null, gate.user.id)
      .run();
    return json({ success: true, active_name_color: known ? id : null });
  }

  if (type === 'theme') {
    const theme = SITE_THEMES.find((t) => t.id === id);
    if (!theme) return errorResponse(400, 'Tema nu există');
    if (theme.id !== 'theme_standard') {
      const own = await env.DB
        .prepare('SELECT qty FROM user_items WHERE user_id = ? AND item_id = ?')
        .bind(gate.user.id, theme.id)
        .first();
      if (!own || !(own.qty > 0)) return errorResponse(403, 'Nu deții această temă');
    }
    const val = theme.id === 'theme_standard' ? null : theme.id;
    await env.DB.prepare('UPDATE users SET active_theme = ? WHERE id = ?').bind(val, gate.user.id).run();
    return json({ success: true, active_theme: val });
  }

  return errorResponse(400, 'Tip necunoscut');
}
