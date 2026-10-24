/**
 * Deterministic replay and verification constants.
 */

export const REPLAY_SCHEMA_VERSION = 1;

/** Semantic rules version defining simulation outcomes, including spawn/drop balance. */
export const GAMEPLAY_RULES_VERSION = '1.3.0';

/** Authoritative simulation tick rate in Hz. */
export const FIXED_TICK_RATE = 60;

/** Simulation delta per tick in seconds (1/60 s = 0.016666666666666666 s). */
export const FIXED_DT = 1 / FIXED_TICK_RATE;

/**
 * Maximum accumulated wall-clock delta allowed in a single render frame (seconds).
 * Prevents spiral of death if the browser tab freezes or drops frames.
 * 0.25 s = at most 15 simulation ticks in one render step.
 */
export const MAX_ACCUMULATOR_DT = 0.25;

/** Maximum replay duration supported (30 simulated minutes at 60 Hz). */
export const MAX_REPLAY_TICKS = 30 * 60 * FIXED_TICK_RATE; // 108,000 ticks

/** Maximum number of recorded input change events allowed. */
export const MAX_REPLAY_INPUT_CHANGES = 100_000;
