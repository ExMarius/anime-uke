-- =====================================================================
-- 0028 — Ce se rupea la 1.000 de serii / 1.000 de utilizatori.
--
-- Întrebarea proprietarului (22.09): „duce 1.000 de utilizatori și 1.000
-- de serii?" Am măsurat cu `node scripts/bench-scale.mjs` (D1 local, aceleași
-- migrări, date sintetice la scară maximă: 1.000 serii, 19.788 episoade,
-- 1.000 utilizatori, 199.011 rânduri de progres, 29.578 note) și răspunsul
-- era NU — nu din cauza invocărilor (acelea sunt ~2/vizită), ci a RÂNDURILOR
-- CITITE, metrica pe care o taxează D1 (5 milioane/zi pe planul gratuit).
--
-- Trei interogări din prima pagină scaneau tabele întregi, la fiecare vizită:
--   * TOP săptămânal (watch_progress, fără index pe updated_at) → 199.011
--   * TOP notate (series_ratings, agregare live pe fiecare cerere)  →  29.578
--   * pulse (COUNT/SUM pe episodes + anime_series + users)          →  41.576
-- Total ~230.000 de rânduri citite pentru O vizită pe prima pagină, adică
-- ~21 de vizite/zi până la epuizarea cotei. Migrarea asta pune indexurile și
-- contoarele care aduc aceeași pagină la ~370 de rânduri/vizită.
--
-- Ce face, punct cu punct (fiecare rând are și codul care-l folosește):
--   1. idx_progress_updated       → top.js: „ultimele 7 zile" devine căutare
--      în index (interval), nu scanare de tabel.
--   2. anime_series.rating_avg / rating_count + idx_series_rating
--      → top.js „cele mai bine notate" citește 5 rânduri din index în loc să
--      facă GROUP BY pe toate notele site-ului. Coloanele se resincronizează
--      la fiecare vot (src/lib/ratings.js), în ACELAȘI batch cu votul.
--      rating_avg se ține ROTUNJIT la o zecimală exact cum îl afișa site-ul,
--      ca ordinea clasamentului să fie identică cu cea de dinainte.
--   3. idx_series_created_id      → catalogul (ORDER BY created_at DESC,
--      id DESC) nu mai are nevoie de un B-tree temporar pentru al doilea
--      criteriu: indexul acoperă ambele, deci se oprește după 24 de rânduri.
--   4. site_meta.users_total / views_total → pulse citește 4 contoare în loc
--      să numere toate episoadele și toate conturile la fiecare reîmprospătare
--      (se întrețin în register.js, respectiv la flush-ul din StatsDO).
--
-- Contoarele se inițializează din datele existente, iar ON CONFLICT păstrează
-- maximul: un contor care numără lucruri care doar cresc nu are voie să scadă
-- dacă migrarea s-ar rula din nou pe o bază deja folosită.
-- =====================================================================

-- 1. Top săptămânal: filtrul pe updated_at fără index = scanare completă.
CREATE INDEX IF NOT EXISTS idx_progress_updated ON watch_progress(updated_at);

-- 2. Media notelor, denormalizată pe serie (ca episode_count din 0005).
ALTER TABLE anime_series ADD COLUMN rating_avg   REAL    NOT NULL DEFAULT 0;
ALTER TABLE anime_series ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;

UPDATE anime_series SET
  rating_avg = COALESCE(
    (SELECT ROUND(AVG(r.rating), 1) FROM series_ratings r WHERE r.series_id = anime_series.id), 0
  ),
  rating_count = (
    SELECT COUNT(*) FROM series_ratings r WHERE r.series_id = anime_series.id
  );

CREATE INDEX IF NOT EXISTS idx_series_rating ON anime_series(rating_avg DESC, rating_count DESC);

-- 3. Catalogul: un singur index pentru ambele criterii de sortare.
CREATE INDEX IF NOT EXISTS idx_series_created_id ON anime_series(created_at DESC, id DESC);

-- 4. Contoarele din site_meta pentru pulse.
INSERT INTO site_meta (key, value) VALUES
  ('users_total',  (SELECT COUNT(*) FROM users)),
  ('views_total',  (SELECT COALESCE(SUM(views), 0) FROM episodes))
ON CONFLICT(key) DO UPDATE SET value = MAX(site_meta.value, excluded.value);
