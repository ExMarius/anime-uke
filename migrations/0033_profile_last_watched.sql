-- =====================================================================
-- 0033 — ultima vizionare din profil
--
-- Profilul propriu arată un link către ultimul episod marcat ca vizionat.
-- Fără acest index, ORDER BY watched_at ar sorta toate episoadele văzute de
-- un utilizator; la un istoric mare, un simplu profil ar irosi rânduri D1.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_watched_user_recent
  ON watched_history(user_id, watched_at DESC, id DESC);
