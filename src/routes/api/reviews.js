// =====================================================================
// /api/reviews — recenzii pe serie (nota + text)
//
//   GET  ?series_id=N       → lista (nota vine din series_ratings, sursa
//                             unica de adevar pentru medie) + recenzia mea
//   POST {series_id, rating, body} → upsert nota + textul
//
// Pragul de la ratings se pastreaza: notezi/review-uiesti doar daca ai
// vizionat macar un episod din serie — recenziile din trecere polueaza.
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { addActivity } from '../../lib/xp.js';
import { saveRating } from '../../lib/ratings.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';

const MAX_LEN = 2000;
const MIN_LEN = 10;

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const url = new URL(request.url);
  const sid = validatePositiveInt(url.searchParams.get('series_id'), 'Seria');
  if (!sid.ok) return errorResponse(400, sid.error);

  const themes = await loadRankThemes(env);
  const rows = await env.DB
    .prepare(
      `SELECT r.body, r.updated_at, r.user_id, u.username, u.level, u.rank_theme, u.is_admin, u.staff_role,
              rt.rating
       FROM series_reviews r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN series_ratings rt ON rt.user_id = r.user_id AND rt.series_id = r.series_id
       WHERE r.series_id = ?
       ORDER BY r.updated_at DESC
       LIMIT 30`
    )
    .bind(sid.value)
    .all();

  const count = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM series_reviews WHERE series_id = ?')
    .bind(sid.value)
    .first();

  return json({
    count: count?.n || 0,
    reviews: (rows.results || []).map((r) => {
      const idn = identity(r, themes);
      return {
        username: r.username,
        rating: r.rating || 0,
        body: r.body,
        updated_at: r.updated_at,
        own: r.user_id === gate.user.id,
        rank: idn.rank,
        staff: idn.staff,
      };
    }),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `review:${user.id}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'Cerere invalidă'); }
  const sid = validatePositiveInt(body.series_id, 'Seria');
  if (!sid.ok) return errorResponse(400, sid.error);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return errorResponse(400, 'Nota trebuie să fie un număr întreg între 1 și 10');
  }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length < MIN_LEN) return errorResponse(400, `Recenzia e prea scurtă (min ${MIN_LEN} caractere)`);
  if (text.length > MAX_LEN) return errorResponse(400, `Recenzia depășește ${MAX_LEN} de caractere`);

  const series = await env.DB.prepare('SELECT id FROM anime_series WHERE id = ?').bind(sid.value).first();
  if (!series) return errorResponse(404, 'Seria nu există');

  const watched = await env.DB
    .prepare(
      `SELECT 1 AS x FROM watched_history w
       JOIN episodes e ON e.id = w.episode_id
       WHERE w.user_id = ? AND e.series_id = ? LIMIT 1`
    )
    .bind(user.id, sid.value)
    .first();
  if (!watched) {
    return errorResponse(403, 'Trebuie să fi vizionat măcar un episod din seria asta înainte de a o recenzia.');
  }

  const hadRating = await env.DB
    .prepare('SELECT 1 AS x FROM series_ratings WHERE user_id = ? AND series_id = ?')
    .bind(user.id, sid.value)
    .first();
  const hadReview = await env.DB
    .prepare('SELECT 1 AS x FROM series_reviews WHERE user_id = ? AND series_id = ?')
    .bind(user.id, sid.value)
    .first();

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // Nota din recenzie trece prin aceeași cale ca votul simplu: media
  // denormalizată de pe serie se resincronizează în același batch.
  const agg = await saveRating(env, user.id, sid.value, rating);
  await env.DB
    .prepare(
      `INSERT INTO series_reviews (series_id, user_id, body, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(series_id, user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
    )
    .bind(sid.value, user.id, text, stamp)
    .run();

  // +5 XP doar la prima nota, ca in spec — editarea recenziei nu farmeaza.
  if (!hadRating) await addActivity(env, user.id, 5);


  return json({
    success: true,
    created: !hadReview,
    average: agg.average,
    count: agg.count,
  }, { status: hadReview ? 200 : 201 });
}
