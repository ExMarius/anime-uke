// Validari pentru campurile de profil. Toate campurile sunt optionale:
// un utilizator isi poate completa doar ce vrea.

import { sanitizeText } from './http.js';

const GENDERS = new Set(['', 'male', 'female', 'other']);
const MAX = {
  country: 60,
  motto: 200,
  faction: 40,
  avatar_url: 500,
  mal_url: 300,
};

/** Data nasterii: ISO YYYY-MM-DD, nu in viitor, varsta plauzibila. */
export function validateBirthDate(value) {
  const raw = sanitizeText(value, 10).trim();
  if (!raw) return { ok: true, value: '' };

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { ok: false, error: 'Data nașterii trebuie să fie în formatul AAAA-LL-ZZ.' };

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, error: 'Data nașterii este invalidă.' };

  // Verificam ca ziua sa existe realmente in luna respecta (ex. 31 februarie)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: 'Data nașterii este invalidă.' };
  }

  const now = Date.now();
  if (d.getTime() > now) return { ok: false, error: 'Data nașterii nu poate fi în viitor.' };

  const age = (now - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 6) return { ok: false, error: 'Trebuie să ai cel puțin 6 ani.' };
  if (age > 120) return { ok: false, error: 'Data nașterii nu este plauzibilă.' };

  return { ok: true, value: raw };
}

export function validateGender(value) {
  const g = sanitizeText(value, 10).trim().toLowerCase();
  if (!GENDERS.has(g)) return { ok: false, error: 'Gen invalid.' };
  return { ok: true, value: g };
}

/** MyAnimeList — acceptam doar domeniul real, ca sa nu devina camp de spam. */
export function validateMalUrl(value) {
  const raw = sanitizeText(value, MAX.mal_url).trim();
  if (!raw) return { ok: true, value: '' };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, error: 'Link MyAnimeList invalid.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Link MyAnimeList invalid.' };
  if (!/(^|\.)myanimelist\.net$/i.test(u.hostname)) {
    return { ok: false, error: 'Se acceptă doar link-uri către myanimelist.net.' };
  }
  return { ok: true, value: u.href };
}

export function validateAvatarUrl(value) {
  const raw = sanitizeText(value, MAX.avatar_url).trim();
  if (!raw) return { ok: true, value: '' };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, error: 'URL avatar invalid.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'URL avatar invalid.' };
  return { ok: true, value: u.href };
}

/** Validare completa pentru PATCH /api/profile. Intoarce doar campurile primite. */
export function validateProfilePatch(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cerere invalidă' };

  const out = {};

  if ('birth_date' in body) {
    const v = validateBirthDate(body.birth_date);
    if (!v.ok) return v;
    out.birth_date = v.value;
  }
  if ('gender' in body) {
    const v = validateGender(body.gender);
    if (!v.ok) return v;
    out.gender = v.value;
  }
  if ('country' in body) out.country = sanitizeText(body.country, MAX.country).trim();
  if ('motto' in body) out.motto = sanitizeText(body.motto, MAX.motto).trim();
  if ('faction' in body) out.faction = sanitizeText(body.faction, MAX.faction).trim();
  if ('mal_url' in body) {
    const v = validateMalUrl(body.mal_url);
    if (!v.ok) return v;
    out.mal_url = v.value;
  }
  if ('avatar_url' in body) {
    const v = validateAvatarUrl(body.avatar_url);
    if (!v.ok) return v;
    out.avatar_url = v.value;
  }

  const keys = Object.keys(out);
  if (!keys.length) return { ok: false, error: 'Niciun câmp de actualizat.' };

  return { ok: true, value: out };
}
