-- =====================================================================
-- 0012 — Grade tematice + staff: identitate vizibila in chat, comentarii,
--         clasament si profil.
--
-- Gradele cresc din nivelul contului (economie), iar NUMELE lor vin din
-- teme inspirate din serii (Naruto, One Piece, Hunter x Hunter). Temele
-- stau in tabela rank_themes: adminul poate adauga teme noi din orice
-- serie („sa mai putem adauga de la alte serii chestii de genu”).
-- Fiecare user isi alege tema din profil.
--
-- Gradele de staff (Moderator/Admin) sunt separate de gradele de nivel:
-- un mod de nivelul 2 e tot „Moderator” in chat, pe langa gradul lui.
-- =====================================================================

ALTER TABLE users ADD COLUMN rank_theme TEXT NOT NULL DEFAULT 'naruto';
ALTER TABLE users ADD COLUMN is_mod     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_messages ADD COLUMN rank_label TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN rank_icon  TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN staff_role TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS rank_themes (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  tiers      TEXT NOT NULL,             -- JSON: [{"min":1,"label":"Genin","icon":"…"}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO rank_themes (slug, title, tiers) VALUES
  ('naruto', 'Naruto — ranguri ninja',
   '[{"min":1,"label":"Genin","icon":"🍃"},{"min":5,"label":"Chunin","icon":"🌀"},{"min":10,"label":"Jonin","icon":"⚔️"},{"min":20,"label":"Kage","icon":"👑"},{"min":35,"label":"Hokage","icon":"🔥"}]'),
  ('onepiece', 'One Piece — piraterie',
   '[{"min":1,"label":"Rookie","icon":"🧭"},{"min":5,"label":"Supernova","icon":"✨"},{"min":12,"label":"Căpitan","icon":"⛵"},{"min":22,"label":"Shichibukai","icon":"🗡️"},{"min":32,"label":"Yonko","icon":"🏴☠️"}]'),
  ('hunter', 'Hunter x Hunter — vânători',
   '[{"min":1,"label":"Novice","icon":"🎒"},{"min":6,"label":"Pro Hunter","icon":"🪪"},{"min":14,"label":"Elite","icon":"💎"},{"min":26,"label":"Zodiac","icon":"🐉"}]');
