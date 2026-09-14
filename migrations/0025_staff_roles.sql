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
--   'moderator' — Moderator (badge + drepturi de moderare; is_mod ramane
--                 flagul de DREPTURI si se tine sincronizat de API)
-- Adminii raman marcati prin is_admin (tabul Utilizatori).
-- =====================================================================

ALTER TABLE users ADD COLUMN staff_role TEXT NOT NULL DEFAULT '';

UPDATE users SET staff_role = 'moderator' WHERE is_mod = 1 AND staff_role = '';
