-- Private, bounded moderation queue. No free text, account or raw IP address.
CREATE TABLE score_reports (
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('offensive', 'personal_info', 'other')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (score_id, reporter_hash)
) WITHOUT ROWID;
CREATE INDEX idx_score_reports_created ON score_reports(created_at);
