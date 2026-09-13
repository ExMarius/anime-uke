// POST /api/comments/vote — {comment_id, vote: 1 | -1 | 0}
// vote=0 anuleaza votul. +1 XP doar la PRIMUL vot pe comentariul acela
// (din spec: vote +1) — schimbarile de parere nu farmeaza XP.
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { addActivity } from '../../lib/xp.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;

  const rl = await checkRateLimit(env, `cvote:${gate.user.id}`, 120, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const cid = validatePositiveInt(body.comment_id, 'Comentariul');
  if (!cid.ok) return errorResponse(400, cid.error);
  const raw = Number(body.vote);
  const vote = raw === 1 ? 1 : raw === -1 ? -1 : raw === 0 ? 0 : null;
  if (vote === null) return errorResponse(400, 'Vot invalid (1, -1 sau 0)');

  const comment = await env.DB
    .prepare('SELECT id FROM episode_comments WHERE id = ?')
    .bind(cid.value)
    .first();
  if (!comment) return errorResponse(404, 'Comentariul nu există');

  const existing = await env.DB
    .prepare('SELECT vote FROM comment_votes WHERE user_id = ? AND comment_id = ?')
    .bind(gate.user.id, cid.value)
    .first();

  if (vote === 0) {
    await env.DB
      .prepare('DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?')
      .bind(gate.user.id, cid.value)
      .run();
  } else if (existing) {
    await env.DB
      .prepare('UPDATE comment_votes SET vote = ? WHERE user_id = ? AND comment_id = ?')
      .bind(vote, gate.user.id, cid.value)
      .run();
  } else {
    await env.DB
      .prepare('INSERT INTO comment_votes (user_id, comment_id, vote) VALUES (?, ?, ?)')
      .bind(gate.user.id, cid.value, vote)
      .run();
    await addActivity(env, gate.user.id, 1); // +1 XP la primul vot, ca in spec
  }

  const agg = await env.DB
    .prepare('SELECT COALESCE(SUM(vote), 0) AS s FROM comment_votes WHERE comment_id = ?')
    .bind(cid.value)
    .first();
  return json({ success: true, score: agg?.s || 0, my_vote: vote });
}
