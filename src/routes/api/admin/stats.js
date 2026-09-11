import { json, errorResponse } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';

// =====================================================================
// GET /api/admin/stats — tab-ul Statistici din panoul admin.
//
// Toate numerele intr-o SINGURA interogare (subquery-uri), ca sa nu
// consumam invocari Workers sau citiri D1 suplimentare. Panoul admin e
// accesat rar, deci ne permitem si 2 interogari extra pentru topuri.
// =====================================================================

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users)                            AS total_users,
         (SELECT COUNT(*) FROM users WHERE is_admin = 1)         AS total_admins,
         (SELECT COUNT(*) FROM users WHERE is_banned = 1)        AS total_banned,
         (SELECT COUNT(*) FROM anime_series)                     AS total_series,
         (SELECT COALESCE(SUM(episode_count), 0) FROM anime_series) AS total_episodes,
         (SELECT COALESCE(SUM(views), 0) FROM episodes)          AS total_views,
         (SELECT COUNT(*) FROM watched_history)                  AS total_watched,
         (SELECT COUNT(*) FROM chat_messages)                    AS total_chat_messages`
    ).first();

    const topEpisodes = await env.DB.prepare(
      `SELECT e.id, e.title, e.episode_number, e.views, s.title AS series_title
       FROM episodes e JOIN anime_series s ON s.id = e.series_id
       ORDER BY e.views DESC LIMIT 5`
    ).all();

    const latestUsers = await env.DB.prepare(
      `SELECT id, username, points, is_admin, is_banned, created_at
       FROM users ORDER BY id DESC LIMIT 5`
    ).all();

    return json({
      stats: {
        total_users: counts?.total_users ?? 0,
        total_admins: counts?.total_admins ?? 0,
        total_banned: counts?.total_banned ?? 0,
        total_series: counts?.total_series ?? 0,
        total_episodes: counts?.total_episodes ?? 0,
        total_views: counts?.total_views ?? 0,
        total_watched: counts?.total_watched ?? 0,
        total_chat_messages: counts?.total_chat_messages ?? 0,
      },
      top_episodes: topEpisodes.results || [],
      latest_users: latestUsers.results || [],
    });
  } catch (e) {
    console.error('GET /api/admin/stats esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut încărca statisticile');
  }
}
