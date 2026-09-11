-- =====================================================================
-- 0009 — Subtitrari (WebVTT) per episod
--
-- Telul: cand continutul real (subtitrat in romana) intra in site,
-- subtitrarea sa fie un camp de completat, nu o refactorizare. Playerul
-- ataseaza fisierul ca <track kind="subtitles" srclang="ro">.
--
-- Coloana e optionala si goala by default: catalogul existent nu se
-- schimba cu nimic.
-- =====================================================================

ALTER TABLE episodes ADD COLUMN subtitle_url TEXT NOT NULL DEFAULT '';
