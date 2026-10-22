import type { GameOverReason, GamePhase } from '../core/game';
import type { GameConfig } from '../core/gameConfig';
import type { PlayerInput, SteerRequest } from '../core/player';
import { FIXED_TICK_RATE, GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from './constants';

/**
 * Normalized player control state captured for simulation replay.
 * Omits undefined/false keys where possible for compact storage.
 */
export interface RecordedInput {
  rotate: number; // in [-1, 1]
  move: number; // in [-1, 1]
  shoot: boolean;
  laser?: boolean;
  boost?: boolean;
  steer?: SteerRequest;
}

/**
 * A change in the player's control state occurring at a specific simulation tick.
 */
export interface ReplayInputChange {
  tick: number;
  input: RecordedInput;
}

/**
 * Metadata header for the replay run.
 */
export interface ReplayHeader {
  schemaVersion: number;
  rulesVersion: string;
  gameVersion: string;
  seed: number;
  tickRate: number;
  config: GameConfig;
  playerCount: 1;
  recordedAt?: string;
}

/**
 * Optional client claim for debugging and verification comparison.
 */
export interface ReplayResultClaim {
  totalTicks: number;
  score: number;
  gameOverReason: GameOverReason | null;
  phase: GamePhase;
}

/**
 * Serialized replay container.
 */
export interface ReplayRecord {
  header: ReplayHeader;
  inputs: ReplayInputChange[];
  totalTicks: number;
  claimedResult?: ReplayResultClaim;
}

/**
 * Gameplay statistics gathered independently by the verifier during replay.
 */
export interface VerificationStats {
  asteroidsDestroyed: number;
  ufosDestroyed: number;
  shotsFired: number;
  lasersFired: number;
  boostsUsed: number;
  powerupsCollected: number;
  hitsTaken: number;
  finalLives: number;
}

/**
 * Result returned by independent server-side / Node replay verification.
 */
export interface VerificationResult {
  valid: boolean;
  calculatedScore: number;
  totalTicks: number;
  simulatedDuration: number;
  phase: GamePhase;
  gameOverReason: GameOverReason | null;
  stats: VerificationStats;
  discrepancy?: string;
  error?: string;
}

/**
 * Normalizes a live `PlayerInput` into a canonical `RecordedInput`.
 */
export function toRecordedInput(input: PlayerInput): RecordedInput {
  const rec: RecordedInput = {
    rotate: Number.isFinite(input.rotate) ? Math.round(input.rotate * 1000) / 1000 : 0,
    move: Number.isFinite(input.move) ? Math.round(input.move * 1000) / 1000 : 0,
    shoot: !!input.shoot,
  };
  if (input.laser) rec.laser = true;
  if (input.boost) rec.boost = true;
  if (input.steer) {
    rec.steer = {
      heading: Math.round(input.steer.heading * 100) / 100,
      mode: input.steer.mode,
    };
  }
  return rec;
}

/**
 * Converts a `RecordedInput` back into a `PlayerInput` suitable for `GameSim.step()`.
 */
export function toPlayerInput(rec: RecordedInput): PlayerInput {
  return {
    rotate: rec.rotate,
    move: rec.move,
    shoot: rec.shoot,
    laser: !!rec.laser,
    boost: !!rec.boost,
    steer: rec.steer ? { heading: rec.steer.heading, mode: rec.steer.mode } : undefined,
  };
}

/**
 * Compares two inputs for equality to avoid emitting redundant records when nothing has changed.
 */
export function areRecordedInputsEqual(a: RecordedInput, b: RecordedInput): boolean {
  if (a.rotate !== b.rotate) return false;
  if (a.move !== b.move) return false;
  if (a.shoot !== b.shoot) return false;
  if (!!a.laser !== !!b.laser) return false;
  if (!!a.boost !== !!b.boost) return false;

  const aSteer = a.steer;
  const bSteer = b.steer;
  if (!aSteer && !bSteer) return true;
  if (!aSteer || !bSteer) return false;
  if (aSteer.mode !== bSteer.mode) return false;
  return Math.abs(aSteer.heading - bSteer.heading) < 0.001;
}

export function createDefaultReplayHeader(seed: number, config: GameConfig, gameVersion = '0.1.0'): ReplayHeader {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    rulesVersion: GAMEPLAY_RULES_VERSION,
    gameVersion,
    seed: seed >>> 0,
    tickRate: FIXED_TICK_RATE,
    config,
    playerCount: 1,
    recordedAt: new Date().toISOString(),
  };
}
