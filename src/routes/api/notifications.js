// /api/notifications — lista proprie, mark-read si count-ul pentru badge.
//   GET  ?unread=1&limit=N  → lista (implicit ultimele 30)
//   GET  /unread            → { count } (polling ieftin pentru clopotel)
//   POST /read              → { all: 1 } sau { ids: [...] }
import { json, errorResponse, isSameOrigin } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { listNotifications, markRead, unreadCount } from '../../lib/notify.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 30;
  const items = await listNotifications(env, gate.user.id, {
    limit,
    unreadOnly: url.searchParams.get('unread') === '1',
  });
  return json({ notifications: items, unread: await unreadCount(env, gate.user.id) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  const url = new URL(request.url);
  if (url.pathname.endsWith('/read')) {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const changed = await markRead(env, gate.user.id, { all: !!body.all, ids: Array.isArray(body.ids) ? body.ids : [] });
    return json({ success: true, changed, unread: await unreadCount(env, gate.user.id) });
  }
  return errorResponse(404, 'Rută necunoscută');
}
