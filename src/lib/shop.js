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


export function findItem(id) {
  return SHOP_ITEMS.find((i) => i.id === id) || null;
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
