-- =====================================================================
-- 0030 — Mesaje private 1-la-1 între prieteni
--
-- Mesajele rămân în D1, dar pot fi citite/trimise numai cât timp relația
-- dintre cei doi utilizatori este `accepted`. Verificarea prieteniei se face
-- în cod la fiecare citire și la fiecare mesaj WebSocket; istoricul nu este
-- șters la unfriend, doar devine imediat inaccesibil.
-- =====================================================================

CREATE TABLE IF NOT EXISTS private_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT    NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT,
  CHECK (sender_id <> recipient_id)
);

-- Istoric pe fiecare direcție. Interogarea unei conversații unește cele două
-- direcții și citește cel mult 100 de rânduri, fără scanarea tabelului.
CREATE INDEX IF NOT EXISTS idx_private_messages_sender_recipient
  ON private_messages(sender_id, recipient_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_private_messages_recipient_sender
  ON private_messages(recipient_id, sender_id, id DESC);

-- Inbox / badge: numai mesajele necitite primite de la un anumit prieten.
CREATE INDEX IF NOT EXISTS idx_private_messages_unread
  ON private_messages(recipient_id, sender_id, id DESC)
  WHERE read_at IS NULL;
