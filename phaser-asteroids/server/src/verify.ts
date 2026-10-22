import type { GameConfig } from '../../src/core/gameConfig';
import { FIXED_TICK_RATE } from '../../src/replay/constants';
import { verifyReplay } from '../../src/replay/verifier';
import type { VerificationResult } from '../../src/replay/types';
import type { ServerSettings } from './config';

/** What the server issued for this run; the replay must agree with every field. */
export interface IssuedRunFacts {
  seed: number;
  rulesVersion: string;
  config: GameConfig;
  createdAt: number;
}

export type RejectCode =
  | 'invalid_replay'
  | 'seed_mismatch'
  | 'rules_mismatch'
  | 'config_mismatch'
  | 'too_long'
  | 'too_fast'
  | 'not_game_over'
  | 'score_mismatch';

export type RankedVerdict =
  | { ok: true; result: VerificationResult }
  | { ok: false; code: RejectCode; detail: string };

const reject = (code: RejectCode, detail: string): RankedVerdict => ({ ok: false, code, detail });

/** Exactly the approved fields, with exactly the approved values (extra keys are a mismatch too). */
function configMatches(actual: unknown, expected: GameConfig): boolean {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const a = actual as Record<string, unknown>;
  const keys = Object.keys(a).sort();
  if (keys.join(',') !== Object.keys(expected).sort().join(',')) return false;
  return (
    a.playerCount === expected.playerCount &&
    a.livesMode === expected.livesMode &&
    a.friendlyFire === expected.friendlyFire &&
    Array.isArray(a.speed) &&
    a.speed.length === expected.speed.length &&
    expected.speed.every((s, i) => (a.speed as unknown[])[i] === s)
  );
}

/**
 * Decides whether `replay` is a legitimate recording of the run the server issued, and if so returns the score the server itself
 * calculated by simulating it. The cheap checks come first so that obviously unacceptable submissions never reach the
 * simulation. `now` is the server clock when the submission was claimed.
 *
 * Whatever the replay says about its own score (`claimedResult`) is never used as the score; verifyReplay only cross-checks it,
 * and a disagreement is a rejection.
 */
export function verifyRankedReplay(replay: unknown, run: IssuedRunFacts, now: number, settings: ServerSettings): RankedVerdict {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay)) return reject('invalid_replay', 'replay must be an object');
  const r = replay as { header?: Record<string, unknown>; totalTicks?: unknown };
  const header = r.header;
  if (!header || typeof header !== 'object' || Array.isArray(header)) return reject('invalid_replay', 'replay header is missing');

  // The verifier in this deployment only knows one rules version. A run issued before an upgrade can no longer be reproduced.
  if (run.rulesVersion !== settings.rulesVersion) {
    return reject('rules_mismatch', `this run was issued under rules ${run.rulesVersion}; the server now verifies ${settings.rulesVersion}`);
  }
  if (header.seed !== run.seed) return reject('seed_mismatch', 'replay seed is not the seed issued for this run');
  if (header.rulesVersion !== run.rulesVersion) {
    return reject('rules_mismatch', `replay rules version ${String(header.rulesVersion)} is not the issued ${run.rulesVersion}`);
  }
  if (!configMatches(header.config, run.config)) return reject('config_mismatch', 'replay config is not the approved ranked configuration');

  const totalTicks = r.totalTicks;
  if (typeof totalTicks !== 'number' || !Number.isInteger(totalTicks) || totalTicks <= 0) {
    return reject('invalid_replay', 'totalTicks must be a positive integer');
  }
  if (totalTicks > settings.maxTicks) return reject('too_long', `replay exceeds the ranked limit of ${settings.maxTicks} ticks`);

  // The game clock cannot run faster than the wall clock: ticks advance at most once per 1/60 s of real time, and the client
  // could not begin playing before the challenge existed. This rejects "ten minutes of play submitted five seconds later".
  // It cannot prove a human played; a bot may simply wait.
  const simulatedMs = (totalTicks * 1000) / FIXED_TICK_RATE;
  const elapsedMs = now - run.createdAt;
  if (simulatedMs > elapsedMs + settings.elapsedSlackMs) {
    return reject('too_fast', `replay covers ${Math.round(simulatedMs)} ms of play but only ${Math.max(0, Math.round(elapsedMs))} ms have passed since the challenge was issued`);
  }

  const result = verifyReplay(replay, { maxTicks: settings.maxTicks, requireGameOver: true });
  if (result.valid) return { ok: true, result };

  if (result.discrepancy) return reject('score_mismatch', result.discrepancy);
  // verifyReplay reports a recording that simply stops before the ship is destroyed with a real tick count but phase !== 'gameOver';
  // structural failures return zeroed results.
  if (result.totalTicks > 0 && result.phase !== 'gameOver') return reject('not_game_over', result.error ?? 'run did not end in game over');
  return reject('invalid_replay', result.error ?? 'replay failed verification');
}
