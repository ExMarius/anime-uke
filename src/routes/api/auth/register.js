import { hashPassword, randomHex, timingSafeEqual } from '../../../lib/crypto.js';
import { signJWT } from '../../../lib/jwt.js';
import { json, errorResponse, setAuthCookie, getClientIp, sanitizeText, isSameOrigin } from '../../../lib/http.js';
import { validateUsername, validateEmail, validatePassword } from '../../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// Register: max 5 conturi/ora per IP. Previne crearea automata de conturi,
// care altfel ar umple D1 gratuit (500 MB) si ar putea depasi cota de scrieri.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `register:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Prea multe conturi create. Încearcă mai târziu.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const username = validateUsername(sanitizeText(body.username, 20));
  if (!username.ok) return errorResponse(400, username.error);

  const email = validateEmail(sanitizeText(body.email, 254));
  if (!email.ok) return errorResponse(400, email.error);

  const password = validatePassword(body.password);
  if (!password.ok) return errorResponse(400, password.error);

  // Verificam duplicatele explicit, ca sa putem da un mesaj util.
  // In v1 orice eroare de DB (inclusiv una de schema) era raportata ca
  // „utilizatorul exista deja", ceea ce facea debugging-ul imposibil.
  const existing = await env.DB
    .prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?')
    .bind(username.value, email.value)
    .first();

  if (existing) {
    const field = existing.email === email.value ? 'Email-ul' : 'Username-ul';
    return errorResponse(409, `${field} este deja folosit`);
  }

  const salt = randomHex(16);
  const hash = await hashPassword(password.value, salt);

  // BOOTSTRAP: primul utilizator dintr-o baza de date goala devine admin.
  // Fara asta nu ar exista nicio cale de a crea primul admin. Se intampla
  // o singura data (cat timp users e gol) si e consemnat in admin_log.
  const countRes = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const isFirstUser = (countRes?.n ?? 0) === 0;

  const insert = await env.DB
    .prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, points, is_admin, is_banned)
       VALUES (?, ?, ?, ?, 0, ?, 0)`
    )
    .bind(username.value, email.value, hash, salt, isFirstUser ? 1 : 0)
    .run();

  const userId = insert.meta?.last_row_id;
  if (!userId) return errorResponse(500, 'Nu am putut crea contul');

  if (isFirstUser) {
    await env.DB
      .prepare(
        `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
         VALUES (?, ?, 'bootstrap_admin', 'user', ?, 'Primul utilizator a fost facut admin automat')`
      )
      .bind(userId, username.value, userId)
      .run();
  }

  const token = await signJWT({ id: userId, username: username.value }, env.JWT_SECRET);

  return json(
    { user: { id: userId, username: username.value, points: 0, is_admin: isFirstUser } },
    { status: 201, headers: { 'Set-Cookie': setAuthCookie(token) } }
  );
}

export function onRequestGet() {
  return errorResponse(405, 'Metodă nepermisă');
}
