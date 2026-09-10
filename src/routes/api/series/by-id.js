import { json, errorResponse } from '../../../lib/http.js';
import { validatePositiveInt } from '../../../lib/validate.js';

// =====================================================================
// GET /api/series/:id — detaliile seriei + TOATE episoadele ei, intr-un
// singur raspuns.
//
// In v1 pagina seriei facea 2 cereri (/series pentru toate seriile, apoi
// /episodes). Combinand-le, injumatatim numarul de invocari Workers —
// relevant pentru cota gratuita de 100.000/zi.
// =====================================================================

export async function onRequestGet(context) {
  const { env, params } = context;

  const id = validatePositiveInt(params.id, 'ID-ul seriei');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const [seriesRes, episodesRes] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, title, description, cover_image, status, genre, year, created_at
         FROM anime_series WHERE id = ?`
      ).bind(id.value),
      env.DB.prepare(
        `SELECT id, episode_number, title, doodstream_url, views, created_at
         FROM episodes WHERE series_id = ? ORDER BY episode_number ASC LIMIT 2000`
      ).bind(id.value),
    ]);

    const series = seriesRes.results?.[0];
    if (!series) return errorResponse(404, 'Seria nu există');

    return json({ series, episodes: episodesRes.results || [] });
  } catch (e) {
    console.error('GET /api/series/:id esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca seria');
  }
}
