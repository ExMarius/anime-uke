// =====================================================================
// Ranguri + zodii — logica de prezentare pentru profil.
//
// Rangurile urca dupa puncte. Pragurile sunt alese ca primul episod
// vazut (10 pct) sa nu te arunce direct in varf, dar sa existe progres
// vizibil saptamanal.
// =====================================================================

const RANKS = [
  { min: 4000, key: 'kage',   label: 'Kage',   icon: '👑' },
  { min: 1500, key: 'sannin', label: 'Sannin', icon: '🐍' },
  { min: 500,  key: 'jonin',  label: 'Jonin',  icon: '⚔️' },
  { min: 100,  key: 'chunin', label: 'Chunin', icon: '🥷' },
  { min: 0,    key: 'genin',  label: 'Genin',  icon: '🌱' },
];

/** Rangul curent + cat mai e pana la urmatorul. */
export function getRank(points) {
  const p = Math.max(0, Number(points) || 0);
  const current = RANKS.find((r) => p >= r.min) || RANKS[RANKS.length - 1];
  const idx = RANKS.indexOf(current);
  const next = idx > 0 ? RANKS[idx - 1] : null;

  return {
    key: current.key,
    label: current.label,
    icon: current.icon,
    points: p,
    next: next ? { key: next.key, label: next.label, icon: next.icon, at: next.min } : null,
    // Procentul din intervalul curent, pentru bara de XP.
    progress: next ? Math.min(100, Math.round(((p - current.min) / (next.min - current.min)) * 100)) : 100,
    toNext: next ? Math.max(0, next.min - p) : 0,
  };
}

// ---------------------------------------------------------------------
// Zodii
// ---------------------------------------------------------------------
const ZODIAC = [
  { from: [1, 20],  to: [2, 18],  ro: 'Vărsător',    en: 'Aquarius' },
  { from: [2, 19],  to: [3, 20],  ro: 'Pești',       en: 'Pisces' },
  { from: [3, 21],  to: [4, 19],  ro: 'Berbec',      en: 'Aries' },
  { from: [4, 20],  to: [5, 20],  ro: 'Taur',        en: 'Taurus' },
  { from: [5, 21],  to: [6, 20],  ro: 'Gemeni',      en: 'Gemini' },
  { from: [6, 21],  to: [7, 22],  ro: 'Rac',         en: 'Cancer' },
  { from: [7, 23],  to: [8, 22],  ro: 'Leu',         en: 'Leo' },
  { from: [8, 23],  to: [9, 22],  ro: 'Fecioară',    en: 'Virgo' },
  { from: [9, 23],  to: [10, 22], ro: 'Balanță',     en: 'Libra' },
  { from: [10, 23], to: [11, 21], ro: 'Scorpion',    en: 'Scorpio' },
  { from: [11, 22], to: [12, 21], ro: 'Săgetător',   en: 'Sagittarius' },
  { from: [12, 22], to: [1, 19],  ro: 'Capricorn',   en: 'Capricorn' },
];

/**
 * Zodia dintr-o data ISO (YYYY-MM-DD). Returneaza '' la intrare invalida —
 * nu aruncam exceptie, pentru ca data nasterii e un camp optional.
 */
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
    // Capricornul se intinde peste Anul Nou (22.12 → 19.01), deci
    // pentru el conditia e „dupa SAU inainte", nu „si".
    if (fm <= tm ? (after && before) : (after || before)) return z.ro;
  }
  return '';
}

/** Formateaza YYYY-MM-DD ca ZZ.LL.AAAA (formatul afisat pe profil). */
export function formatRoDate(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Varsta in ani completi, sau null. */
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

export const GENDERS = {
  male: 'Masculin',
  female: 'Feminin',
  other: 'Altul',
  '': 'Nespecificat',
};
