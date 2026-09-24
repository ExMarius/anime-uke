// GET/POST /api/admin/season — tema de sezon globala (doar admin).
// GET → { seasonal_theme: id|null, available: [{id, name}] }.
// POST { theme_id: ''|<id sezon> } → seteaza/goleste + log in jurnal.
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { getSeasonalTheme, setSeasonalTheme, seasonalThemes } from '../../../lib/season.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const list = seasonalThemes().map((t) => ({ id: t.id, name: t.name }));
  return json({ seasonal_theme: await getSeasonalTheme(env), available: list });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-season:${admin.id}`, 60, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }
  const themeId = String(body.theme_id ?? '');
  try {
    const v = await setSeasonalTheme(env, themeId);
    // Setarea e GLOBALA: toata lumea trece pe sezon, deci temele personale
    // ACTIVE se reseteaza (ce e cumparat NU se pierde — ramane in user_items,
    // iar cine nu place sezonul isi alege singur alta, care bate sezonul).
    let resetati = 0;
    if (v) {
      const r = await env.DB.prepare('UPDATE users SET active_theme = NULL WHERE active_theme IS NOT NULL').run();
      resetati = r?.meta?.changes ?? 0;
    }
    await logAdminAction(env, admin, 'set_seasonal', 'site', 0, `${v || '(gol)'} | resetati: ${resetati}`);
    return json({ success: true, seasonal_theme: v, reset_users: resetati });
  } catch {
    return errorResponse(400, 'Tema de sezon invalida (alege din lista sau gol)');
  }
}
