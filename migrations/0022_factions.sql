-- Facțiuni = temele de grade (anime-uri adăugate de admin). Alegerea se
-- face o dată pe lună; timpul lunii acumulează REPUTAȚIE pentru facțiune.
-- La final de lună (plată leneșă, fără cron):
--   * membrul cu rep maxim din fiecare facțiune devine LIDER luna următoare
--   * facțiunea cu rep total maxim câștigă -> 1.5x gold/XP pentru membri
ALTER TABLE users ADD COLUMN faction_slug TEXT NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN faction_month TEXT NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS faction_rep (
  month   TEXT    NOT NULL,            -- YYYY-MM
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faction TEXT    NOT NULL,
  rep     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, user_id)
);
CREATE INDEX IF NOT EXISTS idx_frep_rank ON faction_rep(month, faction, rep DESC);

CREATE TABLE IF NOT EXISTS faction_leaders (
  month   TEXT    NOT NULL,            -- luna PENTRU care e lider
  faction TEXT    NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rep     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, faction)
);
CREATE INDEX IF NOT EXISTS idx_flead_user ON faction_leaders(user_id, month);

CREATE TABLE IF NOT EXISTS faction_winners (
  month     TEXT NOT NULL PRIMARY KEY, -- luna PENTRU care e bonusul
  faction   TEXT NOT NULL,
  total_rep INTEGER NOT NULL DEFAULT 0
);
