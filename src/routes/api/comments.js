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
import { addActivity, grantBadge } from '../../lib/xp.js';
import { addRep } from '../../lib/factions.js';
import { bumpMission, streakTouch } from '../../lib/missions.js';
import { identity, loadRankThemes } from '../../lib/ranks.js';

const MAX_LEN = 2000;
const MIN_LEN = 4;

export async function onRequestGet(context) {
  const { request, env } = context;
  // Citirea e publica (site public); voturile proprii vin doar cu sesiune.
  const gate = await requireUser(request, env);
  const user = gate.response ? null : gate.user;

  const url = new URL(request.url);
  const eid = validatePositiveInt(url.searchParams.get('episode_id'), 'ID-ul episodului');
  if (!eid.ok) return errorResponse(400, eid.error);

  const themes = await loadRankThemes(env);
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, c.parent_id, u.username, u.level, u.rank_theme, u.is_admin, u.staff_role, up.avatar_url AS avatar
       FROM episode_comments c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN user_profiles up ON up.user_id = c.user_id
       WHERE c.episode_id = ?
       ORDER BY c.id ASC
       LIMIT 80`
    )
    .bind(eid.value)
    .all();
  const list = rows.results || [];

  // Score-urile si votul propriu: doua citiri grupate, indiferent de
  // cat de lunga e lista (buget D1 prietenos).
  const ids = list.map((r) => r.id);
  let scores = {};
  let mine = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const agg = await env.DB
      .prepare(`SELECT comment_id, SUM(vote) AS s FROM comment_votes WHERE comment_id IN (${ph}) GROUP BY comment_id`)
      .bind(...ids)
      .all();
    for (const a of agg.results || []) scores[a.comment_id] = a.s;
    if (user) {
      const my = await env.DB
        .prepare(`SELECT comment_id, vote FROM comment_votes WHERE user_id = ? AND comment_id IN (${ph})`)
        .bind(user.id, ...ids)
        .all();
      for (const m of my.results || []) mine[m.comment_id] = m.vote;
    }
  }

  return json({
    comments: list.map((r) => {
      const idn = identity(r, themes);
      return {
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        username: r.username,
        avatar: r.avatar || '',
        own: !!user && r.user_id === user.id,
        parent_id: r.parent_id || null,
        score: scores[r.id] || 0,
        my_vote: mine[r.id] || 0,
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

  // Raspunsurile tin de acelasi episod si nu coboara sub un nivel: un
  // raspuns la un raspuns se ataseaza parintelui firului.
  let parentId = null;
  const rawParent = validatePositiveInt(body.parent_id, 'Comentariul părinte');
  if (body.parent_id !== undefined && body.parent_id !== null) {
    if (!rawParent.ok) return errorResponse(400, rawParent.error);
    const par = await env.DB
      .prepare('SELECT id, episode_id, parent_id FROM episode_comments WHERE id = ?')
      .bind(rawParent.value)
      .first();
    if (!par || par.episode_id !== eid.value) return errorResponse(404, 'Comentariul părinte nu există');
    parentId = par.parent_id || par.id;
  }

  const ins = await env.DB
    .prepare('INSERT INTO episode_comments (episode_id, user_id, body, parent_id) VALUES (?, ?, ?, ?)')
    .bind(eid.value, user.id, text, parentId)
    .run();

  // +5 XP / +5 puncte lunare pe comentariu, ca in spec.
  await addActivity(env, user.id, 5);
  await addRep(env, user, 5);   // reputație pentru facțiune
  // Misiunea zilnica „scrie un comentariu" + streak.
  await bumpMission(env, user.id, 'comment');
  await streakTouch(env, user.id);
  const cc = await env.DB.prepare('SELECT COUNT(*) AS n FROM episode_comments WHERE user_id = ?').bind(user.id).first();
  if ((cc?.n || 0) >= 25) await grantBadge(env, user.id, 'commenter_25');

  return json({ success: true, id: ins.meta.last_row_id, parent_id: parentId }, { status: 201 });
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
  // Propriul comentariu, sau drept de moderare (Admin/Moderator).
  if (existing.user_id !== user.id && !user.can_moderate) {
    return errorResponse(403, 'Nu poți șterge comentariul altcuiva');
  }

  await env.DB.prepare('DELETE FROM episode_comments WHERE id = ?').bind(id.value).run();
  return json({ success: true });
}
