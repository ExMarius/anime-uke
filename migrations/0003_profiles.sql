-- =====================================================================
-- 0003 — Profil public + lista „de vizionat"
--
-- Cerinta: pagina de profil cu sectiunile „Informatii" si „Acces rapid",
-- in stilul AnimeNexus (data nasterii, zodie, gen, tara, membru din,
-- motto, link MyAnimeList, serii vizionate / episoade / de vizionat).
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. PROFILURI
-- ---------------------------------------------------------------------
-- Tabel separat de `users` din doua motive:
--   * users ramane mic si indexat — e interogat la FIECARE request pentru
--     validarea sesiunii, deci nu are rost sa care dupa el campuri de profil.
--   * profilul e optional; un utilizator exista chiar daca nu si l-a completat.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_date TEXT    NOT NULL DEFAULT '',   -- ISO: YYYY-MM-DD
  gender     TEXT    NOT NULL DEFAULT ''
             CHECK (gender IN ('', 'male', 'female', 'other')),
  country    TEXT    NOT NULL DEFAULT '',
  motto      TEXT    NOT NULL DEFAULT '',   -- „gand de impartășit"
  mal_url    TEXT    NOT NULL DEFAULT '',   -- MyAnimeList
  avatar_url TEXT    NOT NULL DEFAULT '',
  faction    TEXT    NOT NULL DEFAULT '',
  updated_at TEXT
);

-- ---------------------------------------------------------------------
-- 2. LISTA „SERII DE VIZIONAT" (watchlist)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES anime_series(id)  ON DELETE CASCADE,
  added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, series_id)
);

-- „Serii de vizionat" din Acces rapid: mereu pentru un user, de la cel mai nou.
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, added_at DESC);
