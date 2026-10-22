import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import { seededRng } from '../src/core/rng';
import { FIXED_DT, ReplayRecorder, verifyReplay, type ReplayRecord } from '../src/replay';
import { generateBotReplay } from '../server/testing/bot.mjs';
import * as engine from '../src/replay';

/** Verifier contract for time-limited ranked runs (the server applies it in server/tests/timelimit.test.ts). */
const CONFIG = { playerCount: 1 as const, livesMode: 'independent' as const, friendlyFire: false, speed: [1, 1] as [number, number] };
const SEED = 54321;

function aliveFor(ticks: number): ReplayRecord {
  const bot = generateBotReplay(engine, { seed: SEED, maxTicks: ticks });
  expect(bot.gameOver).toBe(false);
  return bot.replay;
}

describe('verifyReplay time limit', () => {
  it('without a limit option a run that is merely alive is still rejected (unchanged behaviour)', () => {
    const r = verifyReplay(aliveFor(900));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/game-over/);
  });

  it('with a limit, a run alive at exactly that tick is valid and says why it ended', () => {
    const r = verifyReplay(aliveFor(900), { timeLimitTicks: 900 });
    expect(r.valid).toBe(true);
    expect(r.endReason).toBe('time_limit');
    expect(r.phase).toBe('playing');
    expect(r.gameOverReason).toBeNull();
    expect(r.totalTicks).toBe(900);
    expect(r.calculatedScore).toBeGreaterThan(0);
  });

  it('the score is the simulation score at that tick, not a later one', () => {
    const at600 = verifyReplay(aliveFor(600), { timeLimitTicks: 600 });
    const at900 = verifyReplay(aliveFor(900), { timeLimitTicks: 900 });
    expect(at900.calculatedScore).toBeGreaterThanOrEqual(at600.calculatedScore);
    // Independent check with a bare simulation driven by the same recorded inputs.
    const replay = aliveFor(600);
    const sim = new GameSim({ rng: seededRng(SEED), config: CONFIG });
    let i = 0;
    let input = replay.inputs[0]!.input;
    for (let t = 0; t < 600; t++) {
      while (i < replay.inputs.length && replay.inputs[i]!.tick === t) input = replay.inputs[i++]!.input;
      sim.step(FIXED_DT, { rotate: input.rotate, move: input.move, shoot: input.shoot, laser: !!input.laser, boost: !!input.boost, steer: input.steer });
    }
    expect(at600.calculatedScore).toBe(sim.totalScore);
  });

  it('any other length without a game over is rejected', () => {
    for (const ticks of [899, 901]) {
      const r = verifyReplay(aliveFor(ticks), { timeLimitTicks: 900 });
      expect(r.valid).toBe(false);
    }
  });

  it('a game over always wins, even when it lands exactly on the limit tick', () => {
    const over = generateBotReplay(engine, { seed: SEED });
    expect(over.gameOver).toBe(true);
    const r = verifyReplay(over.replay, { timeLimitTicks: over.replay.totalTicks });
    expect(r.valid).toBe(true);
    expect(r.endReason).toBe('game_over');
    expect(r.phase).toBe('gameOver');
  });

  it('a claim that names the wrong ending is a discrepancy', () => {
    const replay = aliveFor(900);
    const honest = verifyReplay(replay, { timeLimitTicks: 900 });
    replay.claimedResult = { totalTicks: 900, score: honest.calculatedScore, gameOverReason: null, phase: 'playing', endReason: 'game_over' };
    const r = verifyReplay(replay, { timeLimitTicks: 900 });
    expect(r.valid).toBe(false);
    expect(r.discrepancy).toMatch(/End reason mismatch/);
  });

  it('recordings made before endReason existed (no claim field) still verify', () => {
    const over = generateBotReplay(engine, { seed: SEED });
    delete (over.replay.claimedResult as { endReason?: string }).endReason;
    expect(verifyReplay(over.replay).valid).toBe(true);
  });
});

describe('ReplayRecorder.markTimeLimit', () => {
  it('records a claim the verifier agrees with, and stops recording afterwards', () => {
    const sim = new GameSim({ rng: seededRng(SEED), config: CONFIG });
    const recorder = new ReplayRecorder(SEED, CONFIG);
    const input = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };
    for (let t = 0; t < 120; t++) {
      recorder.recordTick(t, input);
      sim.step(FIXED_DT, input);
    }
    expect(sim.isGameOver).toBe(false);
    recorder.markTimeLimit(sim);
    expect(recorder.isFinalized).toBe(true);
    recorder.recordTick(120, { ...input, shoot: true }); // ignored once finalized
    const replay = recorder.exportReplay();
    expect(replay.totalTicks).toBe(120);
    expect(replay.claimedResult).toMatchObject({ totalTicks: 120, gameOverReason: null, phase: 'playing', endReason: 'time_limit' });
    const r = verifyReplay(replay, { timeLimitTicks: 120 });
    expect(r.valid).toBe(true);
    expect(r.endReason).toBe('time_limit');
  });

  it('markGameOver now stamps endReason: game_over', () => {
    const over = generateBotReplay(engine, { seed: SEED });
    expect(over.replay.claimedResult?.endReason).toBe('game_over');
  });
});
