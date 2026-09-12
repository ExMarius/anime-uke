// POST /api/series/subscribe — {series_id, on: 0|1}
// Abonarea e idempotenta: INSERT OR IGNORE / DELETE, fara read-uri in plus.
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { validatePositiveInt } from '../../lib/validate.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const sid = validatePositiveInt(body.series_id, 'Seria');
  if (!sid.ok) return errorResponse(400, sid.error);
  const on = body.on ? 1 : 0;

  const rl = await checkRateLimit(env, `sub:${gate.user.id}`, 30, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const series = await env.DB.prepare('SELECT id, title FROM anime_series WHERE id = ?').bind(sid.value).first();
  if (!series) return errorResponse(404, 'Seria nu există');

  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO series_subscriptions (user_id, series_id) VALUES (?, ?)').bind(gate.user.id, sid.value).run();
  } else {
    await env.DB.prepare('DELETE FROM series_subscriptions WHERE user_id = ? AND series_id = ?').bind(gate.user.id, sid.value).run();
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM series_subscriptions WHERE series_id = ?').bind(sid.value).first();
  return json({ success: true, subscribed: !!on, subscriber_count: count?.n || 0 });
}
