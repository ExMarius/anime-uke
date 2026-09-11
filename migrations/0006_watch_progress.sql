-- =====================================================================
-- 0006 — progres de vizionare per user + episod
--
-- Punctele si marcajul „vizionat" nu mai vin dintr-un buton apasat de
-- utilizator, ci din timp real de vizionare: abia dupa 15 minute acumulate
-- se marcheaza episodul ca vizionat si se acorda punctele.
--
-- De ce un tabel separat de watched_history: watched_history e STAREA
-- finala (episod vizionat, puncte acordate), pe cand watch_progress e
-- acumularea din mijloc, care se scrie des. Tinute impreuna ar insemna sa
-- scriem in tabelul de istoric la fiecare 30 de secunde de vizionare.
-- =====================================================================

CREATE TABLE IF NOT EXISTS watch_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  -- Secunde accumulate de vizionare activa (tab vizibil + player pornit).
  seconds    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

-- Cea mai deasa citire: „cat a vizionat userul X din episodul Y", ca sa
-- desenam bara de progres la deschiderea paginii.
CREATE INDEX IF NOT EXISTS idx_progress_user ON watch_progress(user_id);
