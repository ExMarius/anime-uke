// =====================================================================
// Sesiune — rezolva utilizatorul curent din cookie-ul HttpOnly.
//
// PUNCT CHEIE vs. v1: in v1 datele utilizatorului veneau din localStorage
// si dintr-un cookie pe care JS nici nu-l putea citi (HttpOnly), deci nav-ul
// ramanea vesnic pe „neautentificat". Aici singura sursa de adevar e DB-ul.
//
// Verificarea is_banned se face la FIECARE request, nu doar la login —
// altfel un utilizator banat ramane activ pana expira tokenul.
// =====================================================================

import { verifyJWT } from './jwt.js';
import { getCookie, clearAuthCookie, errorResponse, COOKIE_NAME } from './http.js';

const USER_COLUMNS = 'id, username, email, points, is_admin, is_banned, created_at';

/**
 * @returns {Promise<object|null>} user din DB sau null
 */
export async function getSessionUser(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return null;

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || typeof payload.id !== 'number') return null;

  const user = await env.DB
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(payload.id)
    .first();

  if (!user) return null;
  if (user.is_banned) return null; // banat => sesiune invalida

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    points: user.points,
    is_admin: !!user.is_admin,
  };
}

/** Forma serializabila pentru /api/auth/me — NU include email catre straini. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    points: user.points,
    is_admin: user.is_admin,
  };
}

/**
 * Gate pentru rute care necesita autentificare.
 * @returns {{user: object}|{response: Response}}
 */
export async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    // Stergem cookie-ul daca exista dar e invalid/expirat/utilizator banat,
    // ca sa nu ramana clientul intr-o bucla de „parca sunt logat".
    const hadCookie = !!getCookie(request, COOKIE_NAME);
    return {
      response: errorResponse(401, 'Trebuie să fii autentificat', hadCookie ? { 'Set-Cookie': clearAuthCookie() } : {}),
    };
  }
  return { user };
}

export async function requireAdmin(request, env) {
  const gate = await requireUser(request, env);
  if (gate.response) return gate;
  if (!gate.user.is_admin) {
    return { response: errorResponse(403, 'Doar administratorii pot face asta') };
  }
  return gate;
}
