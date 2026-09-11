import { hashPassword, randomHex, timingSafeEqual } from '../../../lib/crypto.js';
import { signJWT } from '../../../lib/jwt.js';
import { json, errorResponse, setAuthCookie, getClientIp, sanitizeText, isSameOrigin } from '../../../lib/http.js';
import { validateUsername, validateEmail, validatePassword } from '../../../lib/validate.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { findUsableInvite, claimInvite, assignInviteToUser, releaseInvite } from '../../../lib/invite.js';

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

  // BOOTSTRAP: primul utilizator dintr-o baza de date goala devine admin si
  // nu are nevoie de cod de invitatie. Fara exceptia asta nu ar exista nicio
  // cale de a crea primul admin — cel care, la randul lui, genereaza codurile.
  const countRes = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const isFirstUser = (countRes?.n ?? 0) === 0;

  // --- cod de invitatie (obligatoriu dupa bootstrap) ---
  // Verificarea si rezervarea codului au loc INAINTE de PBKDF2 (~4.45 ms CPU),
  // ca un cod gresit sa nu arunce pe fereastra timpul de CPU al planului gratuit.
  let invite = null;
  if (!isFirstUser) {
    const found = await findUsableInvite(env, body.invite_code);
    if (!found.ok) return errorResponse(found.status, found.error);

    // Rezervare atomica: doi oameni care trimit acelasi cod simultan nu pot
    // castiga amandoi (UPDATE conditionat de used_by IS NULL).
    const claimed = await claimInvite(env, found.row.code);
    if (!claimed) return errorResponse(409, 'Codul de invitație a fost deja folosit.');
    invite = found.row;
  }

  const salt = randomHex(16);
  let hash;
  try {
    hash = await hashPassword(password.value, salt);
  } catch (e) {
    if (invite) await releaseInvite(env, invite.code);
    console.error('hashPassword esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut crea contul');
  }

  let userId;
  try {
    const insert = await env.DB
      .prepare(
        `INSERT INTO users (username, email, password_hash, password_salt, points, is_admin, is_banned)
         VALUES (?, ?, ?, ?, 0, ?, 0)`
      )
      .bind(username.value, email.value, hash, salt, isFirstUser ? 1 : 0)
      .run();

    userId = insert.meta?.last_row_id;
    if (!userId) throw new Error('last_row_id lipsa');

    if (invite) await assignInviteToUser(env, invite.code, userId);
  } catch (e) {
    // Eliberam rezervarea ca sa nu pierdem codul utilizatorului.
    if (invite) await releaseInvite(env, invite.code);
    console.error('INSERT users esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut crea contul');
  }

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
