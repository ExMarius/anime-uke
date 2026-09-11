-- =====================================================================
-- 0004 — surse video multiple per episod
--
-- De ce un tabel separat si nu o coloana JSON pe episodes?
--   D1 nu indexeaza campuri din JSON, deci „cate surse are episodul X"
--   ar insemna scanare + parsare. Un tabel cu FK si index pe episode_id
--   face citirea unei singure interogari, iar ON DELETE CASCADE curata
--   sursele odata cu episodul (fara randuri orfane).
--
-- Coloana episodes.doodstream_url devine redundant: datele existente sunt
-- mutate aici, apoi coloana e stearsa. O lasam pana la finalul migrarii ca
-- sa nu pierdem nimic daca ceva esueaza la mijloc.
-- =====================================================================

CREATE TABLE IF NOT EXISTS episode_sources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL DEFAULT 'Sursă',
  -- embed = iframe (DoodStream, Vidstream, Streamtape…)
  -- file  = fisier video direct, redat cu <video>
  -- link  = pagina externa, deschisa intr-un tab nou
  kind       TEXT    NOT NULL DEFAULT 'embed' CHECK (kind IN ('embed','file','link')),
  url        TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Aceeasi sursa nu are ce cauta de doua ori la acelasi episod.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esrc_episode_url ON episode_sources(episode_id, url);
-- Query-ul fierbinte: „sursele episodului X, in ordinea din panou".
CREATE INDEX IF NOT EXISTS idx_esrc_episode ON episode_sources(episode_id, sort_order, id);

-- Migrarea datelor existente: fiecare episod cu URL DoodStream primeste
-- o sursa „DoodStream". TRIM() exclude randurile goale.
INSERT INTO episode_sources (episode_id, label, kind, url, sort_order, is_active)
SELECT id, 'DoodStream', 'embed', doodstream_url, 0, 1
FROM episodes
WHERE TRIM(COALESCE(doodstream_url, '')) <> '';

ALTER TABLE episodes DROP COLUMN doodstream_url;
