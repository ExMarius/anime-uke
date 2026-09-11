-- =====================================================================
-- 0008 — Cache pentru clasament
--
-- Clasamentul (top utilizatori dupa puncte + episoadele saptamanii) ar
-- costa o scanare a tabelului users la FIECARE cerere: la 1000 de
-- utilizatori/zi care se uita de cateva ori pe zi, ar insemna milioane de
-- randuri citite pe zi din plafonul gratuit de 5M.
--
-- De aceea rezultatul se calculeaza doar cand cache-ul e invechit (15 min)
-- si se serveste dintr-un singur rand altfel. Costul unei cereri obisnuite:
-- 1 rand citit. Costul unei recalculari: o scanare, de ~96 de ori pe zi.
-- =====================================================================

CREATE TABLE IF NOT EXISTS leaderboard_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
