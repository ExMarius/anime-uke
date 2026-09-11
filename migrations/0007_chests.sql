-- =====================================================================
-- 0007 — Cufere cu comori
--
-- Ideea: timpul petrecut efectiv pe un anime sa fie rasplatit dincolo de
-- punctele fixe de la 15 minute. Fiecare serie are trei cufere (bronz,
-- argint, aur) care se deblocheaza la praguri de timp acumulat pe seria
-- respectiva, iar deschiderea lor acorda puncte.
--
-- Timpul NU se stocheaza dublu: vine din watch_progress (insumat pe
-- episoadele seriei), deci cuferele mostenesc aceeasi garantie ca punctele
-- de la 15 minute — se bazeaza pe secunde reale de vizionare, nu pe clickuri.
--
-- Tabelul de fata retine doar FAPTUL ca un cufar a fost deschis, o singura
-- data: PK(user_id, series_id, tier) face dubla deschidere imposibila la
-- nivelul bazei, nu al aplicatiei.
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chests_claimed (
  user_id    INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  tier       INTEGER NOT NULL,
  claimed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id, tier)
);

-- Panoul de cufere de pe pagina seriei intreaba „ce am deschis aici?",
-- deci filtram dupa utilizator si serie in acelasi timp.
CREATE INDEX IF NOT EXISTS idx_chests_user_series
  ON chests_claimed (user_id, series_id);
