// /api/admin/mods — gradele de staff acordate manual (Helper / Staff / Moderator).
//
//   GET  → { staff: [{ id, username, role, is_admin }] } — adminii + toti cei
//          cu un grad, ca panoul „Grade" sa arate echipa curenta.
//   POST → { username, role: ''|'helper'|'staff'|'moderator' }
//
// Drepturile decurg din grad (vezi canModerate in lib/session.js): doar
// 'moderator' poate modera; Helper/Staff sunt doar badge-uri. Adminii se
// numesc din tabul Utilizatori si nu se ating de aici.
import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { STAFF_ROLES, staffRole } from '../../../lib/ranks.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  const res = await env.DB.prepare(
    `SELECT id, username, is_admin, staff_role
     FROM users
     WHERE is_admin = 1 OR staff_role <> ''
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
    role_key: u.is_admin ? 'admin' : String(u.staff_role || ''),
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

  const role = String(body?.role ?? '').trim().toLowerCase();
  if (role && !STAFF_ROLES.includes(role)) {
    return errorResponse(400, 'Grad necunoscut (helper, staff, moderator sau gol)');
  }

  const target = await env.DB.prepare('SELECT id, username, is_admin, staff_role FROM users WHERE username = ?').bind(username).first();
  if (!target) return errorResponse(404, 'Utilizatorul nu există');
  if (target.is_admin) return errorResponse(400, 'Adminii au deja toate drepturile');
  if (target.id === gate.user.id) return errorResponse(400, 'Nu îți poți modifica propriul rol');

  await env.DB.prepare('UPDATE users SET staff_role = ? WHERE id = ?').bind(role, target.id).run();

  const before = staffRole(target) || 'Membru';
  const after = staffRole({ staff_role: role }) || 'Membru';
  const action = !role ? 'demote_staff' : `grant_${role}`;
  await logAdminAction(env, gate.user, action, 'user', target.id, `${target.username}: ${before} → ${after}`);
  return json({ success: true, username: target.username, role, staff: after === 'Membru' ? '' : after, can_moderate: role === 'moderator' });
}
