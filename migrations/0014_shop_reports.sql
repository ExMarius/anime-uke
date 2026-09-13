-- =====================================================================
-- 0014 — Shop (sink de gold) + raportare surse stricate
--
-- user_items: ce detine fiecare (consumabile au qty>1, permanente qty=1).
-- source_reports: un index partial unic garanteaza ca un user nu poate
-- avea doua raportari DESCHISE pe aceeasi sursa — dedup fara interogari.
-- Colanele de chat (flair/name_gold) au DEFAULT ca istoricul vechi sa
-- ramana valid fara rescriere.
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_items (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    TEXT    NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS source_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source_id   INTEGER REFERENCES episode_sources(id) ON DELETE CASCADE,
  reason      TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'open',   -- open | fixed | dismissed
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON source_reports (status, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_open
  ON source_reports (user_id, episode_id, source_id) WHERE status = 'open';

ALTER TABLE chat_messages ADD COLUMN flair TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN name_gold INTEGER NOT NULL DEFAULT 0;
