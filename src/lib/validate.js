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
  // Acceptam fie URL absolut http(s), fie cale same-origin („/assets/img/x.jpg”)
  // pentru imaginile servite de site. `//` e respins: e URL protocol-relativ
  // si ar permite ocolirea verificarii.
  const sameOrigin = /^\/(?!\/)[^\s]+$/;
  if (coverImage && !/^https?:\/\/[^\s]+$/i.test(coverImage) && !sameOrigin.test(coverImage)) {
    return { ok: false, error: 'URL imagine invalid (trebuie să înceapă cu http/https sau cu /)' };
  }

  // --- fisa detaliata (0024), toate optionale ---
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const epDuration = input.ep_duration === null || input.ep_duration === undefined || input.ep_duration === ''
    ? null
    : Number(input.ep_duration);
  if (epDuration !== null && (!Number.isInteger(epDuration) || epDuration < 1 || epDuration > 600)) {
    return { ok: false, error: 'Durata episodului trebuie să fie între 1 și 600 de minute' };
  }

  const ageRating = str(input.age_rating, 10);
  if (ageRating && !ALLOWED_AGE_RATINGS.includes(ageRating)) {
    return { ok: false, error: `Vârsta minimă invalidă (${ALLOWED_AGE_RATINGS.join(', ')})` };
  }

  // Data lansarii: ISO (2026-10-20) sau doar an-luna (2026-10). Text liber
  // ar fi imposibil de sortat/afisat consistent.
  const releaseDate = str(input.release_date, 10);
  if (releaseDate && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(releaseDate)) {
    return { ok: false, error: 'Data lansării trebuie să fie în formatul AAAA-LL-ZZ' };
  }

  // Anuntul „episodul urmator": data ca `2026-09-14T18:00` (input datetime-local).
  const nextEpAt = str(input.next_ep_at, 16);
  if (nextEpAt && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(nextEpAt)) {
    return { ok: false, error: 'Data episodului următor trebuie să fie în formatul AAAA-LL-ZZTHH:MM' };
  }

  const externalUrl = str(input.external_url, 300);
  if (externalUrl && !/^https:\/\/[^\s]+$/i.test(externalUrl)) {
    return { ok: false, error: 'Linkul extern trebuie să înceapă cu https://' };
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
      alt_titles: str(input.alt_titles, 300),
      themes: str(input.themes, 200),
      age_rating: ageRating,
      ep_duration: epDuration,
      release_date: releaseDate,
      country: str(input.country, 40),
      external_url: externalUrl,
      team: str(input.team, 300),
      next_ep_note: str(input.next_ep_note, 120),
      next_ep_at: nextEpAt,
    },
  };
}

export const ALLOWED_AGE_RATINGS = ['G', '7+', '13+', '16+', '18+'];

export const SERIES_DETAIL_FIELDS = [
  'alt_titles', 'themes', 'age_rating', 'ep_duration', 'release_date', 'country', 'external_url', 'team',
  'next_ep_note', 'next_ep_at',
];

const SERIES_PATCH_FIELDS = ['title', 'description', 'cover_image', 'status', 'genre', 'year', ...SERIES_DETAIL_FIELDS];

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
    subtitle_url: existing.subtitle_url ?? '',
    sources: [], // sursele se gestioneaza separat, prin /api/admin/episode-sources
  };
  const provided = [];
  for (const f of ['series_id', 'episode_number', 'title', 'subtitle_url']) {
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

  // Subtitrarea e optionala: un fisier WebVTT. Acceptam o cale din acelasi
  // origin (/…) sau un URL https. Track-urile din <video> cer CORS pentru
  // domenii externe, deci same-origin e varianta care merge intotdeauna.
  let subtitleUrl = '';
  const rawSub = input.subtitle_url === undefined || input.subtitle_url === null
    ? '' : String(input.subtitle_url).trim();
  if (rawSub) {
    if (rawSub.startsWith('/')) {
      subtitleUrl = rawSub;
    } else {
      let u;
      try { u = new URL(rawSub); } catch { return { ok: false, error: 'URL de subtitrare invalid' }; }
      if (u.protocol !== 'https:') return { ok: false, error: 'Subtitrarea trebuie sa fie un URL https sau o cale din site (/…)' };
      subtitleUrl = u.href;
    }
  }

  return {
    ok: true,
    value: {
      series_id: seriesId,
      episode_number: episodeNumber,
      title,
      subtitle_url: subtitleUrl,
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
