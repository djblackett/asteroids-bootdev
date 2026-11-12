-- One row per UTC day on which a moderation digest was due. It makes the daily email idempotent across cron retries and
-- duplicate invocations, and keeps the exact text so a retry resends the identical payload under the same provider
-- idempotency key. Contents are aggregate counts and the console URL only: no names, score IDs, reporter or IP hashes.
-- `expired` is the number of open reports deleted unreviewed at the retention limit that this row's text announces; a row
-- that was never confirmed delivered hands that count on to the next day's digest and becomes 'superseded'.
-- Additive: no existing table changes. Rows older than 30 days are removed by the digest itself.
CREATE TABLE moderation_digests (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'superseded')),
  attempts INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  expired INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
