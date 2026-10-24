import { describe, expect, it } from 'vitest';
import { MothershipGameSim as GameSim } from '../src/boss/bossSim';
import { DEFAULT_GAME_CONFIG } from '../src/core/gameConfig';
import type { PlayerInput } from '../src/core/player';
import { seededRng } from '../src/core/rng';
import {
  FIXED_DT,
  MAX_REPLAY_INPUT_CHANGES,
  MAX_REPLAY_TICKS,
  ReplayRecorder,
  validateReplayStructure,
  verifyReplay,
  type ReplayRecord,
} from '../src/replay';

function createValidReplay(seed = 12345): ReplayRecord {
  const config = JSON.parse(JSON.stringify(DEFAULT_GAME_CONFIG));
  const recorder = new ReplayRecorder(seed, config);
  const sim = new GameSim({ rng: seededRng(seed), config, startCooldown: 0 });

  let tick = 0;
  while (!sim.isGameOver && tick < 10000) {
    const input: PlayerInput = {
      rotate: tick < 60 ? 0.5 : 0,
      move: tick < 60 ? 1 : 0,
      shoot: tick < 60,
    };
    recorder.recordTick(tick, input);
    sim.step(FIXED_DT, input);
    if (sim.isGameOver) {
      recorder.markGameOver(sim);
      break;
    }
    tick++;
  }

  return JSON.parse(JSON.stringify(recorder.exportReplay()));
}

describe('Replay Validation & Adversarial Tampering', () => {
  it('validates a legitimate completed replay', () => {
    const replay = createValidReplay();
    const result = verifyReplay(replay);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.phase).toBe('gameOver');
    expect(result.calculatedScore).toBe(replay.claimedResult?.score);
  });

  it('detects score tampering: client inflates claimed score', () => {
    const replay = createValidReplay();
    expect(replay.claimedResult).toBeDefined();

    // Attacker claims 999,999 points
    const tampered: ReplayRecord = {
      ...replay,
      claimedResult: {
        ...replay.claimedResult!,
        score: 999_999,
      },
    };

    const result = verifyReplay(tampered);
    expect(result.valid).toBe(false);
    expect(result.discrepancy).toContain('Score mismatch');
    expect(result.calculatedScore).not.toBe(999_999);
    expect(result.calculatedScore).toBe(replay.claimedResult!.score);
  });

  it('rejects truncated replay: cut off before reaching game over', () => {
    const replay = createValidReplay();
    const halfTicks = Math.floor(replay.totalTicks / 2);

    const truncated: ReplayRecord = {
      ...replay,
      totalTicks: halfTicks,
      inputs: replay.inputs.filter((i) => i.tick < halfTicks),
      claimedResult: undefined,
    };

    const result = verifyReplay(truncated);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('without reaching a legitimate game-over state');
  });

  it('rejects malformed JSON', () => {
    const result = verifyReplay('{"header": broken json');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Malformed JSON');
  });

  it('rejects non-object replay root', () => {
    const result = verifyReplay('null');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Replay must be a JSON object');
  });

  it('rejects unsupported schema version', () => {
    const replay = createValidReplay();
    (replay.header as unknown as Record<string, unknown>).schemaVersion = 999;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported schema version');
  });

  it('rejects unsupported rules version', () => {
    const replay = createValidReplay();
    (replay.header as unknown as Record<string, unknown>).rulesVersion = '99.0.0';
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported rules version');
  });

  it('rejects invalid seed (negative, float, string)', () => {
    const replay1 = createValidReplay();
    (replay1.header as unknown as Record<string, unknown>).seed = -5;
    expect(verifyReplay(replay1).valid).toBe(false);

    const replay2 = createValidReplay();
    (replay2.header as unknown as Record<string, unknown>).seed = 3.14159;
    expect(verifyReplay(replay2).valid).toBe(false);

    const replay3 = createValidReplay();
    (replay3.header as unknown as Record<string, unknown>).seed = '12345';
    expect(verifyReplay(replay3).valid).toBe(false);
  });

  it('rejects invalid tick rate', () => {
    const replay = createValidReplay();
    (replay.header as unknown as Record<string, unknown>).tickRate = 120;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported tick rate');
  });

  it('rejects unsupported multi-player replays in phase 1', () => {
    const replay = createValidReplay();
    (replay.header as unknown as Record<string, unknown>).playerCount = 2;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Phase 1 only supports single-player');
  });

  it('rejects invalid config values', () => {
    const replay = createValidReplay();
    (replay.header.config as unknown as Record<string, unknown>).livesMode = 'infinite';
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid livesMode');
  });

  it('rejects empty inputs array', () => {
    const replay = createValidReplay();
    replay.inputs = [];
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('inputs array cannot be empty');
  });

  it('rejects first input not starting at tick 0', () => {
    const replay = createValidReplay();
    replay.inputs[0]!.tick = 10;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('First input change must start at tick 0');
  });

  it('rejects out of order ticks', () => {
    const replay = createValidReplay();
    if (replay.inputs.length >= 2) {
      replay.inputs[1]!.tick = replay.inputs[0]!.tick; // duplicate tick
      const result = verifyReplay(replay);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Ticks must be strictly increasing');
    }
  });

  it('rejects input tick >= totalTicks', () => {
    const replay = createValidReplay();
    replay.inputs.push({
      tick: replay.totalTicks,
      input: { rotate: 0, move: 0, shoot: false },
    });
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Input tick');
  });

  it('rejects out of range rotate input (> 1 or < -1)', () => {
    const replay = createValidReplay();
    replay.inputs[0]!.input.rotate = 2.5;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid rotate value');
  });

  it('rejects NaN or Infinity input values', () => {
    const replay = createValidReplay();
    replay.inputs[0]!.input.move = NaN;
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid move value');
  });

  it('rejects invalid steer mode', () => {
    const replay = createValidReplay();
    replay.inputs[0]!.input.steer = {
      heading: 45,
      mode: 'teleport' as unknown as 'point',
    };
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid steer mode');
  });

  it('rejects nonfinite steer heading', () => {
    const replay = createValidReplay();
    replay.inputs[0]!.input.steer = {
      heading: Infinity,
      mode: 'point',
    };
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid steer heading');
  });

  it('rejects unexpected extra inputs after game over has occurred', () => {
    const replay = createValidReplay();
    // Append an input change after game over
    replay.totalTicks += 50;
    replay.inputs.push({
      tick: replay.totalTicks - 10,
      input: { rotate: 1, move: 1, shoot: true },
    });
    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unexpected input change');
    expect(result.error).toContain('after game over occurred');
  });

  it('rejects extra simulation ticks after game over even with NO additional input changes', () => {
    const replay = createValidReplay();
    const originalTicks = replay.totalTicks;
    // Artificially pad totalTicks without adding any new input changes
    replay.totalTicks += 100;
    if (replay.claimedResult) {
      replay.claimedResult.totalTicks = replay.totalTicks;
    }

    const result = verifyReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unexpected simulation tick');
    expect(result.error).toContain(`after game over occurred at tick ${originalTicks - 1}`);
  });

  it('rejects excessive tick count', () => {
    const replay = createValidReplay();
    replay.totalTicks = MAX_REPLAY_TICKS + 1;
    const check = validateReplayStructure(replay);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain('totalTicks exceeds limit');
    }
  });

  it('rejects excessive input change count', () => {
    const replay = createValidReplay();
    // Simulate oversized input changes array
    const fakeInputs = new Array(MAX_REPLAY_INPUT_CHANGES + 1).fill(null).map((_, i) => ({
      tick: i,
      input: { rotate: 0, move: 0, shoot: false },
    }));
    replay.inputs = fakeInputs;
    const check = validateReplayStructure(replay);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain('inputs change count exceeds limit');
    }
  });
});
