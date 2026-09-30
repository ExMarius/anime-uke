-- =====================================================================
-- 0035 — Moderarea chatului live
--
-- Chatul era singurul loc din site unde staff-ul NU putea face nimic: un
-- moderator care vedea o injurie, spam sau un link piratat putea doar să
-- privească. Comentariile au raportări, utilizatorii au ban — chatul, nimic.
--
-- Ca să poți șterge un mesaj, îți trebuie un identificator STABIL al lui.
-- Mesajele trăiesc în două locuri: bufferul durabil al ChatDO (cheile `m:<seq>`)
-- și arhiva D1. Până acum arhiva nu păstra nicio urmă a cheii din DO, deci un
-- mesaj deja arhivat nu mai putea fi legat de cel afișat în pagină.
--
-- `mid` e exact cheia din DO (secvența monotonă a chatului global), scrisă și
-- în arhivă la flush. Așa, o singură comandă de ștergere curăță ambele locuri,
-- indiferent dacă mesajul a apucat să ajungă în D1 sau nu.
--
-- Mesajele scrise ÎNAINTE de migrare rămân cu mid = '' (nu pot fi șterse
-- individual). Sunt cel mult ultimele 500 și ies singure din arhivă pe măsură
-- ce chatul avansează — nu merită o rescriere a tabelului pentru ele.
-- =====================================================================

ALTER TABLE chat_messages ADD COLUMN mid TEXT NOT NULL DEFAULT '';

-- Ștergerea caută exact un mid. Fără index ar fi scanare completă de tabel
-- (până la 500 de rânduri) la fiecare acțiune de moderare.
CREATE INDEX IF NOT EXISTS idx_chat_mid ON chat_messages(mid);
