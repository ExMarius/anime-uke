-- =====================================================================
-- 0010 — Nucleu de comunitate: rating, comentarii, continuare
--
-- Trei functii cerute de spec, fiecare cu cost mic pe D1:
--   - rating 1-10 per serie: un rand per utilizator (PK compus), media se
--     calculeaza pe indexul de serie, nu pe tot tabelul
--   - comentarii pe episod: lista paginabila simplu (ultimele 50), stergere
--     proprie sau de admin
--   - „continua vizionarea" nu are tabela proprie: se citeste din
--     watch_progress, care exista oricum
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS series_ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_series ON series_ratings (series_id);

CREATE TABLE IF NOT EXISTS episode_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_episode ON episode_comments (episode_id, id);
CREATE INDEX IF NOT EXISTS idx_comments_user    ON episode_comments (user_id);
