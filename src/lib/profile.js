// Validari pentru campurile de profil. Toate campurile sunt optionale:
// un utilizator isi poate completa doar ce vrea.

import { sanitizeText } from './http.js';

/** Etichetele afisate pe profil; cheile sunt singurele valori acceptate. */
export const GENDER_LABELS = { '': 'Nespecificat', male: 'Masculin', female: 'Feminin', other: 'Altul' };
const GENDERS = new Set(Object.keys(GENDER_LABELS));
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

/**
 * Linkurile „de pagina" (ex. https://tenor.com/xyz.gif deschid o pagina
 * HTML cu GIF-ul in ea, nu fisierul) nu merg ca <img>. Rezolvatorul:
 *   1. descarca pagina; daca raspunsul e deja imagine, e gata;
 *   2. daca e HTML, aduna candidati: og:image / twitter:image / contentUrl;
 *   3. pentru Tenor adauga si varianta TRANSFORMATA: og:image-ul oficial
 *      arata spre media1.tenor.com/m/<id>/<fisier> — host vechi care da
 *      404. Forma vie e media.tenor.com/<id>/<fisier> (fara /m/, fara
 *      cifra din host). Verificat pe productie: 200 image/gif.
 *   4. HEAD-uieste candidatii pana gaseste unul care chiar e imagine.
 * Nimic nu pica: daca totul esueaza pastrem URL-ul original — clientul are
 * oricum fallback pe initiala. Ruleaza DOAR la salvarea profilului.
 */
function tenorVariants(u) {
  const m = /^(https?:\/\/)media\d?\.tenor\.com\/m\/([^/]+)\/([^/?#]+)/i.exec(u);
  if (m) return [`${m[1]}media.tenor.com/${m[2]}/${m[3]}`, u];
  return [u];
}

async function headIsImage(u) {
  try {
    const h = await fetch(u, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; anime-uke avatar resolver)' },
    });
    return (h.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

export async function resolveAvatarUrl(rawUrl) {
  let res;
  try {
    res = await fetch(rawUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; anime-uke avatar resolver)' },
    });
  } catch {
    return { ok: true, value: rawUrl };
  }

  try {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) return { ok: true, value: res.url || rawUrl };

    if (ct.includes('text/html')) {
      const html = (await res.text()).slice(0, 400000);
      const found = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1]
        || html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/"contentUrl"\s*:\s*"(https:[^"]+?\.(?:gif|png|jpe?g|webp))"/i)?.[1];

      if (found) {
        const direct = new URL(found, res.url || rawUrl);
        if (direct.protocol === 'https:' || direct.protocol === 'http:') {
          // Verificam pana la 4 variante; prima imagine reala castiga.
          for (const cand of tenorVariants(direct.href).slice(0, 4)) {
            if (await headIsImage(cand)) return { ok: true, value: cand };
          }
          return { ok: true, value: direct.href };
        }
      }
    }
  } catch { /* pastram originalul */ }
  return { ok: true, value: rawUrl };
}

// ---------------------------------------------------------------------
// Prezentare: zodie, data in format romanesc, varsta.
// ---------------------------------------------------------------------
const ZODIAC = [
  { from: [1, 20],  to: [2, 18],  ro: 'Vărsător' },
  { from: [2, 19],  to: [3, 20],  ro: 'Pești' },
  { from: [3, 21],  to: [4, 19],  ro: 'Berbec' },
  { from: [4, 20],  to: [5, 20],  ro: 'Taur' },
  { from: [5, 21],  to: [6, 20],  ro: 'Gemeni' },
  { from: [6, 21],  to: [7, 22],  ro: 'Rac' },
  { from: [7, 23],  to: [8, 22],  ro: 'Leu' },
  { from: [8, 23],  to: [9, 22],  ro: 'Fecioară' },
  { from: [9, 23],  to: [10, 22], ro: 'Balanță' },
  { from: [10, 23], to: [11, 21], ro: 'Scorpion' },
  { from: [11, 22], to: [12, 21], ro: 'Săgetător' },
  { from: [12, 22], to: [1, 19],  ro: 'Capricorn' },
];

/** Zodia dintr-o data ISO (YYYY-MM-DD); '' la intrare invalida (camp optional). */
export function getZodiac(birthDate) {
  if (!birthDate || typeof birthDate !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!m) return '';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  for (const z of ZODIAC) {
    const [fm, fd] = z.from;
    const [tm, td] = z.to;
    const after = month > fm || (month === fm && day >= fd);
    const before = month < tm || (month === tm && day <= td);
    // Capricornul trece peste Anul Nou (22.12 → 19.01): „dupa SAU inainte".
    if (fm <= tm ? (after && before) : (after || before)) return z.ro;
  }
  return '';
}

/** YYYY-MM-DD → ZZ.LL.AAAA (formatul afisat pe profil). */
export function formatRoDate(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Varsta in ani impliniti, sau null. */
export function getAge(birthDate) {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate).trim());
  if (!m) return null;
  const b = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age--;
  return age >= 0 && age < 130 ? age : null;
}
