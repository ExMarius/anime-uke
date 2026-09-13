-- Avatarul in istoricul chatului: mesajul pastreaza avatarul pe care
-- utilizatorul il avea cand a scris (ca la orice platforma de chat).
-- ALTER e idempotent in D1: daca ruleaza a doua oara pica politicos, iar
-- wrangler tine evidenta in d1_migrations deci nu re-aplica.
ALTER TABLE chat_messages ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
