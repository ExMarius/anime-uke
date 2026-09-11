import { json, errorResponse } from '../../../lib/http.js';
import { WATCH_THRESHOLD_SECONDS } from '../progress.js';
import { validatePositiveInt } from '../../../lib/validate.js';
import { getSessionUser } from '../../../lib/session.js';

// =====================================================================
// GET /api/episodes/:id — episodul + seria lui (pentru breadcrumb) +
// daca utilizatorul curent l-a marcat deja ca vizionat.
//
// Toate intr-un singur raspuns: in v1 pagina episodului descarca TOATE
// episoadele din seria 1 (hardcodat!) si il cauta pe cel curent, deci
// pentru orice alta serie ramanea goala.
//
// `watched` permite front-ului sa dezactiveze butonul „+10 puncte" daca
// episodul e deja marcat — altfel utilizatorul da click si nu primeste
// niciun feedback (bug real din v1).
// =====================================================================

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const id = validatePositiveInt(params.id, 'ID-ul episodului');
  if (!id.ok) return errorResponse(400, id.error);

  try {
    const user = await getSessionUser(request, env);

    const epRes = await env.DB
      .prepare(
        `SELECT
           e.id, e.series_id, e.episode_number, e.title, e.views, e.created_at,
           s.title AS series_title, s.cover_image AS series_cover, s.status AS series_status
         FROM episodes e
         JOIN anime_series s ON s.id = e.series_id
         WHERE e.id = ?`
      )
      .bind(id.value)
      .first();

    if (!epRes) return errorResponse(404, 'Episodul nu există');

    // Sursele active, in ordinea stabilita in panoul de admin. O singura
    // interogare; fara JOIN pentru ca numarul de surse per episod e mic.
    const srcRes = await env.DB
      .prepare(
        `SELECT id, label, kind, url
         FROM episode_sources
         WHERE episode_id = ? AND is_active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .bind(id.value)
      .all();
    const sources = (srcRes.results || []).map((r) => ({
      id: r.id, label: r.label, kind: r.kind, url: r.url,
    }));

    let watched = false;
    let progressSeconds = 0;
    if (user) {
      // Ambele citiri sunt indexate pe (user_id, episode_id) si vin
      // intr-un singur batch: istoricul „vizionat" si secundele acumulate,
      // ca bara de progres sa porneasca de unde a ramas utilizatorul.
      const [wRes, pRes] = await env.DB.batch([
        env.DB.prepare('SELECT id FROM watched_history WHERE user_id = ? AND episode_id = ?')
          .bind(user.id, id.value),
        env.DB.prepare('SELECT seconds FROM watch_progress WHERE user_id = ? AND episode_id = ?')
          .bind(user.id, id.value),
      ]);
      watched = (wRes.results || []).length > 0;
      progressSeconds = Number(pRes.results?.[0]?.seconds) || 0;
    }

    return json({
      episode: {
        id: epRes.id,
        series_id: epRes.series_id,
        series_title: epRes.series_title,
        series_cover: epRes.series_cover,
        series_status: epRes.series_status,
        episode_number: epRes.episode_number,
        title: epRes.title,
        views: epRes.views,
        created_at: epRes.created_at,
      },
      sources,
      watched,
      // Bara de progres: de unde a ramas utilizatorul si pragul de atins.
      progress_seconds: progressSeconds,
      watch_threshold: WATCH_THRESHOLD_SECONDS,
    });
  } catch (e) {
    console.error('GET /api/episodes/:id esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca episodul');
  }
}
