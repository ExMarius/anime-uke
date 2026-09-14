// =====================================================================
// Grade tematice: nivelul contului (economie) -> grad vizibil in chat,
// comentarii, clasament, profil. Temele vin din tabela rank_themes;
// FALLBACK_BUILTIN e plasa de siguranta daca tabela e goala (ex. local
// inainte de seed).
//
// Gradele de staff sunt ORTOGONALE: un moderator de nivelul 3 apare cu
// badge-ul „Moderator” PE LANGA gradul lui de nivel. Asa ierarhia de
// moderare e vizibila fara sa fure identitatea omului.
// =====================================================================

export const FALLBACK_BUILTIN = [
  {
    slug: 'naruto',
    title: 'Naruto — ranguri ninja',
    tiers: [
      { min: 1, label: 'Genin', icon: '🍃' },
      { min: 5, label: 'Chunin', icon: '🌀' },
      { min: 10, label: 'Jonin', icon: '⚔️' },
      { min: 20, label: 'Kage', icon: '👑' },
      { min: 35, label: 'Hokage', icon: '🔥' },
    ],
  },
];

/** Citeste toate temele din D1; daca tabela e goala, intoarce fallback-ul. */
export async function loadRankThemes(env) {
  try {
    const res = await env.DB.prepare('SELECT slug, title, tiers FROM rank_themes ORDER BY slug').all();
    const rows = (res.results || [])
      .map((r) => {
        let tiers;
        try { tiers = JSON.parse(r.tiers); } catch { tiers = null; }
        if (!Array.isArray(tiers) || !tiers.length) return null;
        return { slug: r.slug, title: r.title, tiers };
      })
      .filter(Boolean);
    if (rows.length) return rows;
  } catch { /* tabela poate lipsi local inainte de migrare */ }
  return FALLBACK_BUILTIN;
}

/** Gradul de nivel al unui user din tema lui aleasa. */
export function rankForUser(user, themes) {
  const slug = user?.rank_theme || 'naruto';
  const theme = themes.find((t) => t.slug === slug) || themes[0] || FALLBACK_BUILTIN[0];
  const level = Number(user?.level) || 1;
  const sorted = [...theme.tiers].sort((a, b) => a.min - b.min);
  let tier = sorted[0];
  for (const t of sorted) if (level >= t.min) tier = t;
  return { label: tier?.label || 'Membru', icon: tier?.icon || '🎗️', theme: theme.slug, theme_title: theme.title };
}

// ---------------------------------------------------------------------
// GRADE DE STAFF (acordate manual de admin, tabul „Grade" din /admin)
//
//   users.staff_role  = ''|'helper'|'staff'|'moderator'  → badge-ul afisat
//   users.is_admin    = 1 pentru administratori           → drepturi totale
//   drepturile de moderare = Admin sau 'moderator' (canModerate, lib/session.js)
//   (users.is_mod e o coloana veche, migrata in 0025 si nefolosita de cod.)
//
// Un singur loc scrie staff_role: POST /api/admin/mods. Adminii se numesc
// din tabul „Utilizatori" (POST /api/admin/users, set_role).
// Gradele de NIVEL (Genin → Hokage) sunt cu totul altceva: automate, din
// rank_themes + users.level (vezi rankForUser mai sus).
// ---------------------------------------------------------------------
export const STAFF_ROLES = ['helper', 'staff', 'moderator'];
export const STAFF_LABELS = { helper: 'Helper', staff: 'Staff', moderator: 'Moderator' };

/** Eticheta de staff a unui rand de user: 'Admin' | 'Moderator' | 'Staff' | 'Helper' | ''. */
export function staffRole(user) {
  if (user?.is_admin) return 'Admin';
  return STAFF_LABELS[String(user?.staff_role || '').toLowerCase()] || '';
}

/** Pachetul complet de identitate pentru un rand de user. */
export function identity(user, themes) {
  const rank = rankForUser(user, themes);
  return { rank: { label: rank.label, icon: rank.icon, theme: rank.theme }, staff: staffRole(user) };
}

/** Valideaza un tiers trimis de admin: lista curata, sigura pentru JSON. */
export function validateTiers(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 12) {
    return { ok: false, error: 'Temele au nevoie de 1-12 trepte' };
  }
  const tiers = [];
  for (const t of raw) {
    const min = Number(t?.min);
    const label = String(t?.label || '').trim().slice(0, 24);
    const icon = String(t?.icon || '🎗️').trim().slice(0, 8);
    if (!Number.isInteger(min) || min < 1 || !label) {
      return { ok: false, error: 'Fiecare treapta are nevoie de min (≥1) și label' };
    }
    tiers.push({ min, label, icon });
  }
  tiers.sort((a, b) => a.min - b.min);
  if (tiers[0].min !== 1) return { ok: false, error: 'Prima treaptă trebuie să înceapă de la nivelul 1' };
  return { ok: true, value: tiers };
}
