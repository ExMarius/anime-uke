-- Facțiunile = temele de grade. Lista completă cerută (22 anime),
-- cu ranguri tematice per serie. Slug-urile vechi (hunter, onepiece) se
-- redenumesc consistent peste tot, ca nimeni să nu rămână cu referințe moarte.

UPDATE users SET rank_theme = 'hunter-x-hunter' WHERE rank_theme = 'hunter';
UPDATE users SET faction_slug = 'hunter-x-hunter' WHERE faction_slug = 'hunter';
UPDATE faction_rep SET faction = 'hunter-x-hunter' WHERE faction = 'hunter';
UPDATE faction_leaders SET faction = 'hunter-x-hunter' WHERE faction = 'hunter';
UPDATE faction_winners SET faction = 'hunter-x-hunter' WHERE faction = 'hunter';

UPDATE users SET rank_theme = 'one-piece' WHERE rank_theme = 'onepiece';
UPDATE users SET faction_slug = 'one-piece' WHERE faction_slug = 'onepiece';
UPDATE faction_rep SET faction = 'one-piece' WHERE faction = 'onepiece';
UPDATE faction_leaders SET faction = 'one-piece' WHERE faction = 'onepiece';
UPDATE faction_winners SET faction = 'one-piece' WHERE faction = 'onepiece';

DELETE FROM rank_themes WHERE slug IN ('hunter', 'onepiece');

INSERT INTO rank_themes (slug, title, tiers) VALUES ('yu-yu-hakusho', 'Yu Yu Hakusho — clase de demoni', '[{"min": 1, "icon": "🥋", "label": "Delincvent"}, {"min": 5, "icon": "👻", "label": "Detectiv spiritual"}, {"min": 10, "icon": "🌀", "label": "Clasa B"}, {"min": 20, "icon": "🔥", "label": "Clasa A"}, {"min": 35, "icon": "👑", "label": "Clasa S"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('tokyo-ghoul', 'Tokyo Ghoul — ranguri ghoul', '[{"min": 1, "icon": "👁️", "label": "Rang C"}, {"min": 5, "icon": "🐍", "label": "Rang B"}, {"min": 10, "icon": "🔥", "label": "Rang A"}, {"min": 20, "icon": "💀", "label": "Rang S"}, {"min": 35, "icon": "👑", "label": "Rang SS"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('tensei-shitara-slime', 'Tensei shitara Slime — Tempest', '[{"min": 1, "icon": "🫧", "label": "Slime"}, {"min": 5, "icon": "🐺", "label": "Ogre"}, {"min": 10, "icon": "🌀", "label": "Kijin"}, {"min": 20, "icon": "😈", "label": "Rege demoniu"}, {"min": 35, "icon": "👑", "label": "Stăpânul Tempest"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('sword-art-online', 'Sword Art Online — Aincrad', '[{"min": 1, "icon": "⚔️", "label": "Jucător nou"}, {"min": 5, "icon": "🗡️", "label": "Beater"}, {"min": 10, "icon": "🏰", "label": "Cuceritor de etaj"}, {"min": 20, "icon": "💎", "label": "Cavalerul Sângelui"}, {"min": 35, "icon": "👑", "label": "Eroul Aincrad"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('sousou-no-frieren', 'Sousou no Frieren — magi', '[{"min": 1, "icon": "🪄", "label": "Novice"}, {"min": 5, "icon": "🌿", "label": "Mag călător"}, {"min": 10, "icon": "📖", "label": "Mag clasa a III-a"}, {"min": 20, "icon": "📜", "label": "Mag de clasa I"}, {"min": 35, "icon": "👑", "label": "Magul erei"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('solo-leveling', 'Solo Leveling — vânători', '[{"min": 1, "icon": "🟢", "label": "Vânător rang E"}, {"min": 5, "icon": "🟡", "label": "Vânător rang C"}, {"min": 10, "icon": "🔴", "label": "Vânător rang A"}, {"min": 20, "icon": "⬛", "label": "Vânător rang S"}, {"min": 35, "icon": "👑", "label": "Monarhul Umbrelor"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('shingeki-no-kyojin', 'Shingeki no Kyojin — Exploratori', '[{"min": 1, "icon": "🎓", "label": "Cadet"}, {"min": 5, "icon": "🧱", "label": "Garnizoana"}, {"min": 10, "icon": "👮", "label": "Poliția Militară"}, {"min": 20, "icon": "🐎", "label": "Explorator"}, {"min": 35, "icon": "👑", "label": "Comandant"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('one-piece', 'One Piece — piraterie', '[{"min": 1, "icon": "🧭", "label": "Pirat amator"}, {"min": 5, "icon": "⚓", "label": "Căpitan"}, {"min": 10, "icon": "🏴", "label": "Supernova"}, {"min": 20, "icon": "💰", "label": "Shichibukai"}, {"min": 35, "icon": "👑", "label": "Regele Piraților"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('noragami', 'Noragami — zei și shinki', '[{"min": 1, "icon": "🎐", "label": "Spirit rătăcit"}, {"min": 5, "icon": "⚔️", "label": "Shinki devotat"}, {"min": 10, "icon": "⛩️", "label": "Zeu minor"}, {"min": 20, "icon": "💥", "label": "Zeul războiului"}, {"min": 35, "icon": "👑", "label": "Zeul norocului"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('naruto', 'Naruto — ranguri ninja', '[{"min": 1, "icon": "🍃", "label": "Genin"}, {"min": 5, "icon": "🌀", "label": "Chunin"}, {"min": 10, "icon": "⚔️", "label": "Jonin"}, {"min": 20, "icon": "👑", "label": "Kage"}, {"min": 35, "icon": "🔥", "label": "Hokage"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('kimetsu-no-yaiba', 'Kimetsu no Yaiba — vânătorii de demoni', '[{"min": 1, "icon": "💧", "label": "Mizunoto"}, {"min": 5, "icon": "🌩️", "label": "Kanoe"}, {"min": 10, "icon": "🌑", "label": "Kinoe"}, {"min": 20, "icon": "🗡️", "label": "Hashira"}, {"min": 35, "icon": "👑", "label": "Maestru al sabiei"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('jujutsu-kaisen', 'Jujutsu Kaisen — grade de vrăjitori', '[{"min": 1, "icon": "🍀", "label": "Gradul 4"}, {"min": 5, "icon": "🌀", "label": "Gradul 2"}, {"min": 10, "icon": "⚔️", "label": "Gradul 1"}, {"min": 20, "icon": "💥", "label": "Grad special"}, {"min": 35, "icon": "👑", "label": "Regele Blestemelor"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('jojos-bizarre-adventure', 'JoJo''s Bizarre Adventure — Standuri', '[{"min": 1, "icon": "☀️", "label": "Hamon novice"}, {"min": 5, "icon": "🧬", "label": "Utilizator de Stand"}, {"min": 10, "icon": "⚔️", "label": "Stand luptător"}, {"min": 20, "icon": "💥", "label": "Stand Requiem"}, {"min": 35, "icon": "👑", "label": "Moștenitor Joestar"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('hunter-x-hunter', 'Hunter x Hunter — vânători', '[{"min": 1, "icon": "🎫", "label": "Candidat"}, {"min": 5, "icon": "⭐", "label": "Hunter"}, {"min": 10, "icon": "🌟", "label": "Hunter 1 stea"}, {"min": 20, "icon": "✨", "label": "Hunter 2 stele"}, {"min": 35, "icon": "👑", "label": "Hunter 3 stele"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('gintama', 'Gintama — Yorozuya', '[{"min": 1, "icon": "🍡", "label": "Freelancer Yorozuya"}, {"min": 5, "icon": "👮", "label": "Shinsengumi"}, {"min": 10, "icon": "🗡️", "label": "Căpitan Shinsengumi"}, {"min": 20, "icon": "📢", "label": "Rebel Joui"}, {"min": 35, "icon": "👑", "label": "Samurăi legendar"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('fullmetal-alchemist', 'Fullmetal Alchemist — Alchimiști de Stat', '[{"min": 1, "icon": "⚗️", "label": "Ucenic alchimist"}, {"min": 5, "icon": "🪙", "label": "Alchimist de Stat"}, {"min": 10, "icon": "🎖️", "label": "Alchimist-Maior"}, {"min": 20, "icon": "🏅", "label": "Alchimist-Colonel"}, {"min": 35, "icon": "👑", "label": "Alchimist-General"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('fairy-tail', 'Fairy Tail — bresla vrăjitorilor', '[{"min": 1, "icon": "✨", "label": "Mag novice"}, {"min": 5, "icon": "🎴", "label": "Mag Fairy Tail"}, {"min": 10, "icon": "⚔️", "label": "Mag clasă S"}, {"min": 20, "icon": "🔥", "label": "Mag clasă SS"}, {"min": 35, "icon": "👑", "label": "Maestru al breslei"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('dragon-ball', 'Dragon Ball — artiști marțiali', '[{"min": 1, "icon": "🐢", "label": "Elevul lui Kame"}, {"min": 5, "icon": "🥋", "label": "Artist martial"}, {"min": 10, "icon": "💥", "label": "Super Saiyan"}, {"min": 20, "icon": "🔥", "label": "Super Saiyan Blue"}, {"min": 35, "icon": "👑", "label": "Ultra Instinct"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('date-a-live', 'Date A Live — întâlniri', '[{"min": 1, "icon": "💌", "label": "Salut"}, {"min": 5, "icon": "💗", "label": "Întâlnire"}, {"min": 10, "icon": "💞", "label": "Dragoste"}, {"min": 20, "icon": "💍", "label": "Logodnă"}, {"min": 35, "icon": "👑", "label": "Nuntă eternă"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('code-geass', 'Code Geass — șahul Britanniei', '[{"min": 1, "icon": "♟️", "label": "Pion"}, {"min": 5, "icon": "♞", "label": "Cavaler"}, {"min": 10, "icon": "♜", "label": "Turn"}, {"min": 20, "icon": "♛", "label": "Dama"}, {"min": 35, "icon": "♚", "label": "Împărat"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('bleach', 'Bleach — Gotei 13', '[{"min": 1, "icon": "⚔️", "label": "Ucenic Shinigami"}, {"min": 5, "icon": "💀", "label": "Locotenent"}, {"min": 10, "icon": "👘", "label": "Căpitan"}, {"min": 20, "icon": "🌑", "label": "Vaizard"}, {"min": 35, "icon": "👑", "label": "Maestru Bankai"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;

INSERT INTO rank_themes (slug, title, tiers) VALUES ('black-clover', 'Black Clover — cavalerii magici', '[{"min": 1, "icon": "🍀", "label": "Cavaler junior"}, {"min": 5, "icon": "🥉", "label": "Cavaler clasa a 3-a"}, {"min": 10, "icon": "⚔️", "label": "Cavaler clasa I"}, {"min": 20, "icon": "🌟", "label": "Grand Cavaler"}, {"min": 35, "icon": "👑", "label": "Căpitan al Crucii"}]')
  ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tiers = excluded.tiers;
