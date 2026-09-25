-- =====================================================================
-- 0029 — Sistem de prietenie
-- Cerere: click pe poza din chat -> profil -> adauga prieten
-- Model simplu: requester -> addressee, status pending/accepted/rejected
-- Un prieten = un rand cu status accepted, indiferent de directie.
-- Cautarea e in ambele directii, deci index pe ambele coloane.
-- =====================================================================

CREATE TABLE IF NOT EXISTS friendships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','rejected','blocked')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  -- O pereche nu poate avea decat o cerere activa la un moment dat.
  UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
-- Pentru verificarea rapida "exista deja prietenie intre A si B in orice directie"
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_reverse ON friendships(addressee_id, requester_id);
