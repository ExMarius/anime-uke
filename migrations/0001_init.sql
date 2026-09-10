-- =====================================================================
-- AnimeSphere v2 — schema D1
-- Buget: Workers Free ($0). Optimizat pentru cotele gratuite:
--   5.000.000 randuri CITITE/zi · 100.000 randuri SCRISE/zi · 500 MB/DB
-- ATENTIE: din 1 sept. 2026 depasirea cotelor = esec HARD (query-ul pica),
-- nu degradare soft. De aceea TOATE coloanele folosite in WHERE/JOIN sunt
-- indexate — pe D1 se numara randurile SCANATE, nu cele returnate.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. UTILIZATORI
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  -- PBKDF2-SHA256, 20.000 iteratii (~4.45 ms CPU → incape in limita de 10 ms)
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,   -- 0 = user, 1 = admin
  is_banned     INTEGER NOT NULL DEFAULT 0,   -- 1 = nu se poate loga
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Login-ul cauta dupa email → index obligatoriu, altfel scanam tot tabelul.
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- Panoul admin sorteaza/filtreaza pe rol + puncte.
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);

-- ---------------------------------------------------------------------
-- 2. SERII ANIME
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anime_series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  cover_image TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'ongoing'
              CHECK (status IN ('ongoing','completed')),
  genre       TEXT    NOT NULL DEFAULT '',
  year        INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_series_created ON anime_series(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_series_status  ON anime_series(status);

-- ---------------------------------------------------------------------
-- 3. EPISOADE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episodes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id      INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title          TEXT    NOT NULL DEFAULT '',
  doodstream_url TEXT    NOT NULL DEFAULT '',
  views          INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Impiedica duplicatele (bug-ul real din v1: „One Piece" x2 in DB)
  UNIQUE (series_id, episode_number)
);

-- Cel mai accesat query din tot site-ul: „episoadele seriei X, ordonate".
CREATE INDEX IF NOT EXISTS idx_episodes_series
  ON episodes(series_id, episode_number);

-- ---------------------------------------------------------------------
-- 4. ISTORIC VIZIONARI + PUNCTE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watched_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id)  ON DELETE CASCADE,
  points     INTEGER NOT NULL DEFAULT 10,   -- punctele acordate la momentul marcarii
  watched_at TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Cerinta din spec: un episod se marcheaza O SINGURA DATA per utilizator.
  -- Fara acest UNIQUE, doua click-uri rapide = 20 puncte (race condition in v1).
  UNIQUE (user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_watched_user    ON watched_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watched_episode ON watched_history(episode_id);

-- ---------------------------------------------------------------------
-- 5. CHAT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Istoricul se citeste mereu „ultimele 30, descrescator" → index pe id DESC.
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(id DESC);

-- ---------------------------------------------------------------------
-- 6. AUDIT LOG ADMIN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_name  TEXT    NOT NULL DEFAULT '',
  action      TEXT    NOT NULL,   -- ex: create_series, ban_user, promote_admin
  target_type TEXT    NOT NULL DEFAULT '',   -- series | episode | user
  target_id   INTEGER,
  details     TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adminlog_created ON admin_log(created_at DESC);

-- =====================================================================
-- Curatare periodica (de rulat manual / cron, NU la fiecare request):
-- chat_messages creste nelimitat → pe planul gratuit e bine sa tii
-- doar ultimele ~5000 randuri, ca sa nu te apropii de 500 MB.
--
--   DELETE FROM chat_messages WHERE id NOT IN
--     (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 5000);
-- =====================================================================
