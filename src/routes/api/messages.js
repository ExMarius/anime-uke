import { errorResponse, isSameOrigin, json } from '../../lib/http.js';
import { getSessionUser } from '../../lib/session.js';

// =====================================================================
// /api/messages — inbox + istoric pentru mesajele private dintre prieteni.
//
// GET /api/messages
//   Lista EXCLUSIV a prietenilor acceptați, cu preview-ul ultimului mesaj și
//   numărul de mesaje necitite. Prietenii fără mesaje apar și ei în listă.
//
// GET /api/messages?with=<username>&before=<id>
//   Ultimele 100 de mesaje din conversația 1-la-1 (paginare opțională).
//
// POST /api/messages { action: 'read', with: <username> }
//   Marchează mesajele primite de la acel prieten ca citite.
//
// Trimiterea se face prin WebSocket, în ChatDO. Atât acest endpoint, cât și
// DO-ul verifică în D1 status='accepted' la FIECARE operație: după unfriend,
// istoricul și trimiterea sunt blocate imediat, fără cache de autorizare.
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

async function inbox(env, meId) {
  // MAX(friendship) nu e folosit ca autorizare pentru mesaje; CTE-ul este
  // doar lista de prieteni acceptați care trebuie afișată în inbox.
  const result = await env.DB.prepare(
    `WITH my_friends AS (
       SELECT CASE
                WHEN f.requester_id = ? THEN f.addressee_id
                ELSE f.requester_id
              END AS friend_id,
              f.updated_at AS friendship_updated_at
       FROM friendships f
       WHERE (f.requester_id = ? OR f.addressee_id = ?)
         AND f.status = 'accepted'
       LIMIT 100
     )
     SELECT u.id AS user_id,
            u.username,
            COALESCE(p.avatar_url, '') AS avatar,
            (SELECT pm.message
               FROM private_messages pm
              WHERE (pm.sender_id = ? AND pm.recipient_id = u.id)
                 OR (pm.sender_id = u.id AND pm.recipient_id = ?)
              ORDER BY pm.id DESC LIMIT 1) AS last_message,
            (SELECT pm.created_at
               FROM private_messages pm
              WHERE (pm.sender_id = ? AND pm.recipient_id = u.id)
                 OR (pm.sender_id = u.id AND pm.recipient_id = ?)
              ORDER BY pm.id DESC LIMIT 1) AS last_message_at,
            (SELECT pm.sender_id
               FROM private_messages pm
              WHERE (pm.sender_id = ? AND pm.recipient_id = u.id)
                 OR (pm.sender_id = u.id AND pm.recipient_id = ?)
              ORDER BY pm.id DESC LIMIT 1) AS last_sender_id,
            (SELECT COUNT(*)
               FROM private_messages pm
              WHERE pm.recipient_id = ?
                AND pm.sender_id = u.id
                AND pm.read_at IS NULL) AS unread,
            mf.friendship_updated_at
       FROM my_friends mf
       JOIN users u ON u.id = mf.friend_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      ORDER BY (last_message_at IS NULL), last_message_at DESC,
               mf.friendship_updated_at DESC, u.username COLLATE NOCASE
      LIMIT 100`
  ).bind(
    meId, meId, meId,
    meId, meId,
    meId, meId,
    meId, meId,
    meId
  ).all();

  return (result.results || []).map((row) => {
    const unread = Number(row.unread) || 0;
    return {
      ...row,
      id: Number(row.user_id),
      preview: row.last_message,
      unread,
      unread_count: unread,
      last_sender_id: row.last_sender_id == null ? null : Number(row.last_sender_id),
    };
  });
}

async function history(env, meId, friendId, before) {
  // UNION ALL lasă D1 să folosească indexul pe fiecare direcție. Rezultatul
  // este limitat descrescător în SQL și întors cronologic către UI.
  const result = await env.DB.prepare(
    `SELECT id, sender_id, recipient_id, message, created_at, read_at,
            sender_username, sender_avatar
       FROM (
         SELECT pm.id, pm.sender_id, pm.recipient_id, pm.message,
                pm.created_at, pm.read_at, u.username AS sender_username,
                COALESCE(p.avatar_url, '') AS sender_avatar
           FROM private_messages pm
           JOIN users u ON u.id = pm.sender_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
          WHERE pm.sender_id = ? AND pm.recipient_id = ? AND pm.id < ?
         UNION ALL
         SELECT pm.id, pm.sender_id, pm.recipient_id, pm.message,
                pm.created_at, pm.read_at, u.username AS sender_username,
                COALESCE(p.avatar_url, '') AS sender_avatar
           FROM private_messages pm
           JOIN users u ON u.id = pm.sender_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
          WHERE pm.sender_id = ? AND pm.recipient_id = ? AND pm.id < ?
       )
      ORDER BY id DESC
      LIMIT ?`
  ).bind(meId, friendId, before, friendId, meId, before, MAX_HISTORY).all();

  return (result.results || []).reverse();
}

async function unreadTotal(env, meId) {
  // Mesajele de la foști prieteni nu se afișează nici în badge. Dacă
  // prietenia dispare, inbox-ul revine imediat la zero pentru acea persoană.
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM private_messages pm
       JOIN friendships f
         ON ((f.requester_id = pm.sender_id AND f.addressee_id = pm.recipient_id)
          OR (f.addressee_id = pm.sender_id AND f.requester_id = pm.recipient_id))
        AND f.status = 'accepted'
      WHERE pm.recipient_id = ? AND pm.read_at IS NULL`
  ).bind(meId).first();
  return Number(row?.n) || 0;
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
      // `friends` rămâne alias explicit: răspunsul spune clar că lista nu
      // conține cereri pending/rejected și simplifică eventualii clienți mici.
      return json({
        conversations,
        friends: conversations,
        unread,
        unread_count: unread,
      });
    }

    const friend = await acceptedFriend(env, me.id, { username: withUsername, id: hasTargetId ? withId : null });
    if (!friend) return errorResponse(403, 'Mesajele private sunt disponibile doar între prieteni');

    const rawBefore = Number(url.searchParams.get('before'));
    const before = Number.isSafeInteger(rawBefore) && rawBefore > 0
      ? rawBefore
      : Number.MAX_SAFE_INTEGER;
    const messages = await history(env, me.id, friend.id, before);
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
    const friend = await acceptedFriend(env, me.id, { username: withUsername, id: hasTargetId ? withId : null });
    if (!friend) return errorResponse(403, 'Mesajele private sunt disponibile doar între prieteni');

    const result = await env.DB.prepare(
      `UPDATE private_messages
          SET read_at = datetime('now')
        WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`
    ).bind(me.id, friend.id).run();

    const unread = await unreadTotal(env, me.id);
    return json({
      ok: true,
      changed: Number(result.meta?.changes) || 0,
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
