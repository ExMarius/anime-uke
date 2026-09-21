-- =====================================================================
-- 0026 — Boost XP din shop (⚡ Boost XP 24h, Shop 2.0).
--
-- users.xp_boost_until e momentul (ms epoch) pana la care addXp() dubleaza
-- XP-ul din orice sursa. NULL/0 = fara boost. Cumpararile repetate prelungesc
-- durata (vezi shop-buy.js), nu se suprapun.
-- =====================================================================

ALTER TABLE users ADD COLUMN xp_boost_until INTEGER;
