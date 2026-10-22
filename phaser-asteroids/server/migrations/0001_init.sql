-- Phaser Asteroids leaderboard: initial schema (SQLite dialect, applied by Cloudflare D1 migrations).
--
-- Two principal tables:
--   runs    one row per server-issued ranked challenge. Its `status` is a one-way state machine:
--             issued -> verifying -> accepted | rejected      (verifying -> issued only when a claimant fails internally)
--           accepted and rejected are terminal. Every transition is a conditional UPDATE, so the database, not process memory,
--           decides who wins a race.
--   scores  one row per *accepted* run, holding the score the SERVER computed by replaying the run. UNIQUE(run_id) is the final
--           backstop: even a bug in the state machine cannot give one run two leaderboard entries.
-- Plus a small fixed-window counter table for rate limiting. Replays themselves are never stored (only a hash, see runs.replay_hash).
-- All timestamps are integer milliseconds since the Unix epoch, taken from the server clock.

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,                       -- random UUID, public (it appears in URLs)
  token_hash      TEXT NOT NULL,                          -- SHA-256 hex of the secret run token; the token itself is never stored
  seed            INTEGER NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  rules_version   TEXT NOT NULL,                          -- GAMEPLAY_RULES_VERSION the run must be replayed under
  config_json     TEXT NOT NULL,                          -- the approved GameConfig, as issued
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'verifying', 'accepted', 'rejected')),
  claim_token     TEXT,                                   -- random nonce held by the request currently verifying this run
  claimed_at      INTEGER,                                -- when that claim began (a stale claim can be taken over, see claimLeaseMs)
  replay_hash     TEXT,                                   -- SHA-256 hex of the submitted body: makes a retry idempotent. NOT proof of authenticity.
  finished_at     INTEGER,                                -- when the run reached a terminal state
  score_id        TEXT,                                   -- set exactly when status = 'accepted'
  reject_reason   TEXT,                                   -- short machine code, set exactly when status = 'rejected'
  reject_detail   TEXT,                                   -- truncated human-readable detail for diagnostics
  issuer_hash     TEXT,                                   -- salted hash of the requester's IP (never the IP itself), for abuse triage only
  CHECK ((status = 'accepted') = (score_id IS NOT NULL)),
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL))
);

CREATE INDEX idx_runs_expires ON runs (expires_at);
CREATE INDEX idx_runs_finished ON runs (finished_at);

CREATE TABLE scores (
  id                    TEXT PRIMARY KEY,                 -- random UUID, the public identifier of a leaderboard entry
  run_id                TEXT NOT NULL UNIQUE REFERENCES runs (id),
  score                 INTEGER NOT NULL CHECK (score >= 0),
  nickname              TEXT NOT NULL,                    -- sanitised (see src/nickname.ts)
  completed_at          INTEGER NOT NULL,                 -- server time at which verification finished: drives the weekly window
  rules_version         TEXT NOT NULL,                    -- boards never mix rules versions
  ticks                 INTEGER NOT NULL,
  duration_ms           INTEGER NOT NULL,                 -- simulated duration (ticks / 60 Hz), verified
  asteroids_destroyed   INTEGER NOT NULL DEFAULT 0,
  ufos_destroyed        INTEGER NOT NULL DEFAULT 0,
  reported_controls     TEXT NOT NULL DEFAULT 'unknown',  -- UNTRUSTED client-reported control scheme; analysis only, never used for ranking
  visibility            TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
  hidden_reason         TEXT,
  hidden_at             INTEGER
);

-- Serves every leaderboard read: filter on rules version, order by (score DESC, completed_at ASC, id ASC).
-- Partial: hidden and zero-score entries never appear on a board, so they cost the index nothing.
CREATE INDEX idx_scores_board ON scores (rules_version, score DESC, completed_at ASC, id ASC)
  WHERE visibility = 'visible' AND score > 0;

-- Serves weekly reads and ranks (range scan on completed_at within a rules version).
CREATE INDEX idx_scores_week ON scores (rules_version, completed_at)
  WHERE visibility = 'visible' AND score > 0;

-- Fixed-window request counters. One row per (bucket key, window start); pruned by the scheduled cleanup.
CREATE TABLE rate_limits (
  bucket        TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
) WITHOUT ROWID;
