// =====================================================================
// JWT — HS256 semnat/verificat cu WebCrypto.
// Spre deosebire de v1: tokenurile au ACUM camp `exp` si sunt validate.
// (In v1 tokenul nu expira niciodata.)
// =====================================================================

import { timingSafeEqual } from './crypto.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 zile

function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

/**
 * @param {object} payload - NU pune date sensibile (parola, email complet) aici
 * @param {string} secret
 * @param {number} [ttlSeconds]
 */
export async function signJWT(payload, secret, ttlSeconds = TOKEN_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };

  const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims = b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const data = `${header}.${claims}`;

  const key = await hmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  return `${data}.${b64urlEncode(sig)}`;
}

/**
 * Verifica semnatura SI expirarea. Returneaza payload-ul sau null.
 * Nu arunca exceptii — apelantul primeste null pentru orice token invalid.
 */
export async function verifyJWT(token, secret) {
  try {
    if (typeof token !== 'string' || !token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, claimsB64, sigB64] = parts;

    const key = await hmacKey(secret, 'verify');
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(`${headerB64}.${claimsB64}`)
    );
    if (!valid) return null;

    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)));
    if (header.alg !== 'HS256') return null; // respinge alg:none / confuzie de algoritm

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(claimsB64)));

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.iat === 'number' && payload.iat > now + 60) return null; // ceas in viitor

    return payload;
  } catch {
    return null;
  }
}

export { TOKEN_TTL_SECONDS };
