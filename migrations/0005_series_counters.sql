-- =====================================================================
-- 0005 — numar de episoade stocat pe serie + indexi pentru paginare
--
-- PROBLEMA LA 1000+ SERII
--   Lista publica facea, pentru FIECARE serie, un COUNT(*) corelat pe
--   episodes. Cu un index pe episodes(series_id) asta e o scanare de
--   interval — ieftina pentru o serie de 12 episoade, dar o serie lunga
--   (One Piece are peste 1100) scanneaza 1100 de intrari in index. La 24
--   de serii pe pagina si 1000 de utilizatori zilnici, cota gratuita D1
--   de 5M randuri citite/zi se duce aproape integral pe numarat episoade
--   care oricum se schimba rar.
--
--   episode_count se modifica doar cand un admin adauga sau sterge un
--   episod — adica de cateva ori pe zi, nu de mii de ori. E exact cazul
--   in care denormalizarea merita: scriere rara, citire foarte deasa.
--
--   total_views NU e denormalizat: ar trebui actualizat la fiecare
--   vizionare (scriere deasa), iar singurul loc unde se foloseste e
--   ordonarea a 4 recomandari de pe profil. Costul nu justifica riscul
--   de a pierde sincronizarea.
-- =====================================================================

ALTER TABLE anime_series ADD COLUMN episode_count INTEGER NOT NULL DEFAULT 0;

-- Umplem coloana din datele existente. Fara pasul asta, toate seriile ar
-- arata „0 EP" pana la primul episod adaugat dupa migrare.
UPDATE anime_series
   SET episode_count = (SELECT COUNT(*) FROM episodes WHERE episodes.series_id = anime_series.id);

-- Indexii sustin sortarile din lista publica. Fara ei, ORDER BY ... LIMIT 25
-- ar sorta tot tabelul (adica ar citi toate randurile) la fiecare cerere.
CREATE INDEX IF NOT EXISTS idx_series_created ON anime_series(created_at);
CREATE INDEX IF NOT EXISTS idx_series_title   ON anime_series(title);
CREATE INDEX IF NOT EXISTS idx_series_epcount ON anime_series(episode_count);

-- ---------------------------------------------------------------------
-- Contorul de serii, pentru ca lista publica sa poata arata „pagina 3 din
-- 42" fara un COUNT(*) pe tot tabelul. Un COUNT pe 1000 de serii costa
-- 1000 de randuri citite; la 5000 de vizualizari/zi asta ar insemna 5M de
-- randuri — exact plafonul gratuit D1. Citirea unei singure randuri din
-- site_meta costa de o mie de ori mai putin.
--
-- Se actualizeaza in aceeasi tranzactie cu INSERT/DELETE pe anime_series
-- (D1 batch()), deci nu are cum sa deriveze.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_meta (
  key   TEXT    PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR REPLACE INTO site_meta (key, value)
VALUES ('series_total', (SELECT COUNT(*) FROM anime_series));

-- Totalul de episoade, pentru statistica din partea de sus a paginii
-- principale. Fara el, hero-ul ar numara doar cele 24 de serii de pe pagina
-- curenta si ar arata „24 episoade" intr-un catalog cu 12.000.
INSERT OR REPLACE INTO site_meta (key, value)
VALUES ('episodes_total', (SELECT COUNT(*) FROM episodes));
