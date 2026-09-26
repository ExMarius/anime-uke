import { errorResponse, isSameOrigin, json } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';
import {
  markMessagesRead,
  messageHistory,
  messageSummaries,
} from '../../lib/private-messages.js';

// =====================================================================
// /api/messages — inbox + istoric pentru mesajele private dintre prieteni.
//
// Identitatea și autorizarea rămân în D1 (users + friendships). Conținutul
// mesajelor este citit/scris prin private-messages.js: Turso în producție,
// D1 numai în dezvoltarea locală fără credențiale externe.
// =====================================================================

const MAX_HISTORY = 100;

function normalizedUsername(value) {
  return String(value || '').trim().slice(0, 64);
}

async function acceptedFriend(env, meId, target) {
  const id = Number(target?.id);
  const byId = Number.isSafeInteger(id) && id > 0;
  const username = normalizedUsername(target?.username);
  if (!byId && !username) return null;
  const where = byId ? 'u.id = ?' : 'u.username = ?';
  return env.DB.prepare(
    `SELECT u.id, u.username, COALESCE(p.avatar_url, '') AS avatar
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       JOIN friendships f
         ON ((f.requester_id = ? AND f.addressee_id = u.id)
          OR (f.addressee_id = ? AND f.requester_id = u.id))
        AND f.status = 'accepted'
      WHERE ${where} AND u.id <> ?
      LIMIT 1`
  ).bind(meId, meId, byId ? id : username, meId).first();
}

async function acceptedFriends(env, meId) {
  const result = await env.DB.prepare(
    `SELECT u.id AS user_id,
            u.username,
            COALESCE(p.avatar_url, '') AS avatar,
            f.updated_at AS friendship_updated_at
       FROM friendships f
       JOIN users u ON u.id = CASE
         WHEN f.requester_id = ? THEN f.addressee_id
         ELSE f.requester_id
       END
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE (f.requester_id = ? OR f.addressee_id = ?)
        AND f.status = 'accepted'
      ORDER BY f.updated_at DESC, u.username COLLATE NOCASE
      LIMIT 100`
  ).bind(meId, meId, meId).all();
  return result.results || [];
}

async function inbox(env, meId) {
  // Nu putem face JOIN între D1 și Turso. Citim lista autorizată din D1,
  // sumarul mesajelor într-o singură cerere Turso și le unim după user id.
  const friends = await acceptedFriends(env, meId);
  const summaries = await messageSummaries(env, meId, friends.map((row) => row.user_id));
  const byFriend = new Map(summaries.map((row) => [Number(row.friend_id), row]));

  const conversations = friends.map((friend) => {
    const summary = byFriend.get(Number(friend.user_id)) || {};
    const unread = Number(summary.unread) || 0;
    return {
      ...friend,
      id: Number(friend.user_id),
      last_message: summary.last_message ?? null,
      preview: summary.last_message ?? null,
      last_message_at: summary.last_message_at ?? null,
      last_sender_id: summary.last_sender_id == null ? null : Number(summary.last_sender_id),
      unread,
      unread_count: unread,
    };
  });

  conversations.sort((a, b) => {
    if (a.last_message_at && b.last_message_at) {
      const byMessage = String(b.last_message_at).localeCompare(String(a.last_message_at));
      if (byMessage) return byMessage;
    } else if (a.last_message_at || b.last_message_at) {
      return a.last_message_at ? -1 : 1;
    }
    const byFriendship = String(b.friendship_updated_at || '').localeCompare(String(a.friendship_updated_at || ''));
    return byFriendship || String(a.username).localeCompare(String(b.username), 'ro', { sensitivity: 'base' });
  });
  return conversations;
}

function decorateHistory(rows, me, friend) {
  return rows.map((row) => {
    const mine = Number(row.sender_id) === Number(me.id);
    return {
      ...row,
      id: Number(row.id),
      sender_id: Number(row.sender_id),
      recipient_id: Number(row.recipient_id),
      sender_username: mine ? me.username : friend.username,
      // UI-ul privat nu afișează avatar pe fiecare bulă; păstrăm câmpul API
      // pentru compatibilitate și pentru eventuali clienți existenți.
      sender_avatar: mine ? '' : (friend.avatar || ''),
    };
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  const url = new URL(request.url);
  const withUsername = normalizedUsername(
    url.searchParams.get('with') || url.searchParams.get('u') || url.searchParams.get('username')
  );
  const withId = Number(url.searchParams.get('user_id') || url.searchParams.get('friend_id'));
  const hasTargetId = Number.isSafeInteger(withId) && withId > 0;

  try {
    if (!withUsername && !hasTargetId) {
      const conversations = await inbox(env, me.id);
      const unread = conversations.reduce((sum, row) => sum + row.unread, 0);
      return json({
        conversations,
        friends: conversations,
        unread,
        unread_count: unread,
      });
    }

    const friend = await acceptedFriend(env, me.id, {
      username: withUsername,
      id: hasTargetId ? withId : null,
    });
    if (!friend) return errorResponse(403, 'Mesajele private sunt disponibile doar între prieteni');

    const rawBefore = Number(url.searchParams.get('before'));
    const before = Number.isSafeInteger(rawBefore) && rawBefore > 0
      ? rawBefore
      : Number.MAX_SAFE_INTEGER;
    const rows = await messageHistory(env, me.id, friend.id, before, MAX_HISTORY);
    const messages = decorateHistory(rows, me, friend);
    return json({
      friend: { user_id: friend.id, username: friend.username, avatar: friend.avatar || '' },
      messages,
      has_more: messages.length === MAX_HISTORY,
    });
  } catch (error) {
    console.error('GET /api/messages failed:', error?.message || error);
    return errorResponse(500, 'Nu am putut încărca mesajele');
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return errorResponse(403, 'Cerere invalidă');
  const me = await getSessionUser(request, env);
  if (!me) return errorResponse(401, 'Trebuie să fii autentificat');

  let body;
  try { body = await request.json(); } catch { return errorResponse(400, 'JSON invalid'); }

  const action = String(body?.action || 'read').toLowerCase();
  if (action !== 'read') return errorResponse(400, 'Acțiune invalidă');
  const withUsername = normalizedUsername(body?.with || body?.username || body?.u);
  const withId = Number(body?.user_id || body?.friend_id);
  const hasTargetId = Number.isSafeInteger(withId) && withId > 0;
  if (!withUsername && !hasTargetId) return errorResponse(400, 'Prieten lipsă');

  try {
    const friend = await acceptedFriend(env, me.id, {
      username: withUsername,
      id: hasTargetId ? withId : null,
    });
    if (!friend) return errorResponse(403, 'Mesajele private sunt disponibile doar între prieteni');

    const result = await markMessagesRead(env, me.id, friend.id);
    const conversations = await inbox(env, me.id);
    const unread = conversations.reduce((sum, row) => sum + row.unread, 0);
    return json({
      ok: true,
      changed: result.rowsAffected,
      unread,
      unread_count: unread,
    });
  } catch (error) {
    console.error('POST /api/messages failed:', error?.message || error);
    return errorResponse(500, 'Nu am putut marca mesajele ca citite');
  }
}

// Compatibil cu clienți care exprimă mark-as-read ca mutație PATCH.
export const onRequestPatch = onRequestPost;
