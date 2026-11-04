-- Additive score changes: original nicknames and all verified scoring fields stay intact.
ALTER TABLE scores ADD COLUMN display_name TEXT;
ALTER TABLE scores ADD COLUMN moderation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN suspicion_reviewed INTEGER NOT NULL DEFAULT 0;

-- Extend the fixed reason vocabulary without losing existing reports.
CREATE TABLE score_reports_next (
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('offensive', 'personal_info', 'other', 'suspicious_score')),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  PRIMARY KEY (score_id, reporter_hash)
) WITHOUT ROWID;
INSERT INTO score_reports_next (score_id, reporter_hash, reason, created_at)
  SELECT score_id, reporter_hash, reason, created_at FROM score_reports;
DROP TABLE score_reports;
ALTER TABLE score_reports_next RENAME TO score_reports;
CREATE INDEX idx_score_reports_created ON score_reports(created_at);
CREATE INDEX idx_score_reports_queue ON score_reports(status, score_id);

-- No token, IP, reporter identifier or name copied into the audit log.
-- An erasure leaves only anonymous decision metadata (the FK is cleared).
CREATE TABLE moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  score_id TEXT REFERENCES scores(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  was_visible INTEGER NOT NULL,
  had_display_name INTEGER NOT NULL,
  open_reports INTEGER NOT NULL
);
CREATE INDEX idx_moderation_audit_score ON moderation_audit(score_id, id);
