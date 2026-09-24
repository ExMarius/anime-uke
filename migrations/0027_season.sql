-- Setari globale ale site-ului (cheie → valoare), editabile din admin.
-- Prima folosire: tema de sezon — cand e setata, utilizatorii FARA tema
-- personala (active_theme NULL) o vad ca implicita; cei cu tema personala
-- nu sunt afectati. Rezolvarea se face in GET /api/auth/me.
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('seasonal_theme', '');
