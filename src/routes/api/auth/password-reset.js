import { errorResponse, getClientIp, isSameOrigin, json, sanitizeText } from '../../../lib/http.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { validatePassword } from '../../../lib/validate.js';
import { hashPassword, randomHex, timingSafeEqual } from '../../../lib/crypto.js';

// =====================================================================
// Recuperarea parolei, fara serviciu extern de e-mail.
//
//  1. POST /api/auth/password-reset       — solicitare publica, mereu 202
//  2. adminul verifica solicitarea si emite codul (ruta /api/admin/...)
//  3. POST /api/auth/password-reset/confirm — cod + parola noua
//
// Raspunsul de la pasul 1 e IDENTIC pentru cont existent/inexistent: altfel
// formularul ar deveni un oracle pentru adresele de e-mail ale membrilor.
// Codul real (128 biti) sta doar ca PBKDF2 + salt in D1, expira in 30 min si
// este revendicat atomic inainte sa se scrie parola noua.
// =====================================================================

const REQUEST_LIMIT = 3;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const CONFIRM_LIMIT = 10;
const CONFIRM_WINDOW_MS = 60 * 60 * 1000;
const GENERIC_MESSAGE = 'Dacă există un cont cu aceste date, solicitarea de recuperare a fost înregistrată. Un administrator o va verifica și va trimite codul la emailul contului.';

function resetCode(raw) {
  return `AUK-${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24)}`.toUpperCase();
}

function normalizeResetCode(value) {
  let code = typeof value === 'string' ? value.trim() : '';
  if (/^AUK-/i.test(code)) code = code.slice(4);
  code = code.replace(/-/g, '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(code) ? code : '';
}

/** Solicită recuperarea. Nu confirmăm niciodată dacă userul există. */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `password-reset-request:${ip}`, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Prea multe solicitări. Încearcă din nou mai târziu.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'Cerere invalidă');
  const identifier = sanitizeText(body.email || body.username || body.identifier, 254).toLowerCase();
  if (!identifier) return errorResponse(400, 'Completează emailul sau username-ul');

  try {
    const user = await env.DB
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .bind(identifier, identifier)
      .first();

    if (user?.id) {
      const now = Math.floor(Date.now() / 1000);
      // Un cod expirat nu trebuie să blocheze recuperarea următoare. Nu
      // atingem cererile pending/issued valide: indexul unic le păstrează.
      await env.DB.batch([
        env.DB
          .prepare(`UPDATE password_reset_requests
                    SET status = 'cancelled'
                    WHERE user_id = ? AND status = 'issued' AND expires_at IS NOT NULL AND expires_at <= ?`)
          .bind(user.id, now),
        env.DB
          .prepare(`INSERT OR IGNORE INTO password_reset_requests (user_id, status, requested_at)
                    VALUES (?, 'pending', ?)`)
          .bind(user.id, now),
      ]);
    }
  } catch (e) {
    // Păstrăm răspunsul anti-enumerare chiar când D1 are o problemă; eroarea
    // reală rămâne în logul Workerului pentru operator.
    console.error('POST /api/auth/password-reset esuat:', e?.message || e);
  }

  return json({ success: true, message: GENERIC_MESSAGE }, { status: 202 });
}

/** Confirmă codul emis de administrator și setează o parolă nouă. */
export async function onRequestPostConfirm(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, `password-reset-confirm:${ip}`, CONFIRM_LIMIT, CONFIRM_WINDOW_MS);
  if (!rl.ok) return tooManyRequests(rl.retryAfter, 'Prea multe încercări. Încearcă din nou mai târziu.');

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'Cerere invalidă');

  const requestId = Number(body.request_id);
  const code = normalizeResetCode(body.recovery_code);
  const next = validatePassword(body.new_password);
  if (!Number.isInteger(requestId) || requestId <= 0 || !code) {
    return errorResponse(400, 'Codul de recuperare este invalid');
  }
  if (!next.ok) return errorResponse(400, next.error);

  const now = Math.floor(Date.now() / 1000);
  let row;
  try {
    row = await env.DB
      .prepare(
        `SELECT id, user_id, token_hash, token_salt, expires_at
         FROM password_reset_requests
         WHERE id = ? AND status = 'issued' AND expires_at > ?`
      )
      .bind(requestId, now)
      .first();
  } catch (e) {
    console.error('citire reset parola esuata:', e?.message || e);
    return errorResponse(500, 'Nu am putut reseta parola');
  }

  if (!row?.token_hash || !row?.token_salt) {
    return errorResponse(400, 'Codul de recuperare este invalid sau a expirat');
  }

  let codeHash;
  try {
    codeHash = await hashPassword(code, row.token_salt);
  } catch (e) {
    console.error('hash cod reset esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut reseta parola');
  }
  if (!timingSafeEqual(codeHash, row.token_hash)) {
    return errorResponse(400, 'Codul de recuperare este invalid sau a expirat');
  }

  const claimedAt = Math.floor(Date.now() / 1000);
  const claimNonce = randomHex(16);
  const salt = randomHex(16);
  let hash;
  try {
    hash = await hashPassword(next.value, salt);

    // D1 execută batch-ul într-o tranzacție. Al doilea UPDATE este condiționat
    // de nonce-ul pus de primul, deci o cursă cu două submit-uri nu poate
    // actualiza parola decât pentru cererea care chiar a revendicat codul.
    // Ștergem și hash-ul/saltul codului de îndată ce a fost consumat.
    const result = await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE password_reset_requests
           SET status = 'completed', used_at = ?, claim_nonce = ?, token_hash = '', token_salt = ''
           WHERE id = ? AND status = 'issued' AND expires_at > ? AND token_hash = ?`
        )
        .bind(claimedAt, claimNonce, row.id, now, codeHash),
      // auth_version închide IMEDIAT toate sesiunile anterioare, inclusiv una
      // eventual rămasă pe dispozitivul de pe care a fost pierdută parola.
      env.DB
        .prepare(
          `UPDATE users
           SET password_hash = ?, password_salt = ?, auth_version = auth_version + 1
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM password_reset_requests
               WHERE id = ? AND status = 'completed' AND claim_nonce = ?
             )`
        )
        .bind(hash, salt, row.user_id, row.id, claimNonce),
    ]);
    if ((result?.[0]?.meta?.changes || 0) !== 1) {
      return errorResponse(400, 'Codul de recuperare a fost deja folosit sau a expirat');
    }
    if ((result?.[1]?.meta?.changes || 0) !== 1) {
      // Nu ar trebui să fie posibil (rândul are FK spre utilizator), dar nu
      // confirmăm resetarea dacă parola n-a fost efectiv schimbată.
      console.error('reset parola: utilizatorul nu a fost actualizat', row.user_id);
      return errorResponse(500, 'Nu am putut reseta parola');
    }
  } catch (e) {
    console.error('actualizare parola din reset esuata:', e?.message || e);
    return errorResponse(500, 'Nu am putut reseta parola');
  }

  return json({ success: true, message: 'Parola a fost resetată. Te poți autentifica cu parola nouă.' });
}

export { GENERIC_MESSAGE, normalizeResetCode, resetCode };
