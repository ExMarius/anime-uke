-- =====================================================================
-- 0031 — versiunea sesiunii
--
-- JWT-ul este stateless: fara o versiune in baza, schimbarea parolei ar
-- lasa toate cookie-urile vechi valide pana la expirarea lor. Incrementam
-- `auth_version` la schimbarea parolei, iar fiecare request compara versiunea
-- din token cu cea din DB. Astfel sesiunile vechi devin imediat invalide.
-- =====================================================================

ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
