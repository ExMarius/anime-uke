// =====================================================================
// Catalogul shop-ului — definit in cod, nu in DB: e mic, se schimba rar
// si asa nu platim o citire in plus ca sa-l servim. Proprietatea e in
// user_items (cheie = user+item), gold-ul se scade atomic in ruta de buy.
//
// Feluri de articole:
//   - consumabile stocabile (chei, jetoane): stau in user_items si se
//     folosesc din alta parte (cufar, panoul de factiune).
//   - instant (misterios, boost, tom): efectul se aplica PE LOC la
//     cumparare, fara rand in user_items. Vezi shop-buy.js.
//   - pachet (set de chei): la cumparare crediteaza alt articol.
//   - permanente: flair-uri, culori, teme — o singura cumparare.
//
// Preturile sunt calibrate pe economia existenta: misiunile dau ~30
// gold/zi, cufarul ~10-100 la 4 ore → un player activ strange ~300-600
// gold/zi. Cheia (150) e maruntis zilnic, Tomul (500) si jetonul (500)
// sunt de cateva zile, Nova (2500) e de o saptamana, culorile si temele
// scumpe sunt tinte de luni de zile.
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
    id: 'chest_keys_3',
    icon: '🗝️',
    name: 'Set de 3 chei',
    desc: 'Trei chei de cufăr la preț de pachet (economisești 50 gold). Intră direct în inventar.',
    price: 400,
    consumable: true,
    bundle: 'chest_key',
    bundle_qty: 3,
  },
  {
    id: 'mystery_box',
    icon: '🎁',
    name: 'Cufăr misterios',
    desc: 'Se deschide PE LOC: gold (100-400), XP (20-120), o cheie de cufăr… sau nimic. Noroc!',
    price: 200,
    consumable: true,
    instant: true,
  },
  {
    id: 'xp_boost',
    icon: '⚡',
    name: 'Boost XP 24h',
    desc: 'Se activează PE LOC: tot XP-ul câștigat e DUBLU 24 de ore. Cumpărările repetate prelungesc durata.',
    price: 350,
    consumable: true,
    instant: true,
  },
  {
    id: 'xp_tome',
    icon: '📚',
    name: 'Tomul înțelepciunii',
    desc: 'Se citește PE LOC: +200 XP instant (400 dacă ai boost activ).',
    price: 500,
    consumable: true,
    instant: true,
  },
  {
    id: 'faction_token',
    icon: '🔀',
    name: 'Jeton de facțiune',
    desc: 'Schimbă facțiunea ACUM, fără să aștepți luna următoare. Se folosește din panoul de facțiune (profil).',
    price: 500,
    consumable: true,
  },
  {
    id: 'flair_supporter',
    icon: '💎',
    name: 'Suporter',
    desc: 'Flair 💎 lângă numele tău în chat și pe profil — arată că susții site-ul. Permanent.',
    price: 1000,
    consumable: false,
  },
  {
    id: 'flair_nova',
    icon: '🌠',
    name: 'Nova',
    desc: 'Flair 🌠 lângă numele tău în chat și pe profil — cel mai strălucitor de pe site. Permanent; primează peste 💎.',
    price: 2500,
    consumable: false,
  },
  // NOTĂ: 'name_gold' (Nume de aur) s-a scos din catalog — era duplicat cu
  // culoarea „Auriu” de mai jos. Cine l-a cumpărat îl păstrează (efectul se
  // citește din user_items), dar nu se mai vinde. Nu ștergeți handling-ul
  // din profile.js / chat.js / ChatDO.js.
];


// Culori de nume (chat + profil). Detinerea e permanenta (user_items),
// activarea se schimba oricand din shop. Curcubeu/Apus = clase CSS animate,
// nu un hex; Imperator adauga si o stralucire subtila.
export const NAME_COLORS = [
  { id: 'color_silver',      name: 'Argintiu',    hex: '#cbd5e1', price: 2500 },
  { id: 'color_bronze',      name: 'Bronz',       hex: '#cd7f32', price: 5000 },
  { id: 'color_mint',        name: 'Mentă',       hex: '#6ee7b7', price: 7500 },
  { id: 'color_green',       name: 'Verde',       hex: '#22c55e', price: 10000 },
  { id: 'color_blue',        name: 'Albastru',    hex: '#3b82f6', price: 20000 },
  { id: 'color_purple',      name: 'Mov',         hex: '#a855f7', price: 25000 },
  { id: 'color_orange',      name: 'Portocaliu',  hex: '#f97316', price: 30000 },
  { id: 'color_sunset',      name: 'Apus',        hex: null,      price: 50000, special: 'sunset' },
  { id: 'color_red',         name: 'Roșu',        hex: '#ef4444', price: 100000 },
  { id: 'color_pink',        name: 'Roz',         hex: '#ec4899', price: 200000 },
  { id: 'color_cyan',        name: 'Cyan',        hex: '#22d3ee', price: 250000 },
  { id: 'color_teal',        name: 'Turcoaz',     hex: '#14b8a6', price: 300000 },
  { id: 'color_gold',        name: 'Auriu',       hex: '#fbbf24', price: 700000 },
  { id: 'color_lime',        name: 'Lime',        hex: '#a3e635', price: 800000 },
  { id: 'color_magenta',     name: 'Magenta',     hex: '#e879f9', price: 1000000 },
  { id: 'color_royal',       name: 'Bleu regal',  hex: '#818cf8', price: 1250000 },
  { id: 'color_sky',         name: 'Cer',         hex: '#38bdf8', price: 1750000 },
  { id: 'color_violet',      name: 'Violet',      hex: '#8b5cf6', price: 2000000 },
  { id: 'color_rainbow',     name: 'Curcubeu',    hex: null,      price: 10000000, special: 'rainbow' },
  { id: 'color_imperator',   name: 'Imperator',   hex: '#dc2626', price: 900000000, special: 'glow' },
];

// Teme de site: schimba paleta intreaga (accent + fundaluri). Standard e
// gratis; restul se cumpara o singura data si se comuta oricand.
export const SITE_THEMES = [
  { id: 'theme_standard',   name: 'Standard',   price: 1 },
  { id: 'theme_mizukage',   name: 'Mizukage',   price: 10000 },
  { id: 'theme_purple',     name: 'Purple',     price: 20000 },
  { id: 'theme_green',      name: 'Green',      price: 50000 },
  { id: 'theme_sakura',     name: 'Sakura Pastel', price: 75000 },
  { id: 'theme_minimalist', name: 'Minimalist', price: 100000 },
  { id: 'theme_sunset', name: 'Frunze de toamnă (animate)', price: 150000 },
  { id: 'theme_storm',      name: 'Storm',      price: 200000 },
  { id: 'theme_petale', name: 'Sakura (animată)', price: 175000 },
  { id: 'theme_aurora', name: 'Aurora boreală (animată)', price: 250000 },
  { id: 'theme_royal',      name: 'Royal',      price: 300000 },
  { id: 'theme_portocaliu', name: 'Portocaliu (animat)', price: 400000 },
  { id: 'theme_ocean',  name: 'Ocean (animat)', price: 500000 },
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
