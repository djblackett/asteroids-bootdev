-- Time-limited ranked runs: reaching the run's tick limit while still alive is a valid, server-verified way for a ranked run to end.
--
--   runs.time_limit_ticks   the limit the server ISSUED with this challenge. The replay is verified against this value, not against
--                           whatever the configuration says at submission time, so changing the limit in a deployment never
--                           invalidates a run that is already in flight. NULL on rows issued before this migration: those use the
--                           fixed ranked resource ceiling and can only end in game over.
--   scores.end_reason       'game_over' (ran out of lives) or 'time_limit' (alive at the limit). Verified, never client-reported.

ALTER TABLE runs ADD COLUMN time_limit_ticks INTEGER CHECK (time_limit_ticks IS NULL OR time_limit_ticks > 0);

ALTER TABLE scores ADD COLUMN end_reason TEXT NOT NULL DEFAULT 'game_over' CHECK (end_reason IN ('game_over', 'time_limit'));
