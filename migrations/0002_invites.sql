-- =====================================================================
-- 0002 — Coduri de invitatie
--
-- Cerinta: doar adminii genereaza coduri, iar conturile noi se pot crea
-- NUMAI cu un cod valid. Fara cod -> inregistrarea e respinsa.
--
-- Exceptie (bootstrap): cat timp tabelul users e gol, prima inregistrare
-- se face fara cod si devine admin. Altfel nu ar exista nicio cale de a
-- crea primul admin care sa genereze coduri.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invite_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  note       TEXT    NOT NULL DEFAULT '',      -- ex. „pentru grupul de Discord"
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Codurile sunt de unica folosinta: used_by ramane NULL pana la folosire.
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT,

  -- Revocarea nu sterge randul: pastreaza dovada ca adminul l-a anulat.
  revoked    INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

-- Cautarea la inregistrare e dupa cod -> index obligatoriu (pe D1 se numara
-- randurile SCANATE, nu cele returnate).
CREATE INDEX IF NOT EXISTS idx_invites_code    ON invite_codes(code);
-- Panoul admin listeaza codurile de la cel mai nou.
CREATE INDEX IF NOT EXISTS idx_invites_created ON invite_codes(created_at DESC);
-- Filtrul „coduri nefolosite" din panoul admin.
CREATE INDEX IF NOT EXISTS idx_invites_unused  ON invite_codes(used_by, revoked);
