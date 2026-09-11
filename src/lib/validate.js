// =====================================================================
// Validare input. Fiecare functie returneaza { ok, value } sau { ok:false, error }.
// In v1 nu exista NICIO validare — orice string mergea direct in DB.
// =====================================================================

import { validateSourceList } from './sources.js';

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

const SERIES_PATCH_FIELDS = ['title', 'description', 'cover_image', 'status', 'genre', 'year'];

/**
 * Validare partiala pentru editarea unei serii.
 *
 * Combineaza campurile trimise cu randul existent si reuseste validateSeries()
 * pe obiectul rezultat. Astfel regulile raman intr-un singur loc: daca maine
 * schimbam limita de lungime a titlului, se aplica si la creare si la editare.
 *
 * Intoarcem doar campurile care chiar s-au schimbat, ca UPDATE-ul sa nu
// atinga coloane identice (si sa nu apara modificari fantoma in audit).
 */
export function validateSeriesPatch(input, existing) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Cerere invalidă' };

  const merged = { ...existing };
  const provided = [];
  for (const f of SERIES_PATCH_FIELDS) {
    if (input[f] !== undefined) { merged[f] = input[f]; provided.push(f); }
  }
  if (!provided.length) return { ok: true, value: {}, provided: [] };

  const v = validateSeries(merged);
  if (!v.ok) return v;

  const value = {};
  for (const f of provided) {
    const nv = v.value[f];
    if (nv !== existing[f]) value[f] = nv;
  }
  return { ok: true, value, provided };
}

/** Validare partiala pentru editarea unui episod (titlu, numar, serie). */
export function validateEpisodePatch(input, existing) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Cerere invalidă' };

  const merged = {
    series_id: existing.series_id,
    episode_number: existing.episode_number,
    title: existing.title,
    sources: [], // sursele se gestioneaza separat, prin /api/admin/episode-sources
  };
  const provided = [];
  for (const f of ['series_id', 'episode_number', 'title']) {
    if (input[f] !== undefined) { merged[f] = input[f]; provided.push(f); }
  }
  if (!provided.length) return { ok: true, value: {}, provided: [] };

  const v = validateEpisode(merged);
  if (!v.ok) return v;

  const value = {};
  for (const f of provided) {
    if (v.value[f] !== existing[f]) value[f] = v.value[f];
  }
  return { ok: true, value, provided };
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

  // Sursele video stau in tabelul lor. Acceptam si vechiul camp
  // `doodstream_url` ca alias, ca sa nu spargem clientii/testele existente:
  // un singur URL devine o singura sursa de tip embed.
  let sourcesInput = input.sources;
  if (sourcesInput === undefined || sourcesInput === null) {
    const legacy = typeof input.doodstream_url === 'string' ? input.doodstream_url.trim() : '';
    sourcesInput = legacy ? [{ label: 'DoodStream', kind: 'embed', url: legacy }] : [];
  }

  const sources = validateSourceList(sourcesInput);
  if (!sources.ok) return sources;

  return {
    ok: true,
    value: {
      series_id: seriesId,
      episode_number: episodeNumber,
      title,
      sources: sources.value,
    },
  };
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
