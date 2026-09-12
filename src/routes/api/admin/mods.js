// POST /api/admin/mods — promoveaza/retrogradeaza moderatori.
// { username, is_mod: 0|1 }. Adminii raman admini indiferent.
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const username = String(body?.username || '').trim();
  const isMod = body?.is_mod ? 1 : 0;
  if (!username) return errorResponse(400, 'Username obligatoriu');

  const target = await env.DB.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').bind(username).first();
  if (!target) return errorResponse(404, 'Utilizatorul nu există');
  if (target.is_admin) return errorResponse(400, 'Adminii au deja toate drepturile');
  if (target.id === gate.user.id) return errorResponse(400, 'Nu îți poți modifica propriul rol');

  await env.DB.prepare('UPDATE users SET is_mod = ? WHERE id = ?').bind(isMod, target.id).run();
  await logAdminAction(env, gate.user, isMod ? 'promote_mod' : 'demote_mod', 'user', target.id, target.username);
  return json({ success: true, username: target.username, is_mod: isMod });
}
