import { hasTurso, tursoExecute } from './turso.js';

// =====================================================================
// Persistența mesajelor private.
//
// Producție: Turso (`anime-uke-messages`), ca istoricul DM să nu consume
// stocarea și cota de scrieri D1 a aplicației. D1 rămâne sursa de adevăr
// pentru utilizatori/prietenii și fallback-ul local al suitei (dev.sh nu are
// credențiale externe). Niciun apel nu expune tokenul către client.
// =====================================================================

async function query(env, sql, args = []) {
  if (hasTurso(env)) return tursoExecute(env, sql, args);
  const statement = env.DB.prepare(sql).bind(...args);
  const result = await statement.all();
  return { rows: result.results || [], rowsAffected: 0, lastInsertId: 0 };
}

async function mutate(env, sql, args = []) {
  if (hasTurso(env)) return tursoExecute(env, sql, args);
  const result = await env.DB.prepare(sql).bind(...args).run();
  return {
    rows: [],
    rowsAffected: Number(result.meta?.changes) || 0,
    lastInsertId: Number(result.meta?.last_row_id) || 0,
  };
}

function ids(values) {
  return [...new Set((values || [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))]
    .slice(0, 100);
}

export async function messageSummaries(env, meId, friendIds) {
  const friends = ids(friendIds);
  if (!friends.length) return [];
  const marks = friends.map(() => '?').join(',');
  const result = await query(env,
    `WITH relevant AS (
       SELECT id, sender_id, recipient_id, message, created_at, read_at,
              CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS friend_id
         FROM private_messages
        WHERE (sender_id = ? AND recipient_id IN (${marks}))
           OR (recipient_id = ? AND sender_id IN (${marks}))
     ), summary AS (
       SELECT friend_id,
              MAX(id) AS last_id,
              SUM(CASE WHEN recipient_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
         FROM relevant
        GROUP BY friend_id
     )
     SELECT s.friend_id,
            pm.message AS last_message,
            pm.created_at AS last_message_at,
            pm.sender_id AS last_sender_id,
            s.unread
       FROM summary s
       JOIN private_messages pm ON pm.id = s.last_id`,
    [meId, meId, ...friends, meId, ...friends, meId]);
  return result.rows || [];
}

export async function messageHistory(env, meId, friendId, before, limit = 100) {
  const result = await query(env,
    `SELECT id, sender_id, recipient_id, message, created_at, read_at
       FROM (
         SELECT id, sender_id, recipient_id, message, created_at, read_at
           FROM private_messages
          WHERE sender_id = ? AND recipient_id = ? AND id < ?
         UNION ALL
         SELECT id, sender_id, recipient_id, message, created_at, read_at
           FROM private_messages
          WHERE sender_id = ? AND recipient_id = ? AND id < ?
       )
      ORDER BY id DESC
      LIMIT ?`,
    [meId, friendId, before, friendId, meId, before, limit]);
  return (result.rows || []).reverse();
}

export async function markMessagesRead(env, recipientId, senderId) {
  return mutate(env,
    `UPDATE private_messages
        SET read_at = datetime('now')
      WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`,
    [recipientId, senderId]);
}

export async function insertPrivateMessage(env, senderId, recipientId, message, createdAt) {
  return mutate(env,
    `INSERT INTO private_messages (sender_id, recipient_id, message, created_at)
     VALUES (?, ?, ?, ?)`,
    [senderId, recipientId, message, createdAt]);
}

export async function deletePrivateMessage(env, id, senderId, recipientId) {
  return mutate(env,
    `DELETE FROM private_messages
      WHERE id = ? AND sender_id = ? AND recipient_id = ?`,
    [id, senderId, recipientId]);
}

export async function deletePrivateMessagesForUser(env, userId) {
  return mutate(env,
    `DELETE FROM private_messages WHERE sender_id = ? OR recipient_id = ?`,
    [userId, userId]);
}
