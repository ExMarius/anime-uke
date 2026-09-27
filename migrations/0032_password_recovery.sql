-- =====================================================================
-- 0032 — recuperare de parolă asistată
--
-- Nu introducem un furnizor extern de e-mail doar pentru resetare. Membrul
-- cere recuperarea aici, iar administratorul validează manual solicitarea și
-- trimite la adresa deja verificată a contului un cod de unică folosință.
-- Codul nu este stocat niciodată în clar și expiră în 30 de minute.
-- =====================================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'issued', 'completed', 'cancelled')),
  requested_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  issued_at    INTEGER,
  expires_at   INTEGER,
  issued_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash   TEXT    NOT NULL DEFAULT '',
  token_salt   TEXT    NOT NULL DEFAULT '',
  -- Leagă revendicarea de actualizarea parolei din același batch D1, ca două
  -- submit-uri paralele să nu poată scrie ambele parole.
  claim_nonce  TEXT    NOT NULL DEFAULT '',
  used_at      INTEGER
);

-- Lista de suport se citește mereu cu „pending" primul și apoi după data
-- cererii. Indexul evită scanarea când comunitatea crește.
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_queue
  ON password_reset_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user
  ON password_reset_requests(user_id, requested_at DESC);

-- O persoană poate avea o singură recuperare activă. Cererile repetate nu
-- creează spam pentru admin și nu invalidează un cod emis deja.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_one_active_per_user
  ON password_reset_requests(user_id)
  WHERE status IN ('pending', 'issued');
