import { GameSim, type SimEvent } from '../core/game';
import { resolveGameConfig } from '../core/gameConfig';
import { NO_INPUT, type PlayerInput } from '../core/player';
import { seededRng } from '../core/rng';
import {
  FIXED_DT,
  FIXED_TICK_RATE,
  GAMEPLAY_RULES_VERSION,
  MAX_REPLAY_INPUT_CHANGES,
  MAX_REPLAY_TICKS,
  REPLAY_SCHEMA_VERSION,
} from './constants';
import {
  toPlayerInput,
  type ReplayRecord,
  type VerificationResult,
  type VerificationStats,
} from './types';

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Validates untrusted replay data structure and constraints at runtime.
 */
export function validateReplayStructure(raw: unknown): { ok: true; record: ReplayRecord } | { ok: false; error: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Replay must be a JSON object', issues: [{ field: 'root', message: 'Not an object' }] };
  }

  const r = raw as Record<string, unknown>;

  // Validate header
  if (!r.header || typeof r.header !== 'object' || Array.isArray(r.header)) {
    issues.push({ field: 'header', message: 'Missing or invalid header' });
  } else {
    const h = r.header as Record<string, unknown>;
    if (h.schemaVersion !== REPLAY_SCHEMA_VERSION) {
      issues.push({ field: 'header.schemaVersion', message: `Unsupported schema version: ${h.schemaVersion}; expected ${REPLAY_SCHEMA_VERSION}` });
    }
    if (h.rulesVersion !== GAMEPLAY_RULES_VERSION) {
      issues.push({ field: 'header.rulesVersion', message: `Unsupported rules version: ${h.rulesVersion}; expected ${GAMEPLAY_RULES_VERSION}` });
    }
    if (typeof h.seed !== 'number' || !Number.isInteger(h.seed) || h.seed < 0 || h.seed > 0xffffffff) {
      issues.push({ field: 'header.seed', message: `Seed must be a 32-bit unsigned integer; got ${h.seed}` });
    }
    if (h.tickRate !== FIXED_TICK_RATE) {
      issues.push({ field: 'header.tickRate', message: `Unsupported tick rate: ${h.tickRate}; expected ${FIXED_TICK_RATE}` });
    }
    if (h.playerCount !== 1) {
      issues.push({ field: 'header.playerCount', message: `Phase 1 only supports single-player replays; got ${h.playerCount}` });
    }
    if (!h.config || typeof h.config !== 'object') {
      issues.push({ field: 'header.config', message: 'Missing or invalid game config' });
    } else {
      const cfg = h.config as Record<string, unknown>;
      if (cfg.playerCount !== 1) {
        issues.push({ field: 'header.config.playerCount', message: 'Config playerCount must be 1' });
      }
      if (cfg.livesMode !== 'independent' && cfg.livesMode !== 'shared') {
        issues.push({ field: 'header.config.livesMode', message: `Invalid livesMode: ${cfg.livesMode}` });
      }
    }
  }

  // Validate totalTicks
  if (typeof r.totalTicks !== 'number' || !Number.isInteger(r.totalTicks) || r.totalTicks <= 0) {
    issues.push({ field: 'totalTicks', message: 'totalTicks must be a positive integer' });
  } else if (r.totalTicks > MAX_REPLAY_TICKS) {
    issues.push({ field: 'totalTicks', message: `totalTicks exceeds limit of ${MAX_REPLAY_TICKS}` });
  }

  // Validate inputs
  if (!Array.isArray(r.inputs)) {
    issues.push({ field: 'inputs', message: 'inputs must be an array' });
  } else {
    if (r.inputs.length === 0) {
      issues.push({ field: 'inputs', message: 'inputs array cannot be empty' });
    }
    if (r.inputs.length > MAX_REPLAY_INPUT_CHANGES) {
      issues.push({ field: 'inputs', message: `inputs change count exceeds limit of ${MAX_REPLAY_INPUT_CHANGES}` });
    }

    let prevTick = -1;
    for (let i = 0; i < r.inputs.length; i++) {
      const change = r.inputs[i];
      if (!change || typeof change !== 'object') {
        issues.push({ field: `inputs[${i}]`, message: 'Input entry must be an object' });
        break;
      }
      const tick = (change as { tick: unknown }).tick;
      if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
        issues.push({ field: `inputs[${i}].tick`, message: `Invalid tick index: ${tick}` });
        break;
      }
      if (i === 0 && tick !== 0) {
        issues.push({ field: 'inputs[0].tick', message: `First input change must start at tick 0; got ${tick}` });
      }
      if (tick <= prevTick) {
        issues.push({ field: `inputs[${i}].tick`, message: `Ticks must be strictly increasing: tick ${tick} <= prev ${prevTick}` });
        break;
      }
      if (typeof r.totalTicks === 'number' && tick >= r.totalTicks) {
        issues.push({ field: `inputs[${i}].tick`, message: `Input tick ${tick} cannot be >= totalTicks ${r.totalTicks}` });
        break;
      }
      prevTick = tick;

      const inp = (change as { input: unknown }).input;
      if (!inp || typeof inp !== 'object') {
        issues.push({ field: `inputs[${i}].input`, message: 'Input object missing' });
        break;
      }
      const inpObj = inp as Record<string, unknown>;
      if (typeof inpObj.rotate !== 'number' || !Number.isFinite(inpObj.rotate) || inpObj.rotate < -1 || inpObj.rotate > 1) {
        issues.push({ field: `inputs[${i}].input.rotate`, message: `Invalid rotate value: ${inpObj.rotate}` });
        break;
      }
      if (typeof inpObj.move !== 'number' || !Number.isFinite(inpObj.move) || inpObj.move < -1 || inpObj.move > 1) {
        issues.push({ field: `inputs[${i}].input.move`, message: `Invalid move value: ${inpObj.move}` });
        break;
      }
      if (typeof inpObj.shoot !== 'boolean') {
        issues.push({ field: `inputs[${i}].input.shoot`, message: 'shoot must be boolean' });
        break;
      }
      if (inpObj.laser !== undefined && typeof inpObj.laser !== 'boolean') {
        issues.push({ field: `inputs[${i}].input.laser`, message: 'laser must be boolean if present' });
        break;
      }
      if (inpObj.boost !== undefined && typeof inpObj.boost !== 'boolean') {
        issues.push({ field: `inputs[${i}].input.boost`, message: 'boost must be boolean if present' });
        break;
      }
      if (inpObj.steer !== undefined) {
        if (!inpObj.steer || typeof inpObj.steer !== 'object') {
          issues.push({ field: `inputs[${i}].input.steer`, message: 'steer must be an object if present' });
          break;
        }
        const st = inpObj.steer as Record<string, unknown>;
        if (typeof st.heading !== 'number' || !Number.isFinite(st.heading)) {
          issues.push({ field: `inputs[${i}].input.steer.heading`, message: `Invalid steer heading: ${st.heading}` });
          break;
        }
        if (st.mode !== 'point' && st.mode !== 'assist') {
          issues.push({ field: `inputs[${i}].input.steer.mode`, message: `Invalid steer mode: ${st.mode}` });
          break;
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: `Validation failed with ${issues.length} issue(s): ${issues[0]?.message}`,
      issues,
    };
  }

  return { ok: true, record: raw as ReplayRecord };
}

/**
 * Independently executes and verifies a serialized or parsed replay in Node without any browser APIs.
 */
export function verifyReplay(
  replayData: string | unknown,
  options: { maxTicks?: number; requireGameOver?: boolean } = {},
): VerificationResult {
  const requireGameOver = options.requireGameOver ?? true;
  let parsed: unknown;
  if (typeof replayData === 'string') {
    try {
      parsed = JSON.parse(replayData);
    } catch (e) {
      return errorResult(`Malformed JSON: ${(e as Error).message}`);
    }
  } else {
    parsed = replayData;
  }

  const structure = validateReplayStructure(parsed);
  if (!structure.ok) {
    return errorResult(structure.error);
  }

  const record = structure.record;
  const { header, inputs, totalTicks, claimedResult } = record;

  if (options.maxTicks && totalTicks > options.maxTicks) {
    return errorResult(`totalTicks ${totalTicks} exceeds configured maximum ${options.maxTicks}`);
  }

  // Initialize fresh simulation with same seed and config
  const rng = seededRng(header.seed);
  const resolvedConfig = resolveGameConfig(header.config);
  const sim = new GameSim({
    rng,
    config: resolvedConfig,
  });

  const stats: VerificationStats = {
    asteroidsDestroyed: 0,
    ufosDestroyed: 0,
    shotsFired: 0,
    lasersFired: 0,
    boostsUsed: 0,
    powerupsCollected: 0,
    hitsTaken: 0,
    finalLives: sim.player.lives,
  };

  let inputIndex = 0;
  let currentInput: PlayerInput = toPlayerInput(inputs[0]?.input ?? { rotate: 0, move: 0, shoot: false });
  let gameOverTick: number | null = null;

  for (let tick = 0; tick < totalTicks; tick++) {
    // Check if there is an input change at this tick
    while (inputIndex < inputs.length && inputs[inputIndex]!.tick === tick) {
      if (sim.isGameOver && gameOverTick !== null) {
        return errorResult(`Unexpected input change at tick ${tick} after game over occurred at tick ${gameOverTick}`);
      }
      currentInput = toPlayerInput(inputs[inputIndex]!.input);
      inputIndex++;
    }

    const events = sim.step(FIXED_DT, currentInput, NO_INPUT);

    // Track gameplay statistics
    for (const ev of events) {
      trackEvent(ev, stats);
    }

    if (sim.isGameOver && gameOverTick === null) {
      gameOverTick = tick;
    }
  }

  stats.finalLives = sim.player.lives;

  if (requireGameOver && !sim.isGameOver) {
    return {
      valid: false,
      calculatedScore: sim.totalScore,
      totalTicks,
      simulatedDuration: totalTicks * FIXED_DT,
      phase: sim.phase,
      gameOverReason: sim.gameOverReason,
      stats,
      error: 'Replay simulation completed without reaching a legitimate game-over state',
    };
  }

  // Check client claim if provided
  let discrepancy: string | undefined;
  if (claimedResult) {
    if (claimedResult.score !== sim.totalScore) {
      discrepancy = `Score mismatch: claimed ${claimedResult.score} but independently calculated ${sim.totalScore}`;
    } else if (claimedResult.totalTicks !== totalTicks) {
      discrepancy = `Tick mismatch: claimed ${claimedResult.totalTicks} but replay contained ${totalTicks}`;
    } else if (claimedResult.gameOverReason !== sim.gameOverReason) {
      discrepancy = `GameOverReason mismatch: claimed ${claimedResult.gameOverReason} but calculated ${sim.gameOverReason}`;
    }
  }

  return {
    valid: !discrepancy,
    calculatedScore: sim.totalScore,
    totalTicks,
    simulatedDuration: totalTicks * FIXED_DT,
    phase: sim.phase,
    gameOverReason: sim.gameOverReason,
    stats,
    discrepancy,
    error: discrepancy,
  };
}

function trackEvent(event: SimEvent, stats: VerificationStats): void {
  switch (event.type) {
    case 'asteroid_destroyed':
      stats.asteroidsDestroyed++;
      break;
    case 'ufo_destroyed':
      stats.ufosDestroyed++;
      break;
    case 'shot_fired':
      stats.shotsFired++;
      break;
    case 'laser_fired':
      stats.lasersFired++;
      break;
    case 'boost_started':
      stats.boostsUsed++;
      break;
    case 'powerup_collected':
      stats.powerupsCollected++;
      break;
    case 'player_hit':
      stats.hitsTaken++;
      break;
  }
}

function errorResult(message: string): VerificationResult {
  return {
    valid: false,
    calculatedScore: 0,
    totalTicks: 0,
    simulatedDuration: 0,
    phase: 'playing',
    gameOverReason: null,
    stats: {
      asteroidsDestroyed: 0,
      ufosDestroyed: 0,
      shotsFired: 0,
      lasersFired: 0,
      boostsUsed: 0,
      powerupsCollected: 0,
      hitsTaken: 0,
      finalLives: 0,
    },
    error: message,
  };
}
