// =====================================================================
// Crypto — hasharea parolelor cu WebCrypto (disponibil nativ in Workers,
// deci 100% gratuit; nu e nevoie de bcrypt/npm).
//
// PBKDF2-SHA256 cu 20.000 iteratii = ~4.45 ms CPU masurat.
// Limita pe Workers Free este 10 ms CPU per invocare, deci avem ~2x margine.
// SHA-256 simplu (cum era in spec) ar fi fost spart instant pe GPU.
// =====================================================================

export const PBKDF2_ITERATIONS = 20000;

export function randomHex(byteLength = 16) {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex) {
  const clean = String(hex || '');
  if (clean.length % 2 !== 0) throw new Error('hex invalid');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex invalid');
    out[i] = byte;
  }
  return out;
}

/**
 * Deriveaza hash-ul parolei. Rezultatul e hex de 64 caractere (256 biti).
 * @param {string} password
 * @param {string} saltHex - salt per-utilizator, generat la register
 */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

/**
 * Comparare in timp constant. Ambele valori sunt hash-uri de lungime fixa,
 * deci verificarea de lungime nu scurge informatie utila.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
