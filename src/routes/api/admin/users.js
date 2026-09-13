import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// =====================================================================
// /api/admin/users — gestionarea utilizatorilor din panoul admin.
//
// Actiuni: set_role (admin/user) · set_ban (true/false) · delete
//
// GARANTII din spec + doua plase de siguranta adaugate:
//  1. Nu iti poti modifica propriul cont (altfel un admin s-ar putea
//     debana/demota singur din greseala si ar bloca panoul).
//  2. Nu poti demota sau bana ULTIMUL admin ramas — altfel nimeni nu ar
//     mai putea intra vreodata in /admin.html.
// =====================================================================

const ALLOWED_ACTIONS = ['set_role', 'set_ban', 'delete', 'set_gold'];

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    // NU selectam password_hash/password_salt — nu exista niciun motiv
    // sa paraseasca baza de date. (In v1 /api/admin returna si emailurile
    // catre un tabel care nici macar nu le afisa.)
    const res = await env.DB.prepare(
      `SELECT id, username, email, points, is_admin, is_banned, created_at, last_login_at
       FROM users ORDER BY id ASC LIMIT 1000`
    ).all();
    return json({ users: res.results || [], you: gate.user.id });
  } catch (e) {
    console.error('GET /api/admin/users esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca utilizatorii');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-users:${admin.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const action = String(body.action || '');
  if (!ALLOWED_ACTIONS.includes(action)) {
    return errorResponse(400, 'Acțiune necunoscută');
  }

  const target = validatePositiveInt(body.user_id, 'ID-ul utilizatorului');
  if (!target.ok) return errorResponse(400, target.error);

  // --- Regula 1: nu iti poti modifica propriul cont ---
  if (target.value === admin.id) {
    return errorResponse(400, 'Nu îți poți modifica propriul cont');
  }

  const user = await env.DB
    .prepare('SELECT id, username, is_admin, is_banned FROM users WHERE id = ?')
    .bind(target.value)
    .first();
  if (!user) return errorResponse(404, 'Utilizatorul nu există');

  try {
    if (action === 'set_role') {
      const makeAdmin = body.value === true || body.value === 'admin' || body.value === 1;

      // --- Regula 2: nu demota ultimul admin ---
      if (!makeAdmin && user.is_admin) {
        const admins = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').first();
        if ((admins?.n ?? 0) <= 1) {
          return errorResponse(400, 'Nu poți demota ultimul administrator');
        }
      }

      await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?')
        .bind(makeAdmin ? 1 : 0, target.value).run();

      await logAdminAction(env, admin, makeAdmin ? 'promote_admin' : 'demote_user', 'user', target.value, user.username);
      return json({ success: true, action, username: user.username, is_admin: makeAdmin });
    }

    if (action === 'set_gold') {
      // Delta de gold (poate fi negativa). Suport: compenseaza utilizatorii
      // cand o sursa a fost stricata mult timp, testeaza shop-ul in e2e.
      const delta = Number(body.value);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
        return errorResponse(400, 'Valoare invalidă pentru gold');
      }
      await env.DB
        .prepare('UPDATE users SET gold = MAX(0, gold + ?) WHERE id = ?')
        .bind(delta, target.value)
        .run();
      const fresh = await env.DB.prepare('SELECT gold FROM users WHERE id = ?').bind(target.value).first();
      await logAdminAction(env, admin, 'adjust_gold', 'user', target.value, `${user.username} ${delta > 0 ? '+' : ''}${delta}`);
      return json({ success: true, action, username: user.username, gold: fresh?.gold || 0 });
    }

    if (action === 'set_ban') {
      const ban = body.value === true || body.value === 1 || body.value === 'ban';

      // --- Regula 2: nu bana ultimul admin ---
      if (ban && user.is_admin) {
        const admins = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND is_banned = 0').first();
        if ((admins?.n ?? 0) <= 1) {
          return errorResponse(400, 'Nu poți bana ultimul administrator activ');
        }
      }

      await env.DB.prepare('UPDATE users SET is_banned = ? WHERE id = ?')
        .bind(ban ? 1 : 0, target.value).run();

      await logAdminAction(env, admin, ban ? 'ban_user' : 'unban_user', 'user', target.value, user.username);
      return json({ success: true, action, username: user.username, is_banned: ban });
    }

    if (action === 'delete') {
      // --- Regula 2: nu sterge ultimul admin ---
      if (user.is_admin) {
        const admins = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').first();
        if ((admins?.n ?? 0) <= 1) {
          return errorResponse(400, 'Nu poți șterge ultimul administrator');
        }
      }

      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.value).run();
      await logAdminAction(env, admin, 'delete_user', 'user', target.value, user.username);
      return json({ success: true, action, username: user.username });
    }
  } catch (e) {
    console.error(`POST /api/admin/users (${action}) esuat:`, e?.message || e);
    return errorResponse(500, 'Operațiunea a eșuat');
  }

  return errorResponse(400, 'Acțiune necunoscută');
}
