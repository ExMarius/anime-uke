import { json } from '../../lib/http.js';

// =====================================================================
// GET /api/recent — „Ultimele episoade adăugate" (secțiune clasică pe
// site-urile de anime). Doar date de catalog (titlu, copertă, număr),
// deci e publică. Cache 60s la nivel de izolat: la fiecare minut se face
// o singură citire D1 indiferent câți vizitatori intră pe prima pagină.
// =====================================================================

const CACHE_MS = 60 * 1000;
const cache = { at: 0, items: null };

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();

  if (!cache.items || now - cache.at > CACHE_MS) {
    try {
      // id DESC = ordinea de adăugare (PK autoincrement), zero sortare extra.
      const res = await env.DB
        .prepare(
          `SELECT e.id, e.episode_number, e.title, s.id AS series_id,
                  s.title AS series_title, s.cover_image
           FROM episodes e JOIN anime_series s ON s.id = e.series_id
           ORDER BY e.id DESC LIMIT 8`
        )
        .all();
      cache.items = res.results || [];
      cache.at = now;
    } catch (e) {
      console.error('GET /api/recent esuat:', e?.message || e);
      cache.items = cache.items || [];
      cache.at = now;
    }
  }

  return json({ items: cache.items }, { headers: { 'cache-control': 'public, max-age=60' } });
}
