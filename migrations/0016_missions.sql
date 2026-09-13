-- Misiuni zilnice + streak — „motivul să revii mâine”.
--
-- Modelele care functioneaza pe site-urile de anime cu comunitate (ex.
-- AnimeNexus cu AnimeBingo) arata clar: utilizatorul are nevoie de SCOPURI
-- pe termen scurt cu recompense logice, nu de patru contoare neexplicate.
-- De aceea:
--   * PUNCTELE raman trofeul de VIZIONARE (+10/episod) — clasamentul onest;
--   * XP -> NIVEL -> RANG (Genin..Hokage) din activitate;
--   * GOLD doar din cufar (noroc) si misiuni (sigur), cheltuit in shop;
--   * misiunile zilnice dau gold sigur celor care nu trag la cufar bine.
--
-- daily_missions: progres per (user, zi UTC, misiune). Ziua UTC simpla e
-- deliberata: resetarea e identica pentru toti, ca la Nexus.
CREATE TABLE IF NOT EXISTS daily_missions (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT    NOT NULL,
  mission  TEXT    NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, mission)
);
CREATE INDEX IF NOT EXISTS idx_missions_day ON daily_missions (day);

-- Streak (zile consecutive cu activitate). O linie per user, ieftin.
CREATE TABLE IF NOT EXISTS user_streak (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current  INTEGER NOT NULL DEFAULT 0,
  best     INTEGER NOT NULL DEFAULT 0,
  last_day TEXT    NOT NULL DEFAULT ''
);
