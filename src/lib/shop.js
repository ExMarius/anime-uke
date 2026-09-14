// =====================================================================
// Catalogul shop-ului — definit in cod, nu in DB: e mic, se schimba rar
// si asa nu platim o citire in plus ca sa-l servim. Proprietatea e in
// user_items (cheie = user+item), gold-ul se scade atomic in ruta de buy.
//
// Preturile sunt calibrate pe economia existenta: cufarul da ~10-100
// gold la 4 ore, deci un player activ strange ~300-600/zi. Cheia (150)
// e o recompensa de o zi, Suporterul (1000) e o achizitie de saptamana.
// =====================================================================

export const SHOP_ITEMS = [
  {
    id: 'chest_key',
    icon: '🗝️',
    name: 'Cheie pentru cufăr',
    desc: 'Deschide cufărul imediat, fără să mai aștepți cooldown-ul de 4 ore. Se consumă la folosire.',
    price: 150,
    consumable: true,
  },
  {
    id: 'name_gold',
    icon: '🌟',
    name: 'Nume de aur',
    desc: 'Numele tău strălucește auriu în chat și pe profil. Permanent.',
    price: 400,
    consumable: false,
  },
  {
    id: 'flair_supporter',
    icon: '💎',
    name: 'Suporter',
    desc: 'Flair 💎 lângă numele tău în chat și pe profil — arată că susții site-ul. Permanent.',
    price: 1000,
    consumable: false,
  },
];


// Culori de nume (chat + profil). Detinerea e permanenta (user_items),
// activarea se schimba oricand din shop. Curcubeu = clasa CSS animata,
// nu un hex; Imperator adauga si o stralucire subtila.
export const NAME_COLORS = [
  { id: 'color_green',      name: 'Verde',        hex: '#22c55e', price: 10000 },
  { id: 'color_blue',       name: 'Albastru',     hex: '#3b82f6', price: 20000 },
  { id: 'color_purple',     name: 'Mov',          hex: '#a855f7', price: 25000 },
  { id: 'color_orange',     name: 'Portocaliu',   hex: '#f97316', price: 30000 },
  { id: 'color_red',        name: 'Roșu',         hex: '#ef4444', price: 100000 },
  { id: 'color_pink',       name: 'Roz',          hex: '#ec4899', price: 200000 },
  { id: 'color_cyan',       name: 'Cyan',         hex: '#22d3ee', price: 250000 },
  { id: 'color_teal',       name: 'Turcoaz',      hex: '#14b8a6', price: 300000 },
  { id: 'color_gold',       name: 'Auriu',        hex: '#fbbf24', price: 700000 },
  { id: 'color_lime',       name: 'Lime',         hex: '#a3e635', price: 800000 },
  { id: 'color_magenta',    name: 'Magenta',      hex: '#e879f9', price: 1000000 },
  { id: 'color_royal',      name: 'Bleu regal',   hex: '#818cf8', price: 1250000 },
  { id: 'color_sky',        name: 'Cer',          hex: '#38bdf8', price: 1750000 },
  { id: 'color_violet',     name: 'Violet',       hex: '#8b5cf6', price: 2000000 },
  { id: 'color_rainbow',    name: 'Curcubeu',     hex: null,      price: 10000000, special: 'rainbow' },
  { id: 'color_imperator',  name: 'Imperator',    hex: '#dc2626', price: 900000000, special: 'glow' },
];

// Teme de site: schimba paleta intreaga (accent + fundaluri). Standard e
// gratis; restul se cumpara o singura data si se comuta oricand.
export const SITE_THEMES = [
  { id: 'theme_standard',   name: 'Standard',   price: 1 },
  { id: 'theme_mizukage',   name: 'Mizukage',   price: 10000 },
  { id: 'theme_purple',     name: 'Purple',     price: 20000 },
  { id: 'theme_green',      name: 'Green',      price: 50000 },
  { id: 'theme_minimalist', name: 'Minimalist', price: 100000 },
  { id: 'theme_storm',      name: 'Storm',      price: 200000 },
  { id: 'theme_classic',    name: 'Classic',    price: 1 },
];

export function findItem(id) {
  return (
    SHOP_ITEMS.find((i) => i.id === id) ||
    NAME_COLORS.find((i) => i.id === id) ||
    SITE_THEMES.find((i) => i.id === id) ||
    null
  );
}

/** Harta item_id → qty pentru ce detine utilizatorul (o singura citire). */
export async function ownedItems(env, userId) {
  const res = await env.DB
    .prepare('SELECT item_id, qty FROM user_items WHERE user_id = ? AND qty > 0')
    .bind(userId)
    .all();
  const map = {};
  for (const r of res.results || []) map[r.item_id] = r.qty;
  return map;
}
