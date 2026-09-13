-- =====================================================================
-- 0019 — Ștergerea sistemului de invitații
--
-- Decizie: înregistrarea e deschisă pentru toți. Sistemele pe coduri
-- (panoul de coduri + cererile de coduri de la vizitatori) au fost scoase
-- din cod, deci tabelele lor nu mai au rost — le tăiem ca să nu rămână
-- spațiu mort în D1 (buget 0).
--
-- Istoricul rămâne totuși în admin_log: „generate_invites" și
-- „invite_used" spun cine a generat și cine a consumat coduri, atât cât
-- a durat sistemul pe invitație.
-- =====================================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS invite_requests;
DROP TABLE IF EXISTS invite_codes;
