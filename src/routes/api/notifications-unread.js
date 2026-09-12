// GET /api/notifications/unread — un singur count indexat, poll-at de
// clopoțel la 60s. Atât costă notificarea „live” fără WebSocket dedicat.
import { json } from '../../lib/http.js';
import { requireUser } from '../../lib/session.js';
import { unreadCount } from '../../lib/notify.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await requireUser(request, env);
  if (gate.response) return gate.response;
  return json({ count: await unreadCount(env, gate.user.id) });
}
