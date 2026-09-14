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

const USER_COLUMNS = 'id, username, email, points, is_admin, is_banned, created_at, xp, level, gold, staff_role, rank_theme, active_name_color, active_theme, faction_slug, faction_month';

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
    xp: user.xp || 0,
    level: user.level || 1,
    gold: user.gold || 0,
    is_admin: !!user.is_admin,
    // Gradul de staff (badge) si dreptul derivat din el. Doar Moderator si
    // Admin pot modera (sterge comentariile altora); Helper/Staff au doar badge.
    staff_role: user.staff_role || '',
    can_moderate: canModerate(user),
    rank_theme: user.rank_theme || 'naruto',
    active_name_color: user.active_name_color || null,
    active_theme: user.active_theme || null,
    // Factiunea lunii: /api/factions se bazeaza pe ele ca sa stie daca esti
    // deja intr-o factiune (altfel te poti „alatura" la nesfarsit si panoul
    // de profil nu-ti arata niciodata factiunea).
    faction_slug: user.faction_slug || null,
    faction_month: user.faction_month || null,
    // Necesar paginii de profil („Membru din"). Nu e informatie sensibila —
    // e afisata public pe orice profil, spre deosebire de email, care ramane
    // filtrat de publicUser() inainte sa ajunga la client.
    created_at: user.created_at,
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
    staff_role: user.staff_role || '',
    can_moderate: canModerate(user),
    rank_theme: user.rank_theme || 'naruto',
    // Economie: nav-ul arata nivelul si gold-ul fara o cerere in plus.
    xp: user.xp || 0,
    level: user.level || 1,
    gold: user.gold || 0,
    // Cosmetice active (shop): culoarea numelui si tema site-ului.
    name_color: user.active_name_color || null,
    site_theme: user.active_theme || null,
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

/** Drepturile de moderare vin din gradul de staff: Admin sau Moderator. */
export function canModerate(user) {
  return !!(user?.is_admin || user?.staff_role === 'moderator');
}

/** Ca requireUser, dar cere drept de moderare (Admin sau Moderator). */
export async function requireModerator(request, env) {
  const gate = await requireUser(request, env);
  if (gate.response) return gate;
  if (!canModerate(gate.user)) {
    return { response: errorResponse(403, 'Doar moderatorii și administratorii pot face asta') };
  }
  return gate;
}

export async function requireAdmin(request, env) {
  const gate = await requireUser(request, env);
  if (gate.response) return gate;
  if (!gate.user.is_admin) {
    return { response: errorResponse(403, 'Doar administratorii pot face asta') };
  }
  return gate;
}
