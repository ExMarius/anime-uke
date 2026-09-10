import { json, errorResponse } from '../../lib/http.js';

// =====================================================================
// GET /api/series — lista publica a tuturor seriilor.
//
// O singura interogare, cu numarul de episoade calculat prin subquery.
// In v1 pagina seriei descarca TOATE seriile ca sa gaseasca una singura,
// iar pe D1 se taxeaza randurile scanate — deci asta e si o optimizare
// de buget, nu doar de viteza.
// =====================================================================

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const res = await env.DB.prepare(
      `SELECT
         s.id, s.title, s.description, s.cover_image, s.status, s.genre, s.year, s.created_at,
         (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id) AS episode_count
       FROM anime_series s
       ORDER BY s.created_at DESC
       LIMIT 500`
    ).all();

    return json({ series: res.results || [] });
  } catch (e) {
    console.error('GET /api/series esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca seriile');
  }
}

export async function onRequestPost() {
  return errorResponse(405, 'Folosește /api/admin/series pentru a adăuga o serie');
}
