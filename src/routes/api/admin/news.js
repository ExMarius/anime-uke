import { json, errorResponse, isSameOrigin } from '../../../lib/http.js';
import { requireAdmin } from '../../../lib/session.js';
import { logAdminAction } from '../../../lib/audit.js';
import { checkRateLimit, tooManyRequests } from '../../../lib/ratelimit.js';
import { newsStmt, validateAnnouncement } from '../../../lib/news.js';
import { invalidateNewsCache } from '../news.js';

// =====================================================================
// /api/admin/news — anunțurile administrației (doar admin).
//
//   GET    → ultimele 20 de știri, ca administratorul să vadă ce e publicat
//   POST   → anunț nou { title, body?, link? }
//   DELETE → ?id=<n> retrage o știre (inclusiv una automată greșită)
//
// Știrile automate (serie nouă, sezon) se scriu la locul evenimentului, în
// același batch D1 — vezi src/lib/news.js. Aici e doar canalul manual.
// =====================================================================

const LIST_LIMIT = 20;

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;

  try {
    const res = await env.DB
      .prepare(
        `SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, u.username AS author
         FROM news n LEFT JOIN users u ON u.id = n.author_id
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ${LIST_LIMIT}`
      )
      .all();
    return json({ items: res.results || [] });
  } catch (e) {
    console.error('GET /api/admin/news esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut citi noutățile');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const rl = await checkRateLimit(env, `admin-news:${admin.id}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Cerere invalidă');
  }

  const v = validateAnnouncement(body);
  if (!v.ok) return errorResponse(400, v.error);

  try {
    const stmt = newsStmt(env, { kind: 'anunt', ...v.value, authorId: admin.id });
    const res = await stmt.run();
    invalidateNewsCache();
    const id = res.meta?.last_row_id;
    await logAdminAction(env, admin, 'create_news', 'news', id, v.value.title);
    return json({ success: true, id }, { status: 201 });
  } catch (e) {
    console.error('POST /api/admin/news esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut publica anunțul');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireAdmin(request, env);
  if (gate.response) return gate.response;
  const admin = gate.user;

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return errorResponse(400, 'ID invalid');

  try {
    const res = await env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run();
    if (!res.meta?.changes) return errorResponse(404, 'Știrea nu există');
    invalidateNewsCache();
    await logAdminAction(env, admin, 'delete_news', 'news', id, '');
    return json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/news esuat:', e?.message || e);
    return errorResponse(500, 'Nu am putut șterge știrea');
  }
}
