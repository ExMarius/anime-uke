-- =====================================================================
-- 0002 — progresul de vizionare (watch_progress) în Turso
--
-- DE CE: `watch_progress` este singura cale care scrie des în D1 (un
-- heartbeat la 5 minute × episod × spectator). La scenariul țintă de
-- 500 spectatori × 12 episoade de 24 minute înseamnă ~30.000 de
-- rows_written/zi din cele ~61.300 proiectate — adică jumătate din
-- consumul D1 pentru o singură funcționalitate. Turso (planul gratuit,
-- fără card) absoarbe exact acest tip de scriere.
--
-- CE NU SE MUTĂ: `watched_history`, punctele, XP-ul, gold-ul și
-- misiunile rămân în D1. Recompensa „exact o dată” depinde de
-- `INSERT OR IGNORE INTO watched_history` + `meta.changes`, care este
-- atomic doar în interiorul aceleiași baze. Progresul e un CONTOR
-- monoton; recompensa e o TRANZACȚIE. Doar contorul pleacă.
--
-- DENORMALIZARE DELIBERATĂ (`series_id`): în D1, topul săptămânal și
-- cuferele fac JOIN cu `episodes`. Între două baze diferite nu există
-- JOIN, deci seria se scrie odată cu progresul. Este o coloană derivată
-- dintr-un rând imuabil (`episodes.series_id`), nu o a doua sursă de
-- adevăr.
--
-- REGULA DE FUZIUNE: `seconds` este monoton crescător, deci orice
-- reconciliere (backfill, fallback, rulare repetată) folosește MAX().
-- Astfel migrarea și backfill-ul sunt idempotente și nu pot pierde timp
-- deja acumulat.
-- =====================================================================

CREATE TABLE IF NOT EXISTS watch_progress (
  user_id    INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  -- Seria episodului, copiată la scriere (vezi „denormalizare” mai sus).
  series_id  INTEGER NOT NULL DEFAULT 0,
  seconds    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

-- Topul săptămânal: căutare în interval pe updated_at (echivalentul lui
-- idx_progress_updated din migrarea D1 0028). Fără el, topul ar scana tot
-- tabelul — aceeași capcană ca în D1, doar mutată.
CREATE INDEX IF NOT EXISTS idx_turso_progress_updated ON watch_progress(updated_at);

-- Cuferele: secundele unui utilizator pe o serie, fără JOIN.
CREATE INDEX IF NOT EXISTS idx_turso_progress_user_series ON watch_progress(user_id, series_id);

-- „Continuă vizionarea”: ultimele episoade atinse de un utilizator.
CREATE INDEX IF NOT EXISTS idx_turso_progress_user_updated ON watch_progress(user_id, updated_at);

-- =====================================================================
-- Jurnalul de divergențe și incidente.
--
-- „Fallback” NU înseamnă „ascunde eroarea”. Orice cădere Turso, orice
-- timeout și orice diferență D1/Turso măsurată în modul shadow se
-- înregistrează aici, în Turso (nu în D1 — altfel observabilitatea ar
-- mânca exact cota pe care o economisim). `scripts/watch-turso.mjs
-- report` îl citește.
-- =====================================================================
CREATE TABLE IF NOT EXISTS watch_store_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'divergence' | 'turso_write_fail' | 'turso_read_fail' | 'fallback' | 'reconcile'
  kind       TEXT NOT NULL,
  user_id    INTEGER NOT NULL DEFAULT 0,
  episode_id INTEGER NOT NULL DEFAULT 0,
  d1_value   INTEGER NOT NULL DEFAULT 0,
  turso_value INTEGER NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watch_audit_kind ON watch_store_audit(kind, created_at);
