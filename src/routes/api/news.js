import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/news — ultimele noutăți ale site-ului (public).
//
// Date de catalog + anunțuri ale administrației, deci publice. Cache de 60 s
// la nivel de izolat, exact ca /api/recent: indiferent câți vizitatori intră
// pe prima pagină într-un minut, D1 e întrebat o singură dată.
//
// Se servește și prin /api/home (agregatul primei pagini), deci în practică
// nu costă nicio invocare suplimentară de Worker.
// =====================================================================

const CACHE_MS = 60 * 1000;
const LIMIT = 6;
const cache = { at: 0, items: null };

/** Golește cache-ul după o scriere din admin, ca anunțul să apară imediat. */
export function invalidateNewsCache() {
  cache.at = 0;
  cache.items = null;
}

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();

  if (!cache.items || now - cache.at > CACHE_MS) {
    try {
      const res = await env.DB
        .prepare(
          `SELECT id, kind, title, body, link, created_at
           FROM news
           ORDER BY created_at DESC, id DESC
           LIMIT ${LIMIT}`
        )
        .all();
      cache.items = res.results || [];
      cache.at = now;
    } catch (e) {
      // Tabelul poate lipsi pe o bază pe care migrarea 0034 nu a ajuns încă.
      // Noutățile sunt o secțiune secundară: pagina nu are voie să moară.
      console.error('GET /api/news esuat:', e?.message || e);
      cache.items = cache.items || [];
      cache.at = now;
    }
  }

  return json({ items: cache.items }, { headers: { 'cache-control': 'public, max-age=60' } });
}
