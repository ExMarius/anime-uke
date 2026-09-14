-- Cosmetice premium: culoarea numelui + tema site-ului.
-- Detinerea traieste in user_items (ca si ceilalti itemi); aici doar
-- culoarea/tema ACTIVA la nivel de utilizator si culoarea persistata
-- per mesaj de chat (ca istoricul sa arate la fel ca live).
ALTER TABLE users ADD COLUMN active_name_color TEXT NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN active_theme TEXT NULL DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN name_color TEXT NULL DEFAULT NULL;
