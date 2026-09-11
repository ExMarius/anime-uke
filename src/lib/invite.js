// =====================================================================
// Coduri de invitatie — generare si validare.
//
// Format: AU-XXXX-XXXX (10 caractere utile dintr-un alfabet fara
// caractere ambigue). Fara 0/O, 1/I/L — utilizatorii le tasteaza manual
// sau le citesc de pe Discord, iar confuziile genereaza suport inutil.
//
// Spatiu: 32^8 ≈ 1.1e12 combinatii. La 100.000 de coduri active,
// probabilitatea de coliziune ramane neglijabila, iar UNIQUE pe coloana
// `code` e plasa de siguranta finala.
// =====================================================================

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 32 chars, fara 0/O/1/I/L
const GROUPS = 2;
const GROUP_LEN = 4;
export const CODE_PREFIX = 'AU';

/** Genereaza un cod aleator de forma AU-XXXX-XXXX. */
export function generateInviteCode() {
  const bytes = new Uint8Array(GROUPS * GROUP_LEN);
  crypto.getRandomValues(bytes);

  // crypto.getRandomValues e deja uniform; % 32 pastreaza uniformitatea
  // pentru ca 256 este divizibil exact cu 32.
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);

  const parts = [];
  for (let i = 0; i < GROUPS; i++) parts.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(''));
  return `${CODE_PREFIX}-${parts.join('-')}`;
}

/**
 * Normalizeaza ce a tastat utilizatorul: majuscule, fara spatii.
// Accepta si formatul fara cratime (AUXXXXXXXX).
 * @returns {string} codul normalizat sau '' daca e invalid ca forma
 */
export function normalizeInviteCode(value) {
  if (typeof value !== 'string') return '';
  const up = value.trim().toUpperCase().replace(/\s+/g, '');
  // fara cratime -> il reconstruim
  const bare = up.replace(/-/g, '');
  const expectedLen = CODE_PREFIX.length + GROUPS * GROUP_LEN;
  if (bare.length !== expectedLen) return '';
  if (!bare.startsWith(CODE_PREFIX)) return '';
  const body = bare.slice(CODE_PREFIX.length);
  if (!new RegExp(`^[${ALPHABET}]+$`).test(body)) return '';

  const parts = [];
  for (let i = 0; i < GROUPS; i++) parts.push(body.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
  return `${CODE_PREFIX}-${parts.join('-')}`;
}

/** Verifica doar forma (nu si existenta in baza de date). */
export function isValidInviteCodeFormat(value) {
  return normalizeInviteCode(value) !== '';
}

/**
 * Cauta un cod utilizabil. Returneaza un motiv precis de respingere,
// ca sa nu dam mesaje ambigui care sa faca debugging-ul imposibil.
 * @returns {Promise<{ok:true, row:object}|{ok:false, error:string, status:number}>}
 */
export async function findUsableInvite(env, rawCode) {
  const code = normalizeInviteCode(rawCode);
  if (!code) {
    return { ok: false, status: 400, error: 'Cod de invitație invalid. Formatul corect este AU-XXXX-XXXX.' };
  }

  const row = await env.DB
    .prepare('SELECT id, code, used_by, revoked FROM invite_codes WHERE code = ?')
    .bind(code)
    .first();

  if (!row) return { ok: false, status: 404, error: 'Codul de invitație nu există.' };
  if (row.revoked) return { ok: false, status: 410, error: 'Codul de invitație a fost revocat.' };
  if (row.used_by) return { ok: false, status: 409, error: 'Codul de invitație a fost deja folosit.' };

  return { ok: true, row };
}

/**
 * Rezerva codul atomic. Doi utilizatori care trimit acelasi cod simultan
// nu pot castiga amandoi: UPDATE-ul e conditionat de `used_by IS NULL`,
// deci al doilea primeste changes = 0.
 * @returns {Promise<boolean>} true daca rezervarea a reusit
 */
export async function claimInvite(env, code) {
  const res = await env.DB
    .prepare(
      `UPDATE invite_codes SET used_at = datetime('now')
       WHERE code = ? AND used_by IS NULL AND revoked = 0`
    )
    .bind(code)
    .run();
  return (res.meta?.changes ?? 0) === 1;
}

/** Leaga codul rezervat de utilizatorul creat. */
export async function assignInviteToUser(env, code, userId) {
  await env.DB
    .prepare('UPDATE invite_codes SET used_by = ? WHERE code = ?')
    .bind(userId, code)
    .run();
}

/** Elibereaza o rezervare (daca insert-ul utilizatorului a esuat). */
export async function releaseInvite(env, code) {
  await env.DB
    .prepare(`UPDATE invite_codes SET used_at = NULL WHERE code = ? AND used_by IS NULL`)
    .bind(code)
    .run();
}
