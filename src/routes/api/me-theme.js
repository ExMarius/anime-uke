// POST /api/me/theme — fiecare om isi alege tema de grade (Naruto,
// One Piece, Hunter x Hunter sau una adaugata de admin).
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `theme:${gate.user.id}`, 10, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const slug = String(body?.theme || '').trim().toLowerCase().slice(0, 40);
  const themes = await loadRankThemes(env);
  if (!themes.some((t) => t.slug === slug)) return errorResponse(400, 'Tema nu există');

  await env.DB.prepare('UPDATE users SET rank_theme = ? WHERE id = ?').bind(slug, gate.user.id).run();
  const fresh = { ...gate.user, rank_theme: slug };
  return json({ success: true, me: identity(fresh, themes) });
}
