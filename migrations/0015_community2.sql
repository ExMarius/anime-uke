-- =====================================================================
-- 0015 — Community v2: voturi pe comentarii, raspunsuri, recenzii
--
-- comment_votes: PK (user, comment) = un vot per om; score-ul se agregă
--   SUM(vote) grupat pe comment_id (index acoperitor).
-- parent_id: raspunsuri un singur nivel (un raspuns la un raspuns se
--   ataseaza parintelui — firele adinci incurca mai mult decat ajuta).
-- series_reviews: PK (series, user) = o recenzie per om pe serie; nota
--   ramane in series_ratings (sursa unica de adevar pentru medie).
-- =====================================================================

CREATE TABLE IF NOT EXISTS comment_votes (
  user_id    INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES episode_comments(id) ON DELETE CASCADE,
  vote       INTEGER NOT NULL CHECK (vote IN (1, -1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_cv_comment ON comment_votes (comment_id);

ALTER TABLE episode_comments ADD COLUMN parent_id INTEGER REFERENCES episode_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON episode_comments (parent_id);

CREATE TABLE IF NOT EXISTS series_reviews (
  series_id  INTEGER NOT NULL REFERENCES anime_series(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  body       TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (series_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_series ON series_reviews (series_id, updated_at DESC);
