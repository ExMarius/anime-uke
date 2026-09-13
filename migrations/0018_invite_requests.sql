-- =====================================================================
-- 0018 — Cereri de coduri de invitație
--
-- Cerință: vizitatorii pot cere un cod direct din site (pagina de login),
-- cu un motiv scris. Cererile ajung într-o listă la admin; la „Aprobă"
-- se generează automat un cod de invitație, iar cerutorul îl poate vedea
-- cu „biletul" primit la trimitere (RQ-XXXX-XXXX) — fără a fi nevoie de
-- un serviciu de email (buget 0).
--
-- „message" e vizibil EXCLUSIV adminilor; publicul vede doar starea.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invite_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT    NOT NULL,
  message      TEXT    NOT NULL,               -- motivul cerutului, doar pt admin
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  request_code TEXT    NOT NULL UNIQUE,        -- biletul public, neghicitabil
  invite_code  TEXT,                           -- codul generat la aprobare
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at   TEXT,
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Lista din admin: pending primele, apoi cele mai noi.
CREATE INDEX IF NOT EXISTS idx_invite_requests_status
  ON invite_requests (status, id DESC);

-- Verificarea „mai există o cerere pending cu acest email".
CREATE INDEX IF NOT EXISTS idx_invite_requests_email
  ON invite_requests (email, status);
