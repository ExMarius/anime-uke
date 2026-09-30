-- =====================================================================
-- 0034 — Noutățile site-ului
--
-- Prima pagină avea deja „Ultimele episoade adăugate" (din `episodes`), dar
-- nimic nu spunea că s-a adăugat o SERIE nouă, că s-a schimbat tema de sezon
-- sau că administrația are un anunț. Fără un jurnal, singura variantă ar fi
-- fost să interogăm la fiecare vizită patru tabele diferite și să le sortăm
-- împreună — exact tipul de citire care mănâncă cota D1 (5M rânduri/zi).
--
-- Aici scriem o singură dată, la EVENIMENT (operațiuni rare, doar admin), și
-- citim mereu cu LIMIT mic, pe index. Costul unei vizite: 6 rânduri.
--
-- Intenționat NU scriem un rând per episod: aia e deja lista „Ultimele
-- episoade", iar un episod pe zi ar îneca anunțurile reale.
-- =====================================================================

CREATE TABLE IF NOT EXISTS news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'serie'   = serie nouă în catalog
  -- 'sezon'   = tema de sezon activată/oprită
  -- 'anunt'   = anunț scris de administrație
  kind       TEXT    NOT NULL DEFAULT 'anunt'
             CHECK (kind IN ('serie', 'sezon', 'anunt')),
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  -- Link intern (ex. /serie/1014). Gol = știrea nu duce nicăieri.
  link       TEXT    NOT NULL DEFAULT '',
  -- TEXT datetime('now'), ca peste tot în schemă: `relativeTime()` din
  -- core.js parsează exact acest format („acum 3 ore").
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Cine a scris anunțul manual. Știrile automate au NULL.
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Prima pagină cere mereu ultimele N. Fără index, ORDER BY ar sorta tot
-- jurnalul; cu el, citirea rămâne constantă oricât crește istoricul.
CREATE INDEX IF NOT EXISTS idx_news_recent ON news(created_at DESC, id DESC);
