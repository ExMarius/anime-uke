-- =====================================================================
-- 0031 — Realizări (achievements): catalog în cod, legătură în D1.
--
-- De ce un tabel și nu o coloană JSON pe users: realizările se citesc pe
-- profil (publice), se numără pentru procentul de completare și se scriu
-- o singură dată, la deblocare. O linie per (user, realizare) cu cheie
-- primară compusă = citire pe cheie, scriere idempotentă (INSERT OR IGNORE),
-- zero migrații viitoare când se adaugă realizări noi în catalog.
--
-- Catalogul (nume, icon, prag, recompensă) trăiește în src/lib/achievements.js.
-- Aici nu duplicăm nimic: un id care nu mai există în cod e ignorat la
-- citire, iar unul nou apare automat ca „nedeblocat”.
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ach_id      TEXT    NOT NULL,
  unlocked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ach_id)
);

-- Numărul de comentarii/recenzii per user se citea deja la fiecare postare
-- (insignele din 0011). Recenziile nu aveau index pe user_id, deci COUNT-ul
-- de realizări ar fi scanat tabelul. Îl adăugăm o dată, cât tabelul e mic.
CREATE INDEX IF NOT EXISTS idx_reviews_user ON series_reviews (user_id);
