// /api/admin/mods — gradele de staff acordate manual (Helper / Staff / Moderator).
//
//   GET  → { staff: [{ id, username, role, is_admin }] } — adminii + toti cei
//          cu un grad, ca panoul „Grade" sa arate echipa curenta.
//   POST → { username, role: ''|'helper'|'staff'|'moderator' }
//          (compat: { username, is_mod: 0|1 } = moderator / nimic)
//
// Drepturile de moderare raman legate de is_mod, pe care il sincronizam
// aici: doar „moderator" il pune pe 1. Helper/Staff sunt doar badge-uri.
// Adminii raman admini indiferent (se schimba din tabul Utilizatori).
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { STAFF_ROLES, staffRole } from '../../../lib/ranks.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const res = await env.DB.prepare(
    `SELECT id, username, is_admin, is_mod, staff_role
     FROM users
     WHERE is_admin = 1 OR is_mod = 1 OR staff_role <> ''
     ORDER BY is_admin DESC,
              CASE staff_role WHEN 'moderator' THEN 3 WHEN 'staff' THEN 2 WHEN 'helper' THEN 1 ELSE 0 END DESC,
              username ASC
     LIMIT 200`
  ).all();

  const staff = (res.results || []).map((u) => ({
    id: u.id,
    username: u.username,
    is_admin: !!u.is_admin,
    role: staffRole(u),
    role_key: u.is_admin ? 'admin' : (u.is_mod && !u.staff_role ? 'moderator' : String(u.staff_role || '')),
  }));
  return json({ staff, roles: STAFF_ROLES });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const username = String(body?.username || '').trim();
  if (!username) return errorResponse(400, 'Username obligatoriu');

  // rolul: explicit (role) sau compat vechi (is_mod)
  let role;
  if (body?.role !== undefined && body?.role !== null) {
    role = String(body.role).trim().toLowerCase();
    if (role === 'none' || role === 'member') role = '';
  } else {
    role = body?.is_mod ? 'moderator' : '';
  }
  if (role && !STAFF_ROLES.includes(role)) {
    return errorResponse(400, 'Grad necunoscut (helper, staff, moderator sau gol)');
  }
  const isMod = role === 'moderator' ? 1 : 0;

  const target = await env.DB.prepare('SELECT id, username, is_admin, is_mod, staff_role FROM users WHERE username = ?').bind(username).first();
  if (!target) return errorResponse(404, 'Utilizatorul nu există');
  if (target.is_admin) return errorResponse(400, 'Adminii au deja toate drepturile');
  if (target.id === gate.user.id) return errorResponse(400, 'Nu îți poți modifica propriul rol');

  await env.DB.prepare('UPDATE users SET is_mod = ?, staff_role = ? WHERE id = ?').bind(isMod, role, target.id).run();

  const before = staffRole(target) || 'Membru';
  const after = staffRole({ is_mod: isMod, staff_role: role }) || 'Membru';
  const action = !role ? 'demote_staff' : `grant_${role}`;
  await logAdminAction(env, gate.user, action, 'user', target.id, `${target.username}: ${before} → ${after}`);
  return json({ success: true, username: target.username, role, is_mod: isMod, staff: staffRole({ is_mod: isMod, staff_role: role }) });
}
