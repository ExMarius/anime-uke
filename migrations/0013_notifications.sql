-- =====================================================================
-- 0013 — Abonari la serii + notificari
--
-- Cand adminul posteaza un episod nou, toti abonatii seriei primesc o
-- notificare pr-un singur INSERT ... SELECT (o scriere D1 per abonat,
-- fara bucle in cod). Notificarile sunt mici si indexate pe (user, read)
-- ca badge-ul din nav sa coste o singura citire ieftina.
-- =====================================================================

CREATE TABLE IF NOT EXISTS series_subscriptions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id  INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_series ON series_subscriptions (series_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,             -- 'new_episode' etc.
  payload    TEXT    NOT NULL DEFAULT '{}',-- JSON: serie, episod, titluri
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read, id DESC);
