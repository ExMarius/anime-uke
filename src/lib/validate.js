// =====================================================================
// Validare input. Fiecare functie returneaza { ok, value } sau { ok:false, error }.
// In v1 nu exista NICIO validare — orice string mergea direct in DB.
// =====================================================================

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Cerinta explicita din spec: minim 4 caractere.
// ATENTIE: la 4 caractere contul e spart de orice lista de parole comune.
// Schimba intr-un singur loc daca vrei mai strict (recomandat: 8).
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;

export function validateUsername(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < 3 || v.length > 20) {
    return { ok: false, error: 'Username-ul trebuie să aibă între 3 și 20 de caractere' };
  }
  if (!USERNAME_RE.test(v)) {
    return { ok: false, error: 'Username-ul poate conține doar litere, cifre, punct, liniuță și underscore' };
  }
  return { ok: true, value: v };
}

export function validateEmail(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v.length > 254 || !EMAIL_RE.test(v)) {
    return { ok: false, error: 'Email invalid' };
  }
  return { ok: true, value: v };
}

export function validatePassword(value) {
  const v = typeof value === 'string' ? value : '';
  if (v.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Parola trebuie să aibă minim ${MIN_PASSWORD_LENGTH} caractere` };
  }
  if (v.length > MAX_PASSWORD_LENGTH) {
    // Previne abuz de CPU: o parola de 1 MB ar face PBKDF2 inutil de scump.
    return { ok: false, error: `Parola trebuie să aibă maxim ${MAX_PASSWORD_LENGTH} caractere` };
  }
  return { ok: true, value: v };
}

const ALLOWED_STATUS = ['ongoing', 'completed'];

export function validateSeries(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > 200) {
    return { ok: false, error: 'Titlul trebuie să aibă între 1 și 200 de caractere' };
  }

  const status = input.status || 'ongoing';
  if (!ALLOWED_STATUS.includes(status)) {
    return { ok: false, error: 'Status invalid (ongoing sau completed)' };
  }

  const year = input.year === null || input.year === undefined || input.year === ''
    ? null
    : Number(input.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    return { ok: false, error: 'An invalid' };
  }

  const coverImage = typeof input.cover_image === 'string' ? input.cover_image.trim() : '';
  if (coverImage && !/^https?:\/\/[^\s]+$/i.test(coverImage)) {
    return { ok: false, error: 'URL imagine invalid (trebuie să înceapă cu http/https)' };
  }

  return {
    ok: true,
    value: {
      title,
      description: typeof input.description === 'string' ? input.description.trim().slice(0, 2000) : '',
      cover_image: coverImage.slice(0, 500),
      status,
      genre: typeof input.genre === 'string' ? input.genre.trim().slice(0, 100) : '',
      year,
    },
  };
}

/**
 * DoodStream: accepta atat link-ul de embed (/e/xxx) cat si pe cel de
 * download (/d/xxx) si le normalizeaza la /e/xxx, care e cel embed-abil.
 */
export function validateDoodstreamUrl(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return { ok: false, error: 'URL DoodStream obligatoriu' };

  let url;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, error: 'URL invalid' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'URL-ul trebuie să fie https' };
  }

  const host = url.hostname.toLowerCase();
  const isDood = /(^|\.)dood(stream)?\.[a-z]+$/.test(host) || /(^|\.)dood\.[a-z]{2,}$/.test(host);
  if (!isDood) {
    return { ok: false, error: 'Doar link-uri DoodStream sunt permise' };
  }

  const m = url.pathname.match(/^\/[ed]\/([A-Za-z0-9]+)$/);
  if (!m) {
    return { ok: false, error: 'Format așteptat: https://doodstream.com/e/xxxx' };
  }

  return { ok: true, value: `https://${host}/e/${m[1]}` };
}

export function validateEpisode(input) {
  const seriesId = Number(input.series_id);
  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    return { ok: false, error: 'Serie invalidă' };
  }

  const episodeNumber = Number(input.episode_number);
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 10000) {
    return { ok: false, error: 'Numărul episodului trebuie să fie între 1 și 10000' };
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length > 200) {
    return { ok: false, error: 'Titlu prea lung (max 200 caractere)' };
  }

  const url = validateDoodstreamUrl(input.doodstream_url);
  if (!url.ok) return url;

  return { ok: true, value: { series_id: seriesId, episode_number: episodeNumber, title, doodstream_url: url.value } };
}

export function validatePositiveInt(value, name = 'ID') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: `${name} invalid` };
  }
  return { ok: true, value: n };
}

export function validateChatMessage(value) {
  const v = typeof value === 'string' ? value : '';
  // Fara control chars; limita dura de lungime (previne flood + bloat in D1).
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!cleaned) return { ok: false, error: 'Mesaj gol' };
  if (cleaned.length > 500) return { ok: false, error: 'Mesaj prea lung (max 500 caractere)' };
  return { ok: true, value: cleaned };
}
