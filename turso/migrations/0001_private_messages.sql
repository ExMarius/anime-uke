-- =====================================================================
-- 0001 — schema separată Turso pentru mesajele private 1-la-1
--
-- Utilizatorii și prieteniile rămân în D1; aici păstrăm numai identificatori
-- numerici și conținutul mesajelor. Nu există chei externe cross-database.
-- legacy_d1_id permite importul idempotent al mesajelor create înainte de
-- mutarea pe Turso.
-- =====================================================================

CREATE TABLE IF NOT EXISTS private_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL,
  recipient_id INTEGER NOT NULL,
  message      TEXT    NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT,
  legacy_d1_id INTEGER UNIQUE,
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_private_messages_sender_recipient
  ON private_messages(sender_id, recipient_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_private_messages_recipient_sender
  ON private_messages(recipient_id, sender_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_private_messages_unread
  ON private_messages(recipient_id, sender_id, id DESC)
  WHERE read_at IS NULL;
