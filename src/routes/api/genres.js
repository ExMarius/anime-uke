import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/genres — lista de genuri pentru filtrarea catalogului.
//
// Standard pe site-urile de anime: filtrezi după gen (Acțiune, Romantism…).
// Genul e stocat ca „A, B, C" pe serie, deci separăm virgulele în JS și
// păstrăm lista în cache o ORĂ — la 1000 de serii interogarea citește 1.000
// de rânduri (scanare de coloană: genul e o listă „A, B, C", nu e indexabil),
// deci cu 10 minute de cache și câteva izolate calde se duceau ~150.000 de
// rânduri pe zi doar ca să știm ce filtre afișăm. Lista de genuri e practic
// statică pentru un catalog de 1000 de serii.
// =====================================================================

const CACHE_MS = 60 * 60 * 1000;
// O listă GOALĂ se ține doar un minut: pe un catalog proaspăt (sau imediat
// după un deploy, înainte să apară prima serie cu gen) un „nimic" ținut o oră
// ar lăsa filtrul de gen gol pentru toată lumea până la următorul restart.
const EMPTY_CACHE_MS = 60 * 1000;
const cache = { at: 0, list: null, ttl: CACHE_MS };

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();

  if (!cache.list || now - cache.at > cache.ttl) {
    try {
      const res = await env.DB
        .prepare(`SELECT genre FROM anime_series WHERE genre != '' LIMIT 1500`)
        .all();
      const set = new Map();
      for (const r of res.results || []) {
        for (const token of String(r.genre || '').split(',')) {
          const g = token.trim();
          if (g.length >= 2 && g.length <= 30) set.set(g, (set.get(g) || 0) + 1);
        }
      }
      // Top genuri, ordonate alfabetic pentru o listă ușor de scanat.
      cache.list = [...set.keys()].sort((a, b) => a.localeCompare(b, 'ro')).slice(0, 40);
      cache.ttl = cache.list.length ? CACHE_MS : EMPTY_CACHE_MS;
      cache.at = now;
    } catch (e) {
      console.error('GET /api/genres esuat:', e?.message || e);
      // Păstrăm răspunsul vechi dacă există; altfel listă goală, nu 500 —
      // un filtru gol nu trebuie să strice pagina.
      cache.list = cache.list || [];
      cache.at = now;
    }
  }

  return json({ genres: cache.list }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
