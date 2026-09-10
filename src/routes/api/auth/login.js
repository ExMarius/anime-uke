import { hashPassword, randomHex, timingSafeEqual } from '../../../lib/crypto.js';
import { signJWT } from '../../../lib/jwt.js';
import { json, errorResponse, setAuthCookie, getClientIp, sanitizeText, isSameOrigin } from '../../../lib/http.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';

// Brute-force: 10 incercari la 5 minute per IP.
// Per-IP (nu per-cont) ca sa nu permitem atacul distribuit pe un singur cont.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;

// Mesaj identic pentru „user inexistent" si „parola gresita".
// Altfel atacatorul poate enumera ce conturi exista.
const GENERIC_ERROR = 'Email sau parolă incorecte';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `login:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Prea multe încercări de autentificare. Încearcă peste 5 minute.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  // Spec-ul cere login cu email. Acceptam si username ca si comoditate —
  // nu schimba cu nimic suprafata de atac (aceeasi verificare de parola).
  const identifier = sanitizeText(body.email || body.username || body.identifier, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier || !password) {
    return errorResponse(400, 'Completează email-ul și parola');
  }

  const user = await env.DB
    .prepare(
      `SELECT id, username, email, password_hash, password_salt, points, is_admin, is_banned
       FROM users WHERE email = ? OR username = ?`
    )
    .bind(identifier, identifier)
    .first();

  if (!user) {
    // Egalizam timpul de raspuns: fara asta, un cont inexistent raspunde
    // instant iar unul existent dupa ~4.5 ms (PBKDF2) = oracle de enumerare.
    await hashPassword(password, randomHex(16));
    return errorResponse(401, GENERIC_ERROR);
  }

  const candidate = await hashPassword(password, user.password_salt);
  if (!timingSafeEqual(candidate, user.password_hash)) {
    return errorResponse(401, GENERIC_ERROR);
  }

  if (user.is_banned) {
    // Aici mesajul POATE fi diferit: parola e deja corecta, deci nu mai
    // exista risc de enumerare prin acest raspuns.
    return errorResponse(403, 'Contul tău este banat. Contactează un administrator.');
  }

  const token = await signJWT({ id: user.id, username: user.username }, env.JWT_SECRET);

  // Actualizam last_login_at „best effort" — un esec nu trebuie sa blocheze login-ul.
  await env.DB
    .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(user.id)
    .run()
    .catch(() => {});

  return json(
    {
      user: {
        id: user.id,
        username: user.username,
        points: user.points,
        is_admin: !!user.is_admin,
      },
    },
    { headers: { 'Set-Cookie': setAuthCookie(token) } }
  );
}

export function onRequestGet() {
  return errorResponse(405, 'Metodă nepermisă');
}
