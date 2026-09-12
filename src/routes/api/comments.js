// =====================================================================
// /api/comments — comentarii pe episod
//
//   GET    ?episode_id=N  → ultimele 50, cu numele autorului
//   POST   {episode_id, body}
//   DELETE ?id=N          → doar autorul sau un admin
//
// Anti-spam minim, fara servicii externe: limita de lungime, rate limit
// pe utilizator, iar site-ul e oricum in spatele autentificarii.
// Tag-ul [spoiler] se pastreaza ca text; randarea lui ca zona care se
// dezvaluie la click se face in browser, dupa escaparea HTML.
// =====================================================================
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { validatePositiveInt } from '../../lib/validate.js';
import { requireUser } from '../../lib/session.js';
import { checkRateLimit, tooManyRequests } from '../../lib/ratelimit.js';

const MAX_LEN = 2000;
const MIN_LEN = 4;

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const url = new URL(request.url);
  const eid = validatePositiveInt(url.searchParams.get('episode_id'), 'ID-ul episodului');
  if (!eid.ok) return errorResponse(400, eid.error);

  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.username
       FROM episode_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.episode_id = ?
       ORDER BY c.id ASC
       LIMIT 50`
    )
    .bind(eid.value)
    .all();

  return json({
    comments: (rows.results || []).map((r) => ({
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      username: r.username,
      own: r.user_id === user.id,
    })),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = await checkRateLimit(env, `comment:${user.id}`, 60, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'Cerere invalidă'); }

  const eid = validatePositiveInt(body.episode_id, 'ID-ul episodului');
  if (!eid.ok) return errorResponse(400, eid.error);

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length < MIN_LEN) return errorResponse(400, 'Comentariul e prea scurt');
  if (text.length > MAX_LEN) return errorResponse(400, `Comentariul depășește ${MAX_LEN} de caractere`);

  const episode = await env.DB.prepare('SELECT id FROM episodes WHERE id = ?').bind(eid.value).first();
  if (!episode) return errorResponse(404, 'Episodul nu există');

  const ins = await env.DB
    .prepare('INSERT INTO episode_comments (episode_id, user_id, body) VALUES (?, ?, ?)')
    .bind(eid.value, user.id, text)
    .run();

  return json({ success: true, id: ins.meta.last_row_id });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');

  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const user = gate.user;

  const url = new URL(request.url);
  const id = validatePositiveInt(url.searchParams.get('id'), 'ID-ul comentariului');
  if (!id.ok) return errorResponse(400, id.error);

  const existing = await env.DB
    .prepare('SELECT user_id FROM episode_comments WHERE id = ?')
    .bind(id.value)
    .first();
  if (!existing) return errorResponse(404, 'Comentariul nu există');
  if (existing.user_id !== user.id && !user.is_admin) {
    return errorResponse(403, 'Nu poți șterge comentariul altcuiva');
  }

  await env.DB.prepare('DELETE FROM episode_comments WHERE id = ?').bind(id.value).run();
  return json({ success: true });
}
