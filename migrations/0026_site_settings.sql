-- =====================================================================
-- 0026 — Setări de site persistate în D1 (key/value).
--
-- Prima utilizare: MONETIZAREA. Sloturile de reclame se configurează din
-- panoul admin (tab „Monetizare") și se salvează aici — fără ele, orice
-- schimbare de reclamă ar fi cerut un deploy. Cheile folosite azi:
--   ads — JSON cu configurația sloturilor (vezi src/lib/settings.js)
--
-- Tabela e generică intenționat: următoarele setări de site (mesaj de
-- anunț, mod mentenanță, etc.) intră tot aici, fără migrare nouă.
--
-- Cost D1: citirile trec prin cache-ul de izolat din src/lib/settings.js
-- (5 min), scrierile se fac doar când adminul apasă „Salvează".
-- =====================================================================

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
