-- =====================================================================
-- 0025 — Grade de staff acordate manual: Helper / Staff / Moderator.
--
-- Pana acum „staff" insemna doar is_mod (Moderator) + is_admin. Panoul
-- admin „Grade" arata in schimb temele de NIVEL (Genin → Hokage), care
-- sunt automate si nu se „dau" nimanui — confuzie legitima.
--
-- users.staff_role e gradul de staff acordat de admin:
--   ''          — membru obisnuit
--   'helper'    — Helper (doar badge)
--   'staff'     — Staff (doar badge)
--   'moderator' — Moderator (badge + drepturi de moderare: canModerate())
-- Adminii raman marcati prin is_admin (tabul Utilizatori).
-- Vechiul users.is_mod e absorbit aici (UPDATE-ul de mai jos) si nu mai e
-- citit de cod; SQLite/D1 nu suporta ieftin DROP COLUMN, deci coloana
-- ramane in schema ca balast inofensiv.
-- =====================================================================

ALTER TABLE users ADD COLUMN staff_role TEXT NOT NULL DEFAULT '';

UPDATE users SET staff_role = 'moderator' WHERE is_mod = 1 AND staff_role = '';
