-- One row per UTC day on which a moderation digest was due. It makes the daily email idempotent across cron retries and
-- duplicate invocations, and keeps the exact text so a retry resends the identical payload under the same provider
-- idempotency key. Contents are aggregate counts and the console URL only: no names, score IDs, reporter or IP hashes.
-- Additive: no existing table changes. Rows older than 30 days are removed by the digest itself.
CREATE TABLE moderation_digests (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  provider_id TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
