// =====================================================================
// POST /api/ratings — nota 1-10 a unui utilizator pentru o serie
//
// Un singur rand per utilizator+serie (PK compus): revotul e un upsert,
// nu un rand nou. Media si numarul de voturi se citesc in ruta seriei,
// pe indexul de serie.
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `rating:${user.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'Cerere invalidă'); }

  const sid = validatePositiveInt(body.series_id, 'ID-ul seriei');
  if (!sid.ok) return errorResponse(400, sid.error);

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return errorResponse(400, 'Nota trebuie să fie un număr întreg între 1 și 10');
  }

  const series = await env.DB.prepare('SELECT id FROM anime_series WHERE id = ?').bind(sid.value).first();
  if (!series) return errorResponse(404, 'Seria nu există');

  await env.DB
    .prepare(
      `INSERT INTO series_ratings (user_id, series_id, rating)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, series_id) DO UPDATE SET rating = excluded.rating`
    )
    .bind(user.id, sid.value, rating)
    .run();

  const agg = await env.DB
    .prepare('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM series_ratings WHERE series_id = ?')
    .bind(sid.value)
    .first();

  return json({
    success: true,
    rating,
    average: Math.round((agg?.avg || 0) * 10) / 10,
    count: agg?.n || 0,
  });
}
