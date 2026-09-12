-- =====================================================================
-- 0011 — Economie: XP cu niveluri, puncte lunare, gold, cufăr la 4 ore,
--         insigne. Sistemul de personaje e EXCLUS deliberat.
--
-- XP-ul si gold-ul stau pe randul utilizatorului (citirea e gratuita,
-- vin odata cu sesiunea). Punctele lunare au tabel propriu, cu o linie
-- per luna: resetarea lunara e implicita (luna noua = rand nou), nu un
-- cron care sa ruleze la 1 ale lunii.
-- =====================================================================

ALTER TABLE users ADD COLUMN xp    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN gold  INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_monthly_points (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month   TEXT    NOT NULL,              -- 'YYYY-MM'
  points  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS chest_cooldown (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_opened_at TEXT    NOT NULL,
  opens          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge   TEXT    NOT NULL,
  month   TEXT    NOT NULL DEFAULT '',   -- luna pentru insigna lunara
  PRIMARY KEY (user_id, badge, month)
);
CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges (user_id);
