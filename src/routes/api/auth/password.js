import { hashPassword, randomHex, timingSafeEqual } from '../../../lib/crypto.js';
import { signJWT } from '../../../lib/jwt.js';
import { errorResponse, isSameOrigin, json, setAuthCookie } from '../../../lib/http.js';
import { requireUser } from '../../../lib/session.js';
import { validatePassword } from '../../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// =====================================================================
// POST /api/auth/password — schimbarea parolei pentru un membru logat.
//
// Nu exista endpoint de „seteaza parola": trebuie demonstrata parola
// curenta. Dupa salvare incrementam auth_version si emitem un JWT nou;
// orice alt dispozitiv care avea cookie-ul vechi este deconectat la urmatoarea
// cerere. Asta conteaza mai ales daca schimbarea a fost facuta preventiv
// dupa ce utilizatorul suspecteaza ca i-a fost compromis contul.
// =====================================================================

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `password-change:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Ai încercat prea des. Încearcă din nou mai târziu.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const next = validatePassword(body.new_password);
  if (!next.ok) return errorResponse(400, next.error);
  if (!currentPassword) return errorResponse(400, 'Completează parola curentă');

  // getSessionUser nu transporta niciodata hash-uri in restul aplicatiei.
  // Le citim strict aici, dupa ce cookie-ul a demonstrat identitatea.
  const credentials = await env.DB
    .prepare('SELECT password_hash, password_salt, auth_version FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  if (!credentials?.password_hash || !credentials?.password_salt) {
    return errorResponse(500, 'Nu am putut verifica parola curentă');
  }

  let currentHash;
  try {
    currentHash = await hashPassword(currentPassword, credentials.password_salt);
  } catch (e) {
    console.error('hash parola curenta esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut schimba parola');
  }

  if (!timingSafeEqual(currentHash, credentials.password_hash)) {
    return errorResponse(401, 'Parola curentă este incorectă');
  }

  // Fara aceasta garda, schimbarea parolei cu exact aceeasi valoare ar
  // invalida inutil toate celelalte sesiuni.
  if (timingSafeEqual(await hashPassword(next.value, credentials.password_salt), credentials.password_hash)) {
    return errorResponse(400, 'Alege o parolă nouă, diferită de cea curentă');
  }

  const salt = randomHex(16);
  let hash;
  try {
    hash = await hashPassword(next.value, salt);
  } catch (e) {
    console.error('hash parola noua esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut schimba parola');
  }

  const nextVersion = Number(credentials.auth_version || 0) + 1;
  try {
    await env.DB
      .prepare('UPDATE users SET password_hash = ?, password_salt = ?, auth_version = ? WHERE id = ?')
      .bind(hash, salt, nextVersion, user.id)
      .run();
  } catch (e) {
    console.error('UPDATE parola esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut schimba parola');
  }

  const token = await signJWT(
    { id: user.id, username: user.username, auth_version: nextVersion },
    env.JWT_SECRET
  );

  return json(
    { success: true, message: 'Parola a fost schimbată. Celelalte sesiuni au fost deconectate.' },
    { headers: { 'Set-Cookie': setAuthCookie(token) } }
  );
}

export function onRequestGet() {
  return errorResponse(405, 'Metodă nepermisă');
}
