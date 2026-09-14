-- TOP-ul saptamanal premiaza in gold: o intrare per (saptamana, user).
-- Exista randuri pentru saptamana W = W a fost deja premiata (platirea e
-- „lena": prima deschidere a clasamentului dupa sfarsitul lui W o declanseaza).
CREATE TABLE IF NOT EXISTS lb_prizes (
  week    TEXT    NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place   INTEGER NOT NULL,
  gold    INTEGER NOT NULL,
  points  INTEGER NOT NULL,
  PRIMARY KEY (week, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lb_prizes_week ON lb_prizes(week, place);
