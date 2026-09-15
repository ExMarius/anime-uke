// =====================================================================
// Setări de site persistate în D1 (tabela site_settings, migrarea 0026).
//
// Prima utilizare: MONETIZAREA — configurația sloturilor de reclame,
// editabilă din admin fără deploy. Modelul e simplu key/value cu JSON
// în value, plus un cache la nivel de izolat ca să nu plătim o citire
// D1 la fiecare pageview (regula §5 din AGENTS.md: scrierile și citirile
// D1 sunt resursa scumpă).
//
// SLOTURILE DE RECLAME — de ce sunt STRUCTURATE și nu HTML liber:
//   1. CSP-ul sitului e strict (script-src 'self', fără inline). Un cod
//      de reclamă bazat pe <script> extern ar fi blocat oricum, deci nu
//      are rost să-l acceptăm. Rețelele care merg pe acest site sunt
//      cele cu iframe pur (A-ADS) sau cu link direct (Adsterra Direct
//      Link) — ambele se descriu complet cu un URL + dimensiuni.
//   2. HTML liber salvat din admin și injectat în pagini = XSS stocat
//      dacă un cont de admin e compromis. Un URL validat (doar https:)
//      nu poate injecta nimic.
// =====================================================================

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, value }

/** Citește o setare (string brut) cu cache de izolat. */
export async function getSetting(env, key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = null;
  try {
    const row = await env.DB
      .prepare('SELECT value FROM site_settings WHERE key = ?')
      .bind(key)
      .first();
    value = row ? String(row.value) : null;
  } catch {
    // tabela poate lipsi pe o bază fără migrarea 0026 — tratăm ca „nesetat"
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Scrie o setare și invalidează cache-ul izolatului curent. */
export async function setSetting(env, key, value) {
  await env.DB
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value))
    .run();
  cache.set(key, { at: Date.now(), value: String(value) });
}

// ---------------------------------------------------------------------
// Reclame: configurație + validare
// ---------------------------------------------------------------------

/** Sloturile existente în pagini (data-ad-slot în HTML). */
export const AD_SLOTS = ['index', 'series', 'episode'];

/** Tipuri de slot acceptate — vezi comentariul din antet pentru motivare. */
export const AD_TYPES = ['iframe', 'link'];

export const DEFAULT_ADS = {
  enabled: false,
  hide_for_staff: true,
  slots: Object.fromEntries(
    AD_SLOTS.map((s) => [s, { enabled: false, type: 'iframe', url: '', width: 728, height: 90, label: '' }])
  ),
};

/** Configurația de reclame din D1, completată cu valorile implicite. */
export async function getAdsConfig(env) {
  const raw = await getSetting(env, 'ads');
  if (!raw) return structuredClone(DEFAULT_ADS);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return structuredClone(DEFAULT_ADS); }
  const v = validateAdsConfig(parsed);
  return v.ok ? v.value : structuredClone(DEFAULT_ADS);
}

/**
 * Validează strict o configurație de reclame venită din admin.
 * Returnează { ok: true, value } cu obiectul normalizat sau { ok: false, error }.
 */
export function validateAdsConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Configurație invalidă' };
  const out = {
    enabled: Boolean(input.enabled),
    hide_for_staff: input.hide_for_staff === undefined ? true : Boolean(input.hide_for_staff),
    slots: {},
  };
  const slots = input.slots && typeof input.slots === 'object' ? input.slots : {};
  for (const name of AD_SLOTS) {
    const s = slots[name] && typeof slots[name] === 'object' ? slots[name] : {};
    const type = AD_TYPES.includes(s.type) ? s.type : 'iframe';
    const url = String(s.url || '').trim().slice(0, 500);
    const enabled = Boolean(s.enabled);
    if (enabled) {
      if (!url) return { ok: false, error: `Slotul „${name}": URL obligatoriu când slotul e activ` };
      let u;
      try { u = new URL(url); } catch { return { ok: false, error: `Slotul „${name}": URL invalid` }; }
      if (u.protocol !== 'https:') return { ok: false, error: `Slotul „${name}": doar URL-uri https:` };
    }
    const width = clampInt(s.width, 40, 1000, 728);
    const height = clampInt(s.height, 20, 800, 90);
    const label = String(s.label || '').trim().slice(0, 60);
    out.slots[name] = { enabled, type, url, width, height, label };
  }
  return { ok: true, value: out };
}

function clampInt(v, min, max, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
