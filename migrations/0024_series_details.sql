-- =====================================================================
-- 0024 — Fișa detaliată a seriei (modelul site-urilor românești de anime)
--
-- Câmpurile pe care le are „Informații despre serie" pe AnimeNexus și
-- care lipseau la noi: titluri alternative, teme, vârsta minimă, durata
-- unui episod, data lansării, țara, link extern (MAL/AniList), echipa de
-- traducere. Toate opționale, goale by default — catalogul existent nu
-- se schimbă. Se editează din admin, se afișează pe pagina publică și
-- intră în JSON-LD (SEO).
-- =====================================================================
ALTER TABLE anime_series ADD COLUMN alt_titles   TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN themes       TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN age_rating   TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN ep_duration  INTEGER NULL DEFAULT NULL;
ALTER TABLE anime_series ADD COLUMN release_date TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN country      TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN external_url TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN team         TEXT NOT NULL DEFAULT '';

-- „Episodul următor: … · 14 septembrie, 18:00" — anunțul de pe pagina
-- seriei. Text liber scurt + o dată/ora opțională (ISO, ora locală a
-- adminului). Se golesc de admin după publicare; expiră vizual singur.
ALTER TABLE anime_series ADD COLUMN next_ep_note TEXT NOT NULL DEFAULT '';
ALTER TABLE anime_series ADD COLUMN next_ep_at   TEXT NOT NULL DEFAULT '';
