import { describe, expect, it, vi } from 'vitest';
import { verifyReplay, type ReplayRecord } from '../../src/replay';
import { botRun, count, makeHarness, REFERENCE_SEED } from './harness';

vi.setConfig({ testTimeout: 60_000 });

/**
 * A ranked run has a time limit: still alive when it is reached is a legitimate, verified ending (not a failed submission).
 * These tests use a short limit so a real game reaches it; the rules are identical at the production value of 72,000 ticks.
 */
const LIMIT = 1500;
const settings = { maxTicks: LIMIT };

/** The recording an honest client produces when its ship is still alive at the limit: exactly `ticks` ticks, claim attached. */
function aliveAtLimit(seed: number, ticks = LIMIT): { replay: ReplayRecord; score: number } {
  const bot = botRun(seed, { maxTicks: ticks });
  expect(bot.gameOver).toBe(false);
  expect(bot.replay.totalTicks).toBe(ticks);
  const check = verifyReplay(bot.replay, { timeLimitTicks: ticks });
  expect(check.valid).toBe(true);
  bot.replay.claimedResult = { totalTicks: ticks, score: check.calculatedScore, gameOverReason: null, phase: 'playing', endReason: 'time_limit' };
  return { replay: bot.replay, score: check.calculatedScore };
}

describe('the challenge states the limit', () => {
  it('POST /runs returns timeLimitTicks, and it is stored with the run', async () => {
    const h = makeHarness({ settings });
    const run = await h.start();
    expect(run.timeLimitTicks).toBe(LIMIT);
    const row = await h.db.first<{ time_limit_ticks: number }>('SELECT time_limit_ticks FROM runs WHERE id = ?', [run.runId]);
    expect(row!.time_limit_ticks).toBe(LIMIT);
  });

  it('defaults to 20 simulated minutes (72,000 ticks) and /health says so', async () => {
    const h = makeHarness();
    const run = await h.start();
    expect(run.timeLimitTicks).toBe(72_000);
    const health = await h.call('GET', '/api/v1/health');
    expect(health.body.maxTicks).toBe(72_000);
    expect(health.body.timeLimitSeconds).toBe(1200);
  });

  it('the environment can only shorten the limit, never raise it above the budget the server is sized for', async () => {
    const { loadSettings } = await import('../src/config');
    expect(loadSettings({ RANKED_TIME_LIMIT_SECONDS: '30' }).maxTicks).toBe(1800);
    expect(loadSettings({ RANKED_TIME_LIMIT_SECONDS: '9999' }).maxTicks).toBe(72_000);
    expect(loadSettings({ RANKED_TIME_LIMIT_SECONDS: '1' }).maxTicks).toBe(72_000);
    expect(loadSettings({ RANKED_TIME_LIMIT_SECONDS: 'abc' }).maxTicks).toBe(72_000);
  });
});

describe('a run still alive at the limit is accepted', () => {
  it('scores the simulation at exactly that tick and records the ending', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay, score } = aliveAtLimit(REFERENCE_SEED);
    expect(score).toBeGreaterThan(0);

    const res = await h.playAndSubmit(run, replay, { nickname: 'Survivor', controls: { scheme: 'keyboard' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.score.score).toBe(score);
    expect(res.body.score.endReason).toBe('time_limit');
    expect(res.body.score.durationSeconds).toBe(LIMIT / 60);

    const row = await h.db.first<{ end_reason: string; ticks: number; score: number }>('SELECT end_reason, ticks, score FROM scores');
    expect(row).toEqual({ end_reason: 'time_limit', ticks: LIMIT, score });

    const board = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(board.body.entries[0]).toMatchObject({ nickname: 'Survivor', score, endReason: 'time_limit' });
  });

  it('works without any client claim (the claim is only a cross-check)', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    delete replay.claimedResult;
    expect((await h.playAndSubmit(run, replay)).status).toBe(200);
  });

  it('the idempotent retry of a time-limit submission returns the same score', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    const first = await h.playAndSubmit(run, replay, { nickname: 'Retry Me' });
    const again = await h.submit(run, replay, { nickname: 'Retry Me' });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.score.id).toBe(first.body.score.id);
    expect(await count(h.db, 'scores')).toBe(1);
  });

  it('a natural game over before the limit is handled exactly as before', async () => {
    const h = makeHarness({ settings: { maxTicks: 72_000 } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect(res.status).toBe(200);
    expect(res.body.score.endReason).toBe('game_over');
  });

  it('a game over on the very last tick of the limit is a game over, not a time-limit ending', async () => {
    // Find the tick of a natural game over, then make that tick the limit.
    const bot = botRun(REFERENCE_SEED);
    const h = makeHarness({ settings: { maxTicks: bot.replay.totalTicks } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(200);
    expect(res.body.score.endReason).toBe('game_over');
  });
});

describe('the client cannot choose when the run ends', () => {
  it('stopping before the limit without a game over is rejected', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const early = aliveAtLimit(REFERENCE_SEED, LIMIT - 300).replay; // a perfectly alive run that simply stops early
    const res = await h.playAndSubmit(run, early);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('not_game_over');
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('running past the limit is rejected', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const long = botRun(REFERENCE_SEED, { maxTicks: LIMIT + 1 }).replay;
    const res = await h.playAndSubmit(run, long);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('too_long');
  });

  it('padding a finished game with extra ticks to reach the limit is rejected', async () => {
    const bot = botRun(REFERENCE_SEED);
    const limit = bot.replay.totalTicks + 300;
    const h = makeHarness({ settings: { maxTicks: limit } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const padded = structuredClone(bot.replay);
    padded.totalTicks = limit;
    if (padded.claimedResult) padded.claimedResult.totalTicks = limit;
    const res = await h.playAndSubmit(run, padded);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('invalid_replay');
  });

  it('claiming a time-limit ending for a run that actually ended in game over is a mismatch', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = botRun(REFERENCE_SEED);
    bot.replay.claimedResult!.endReason = 'time_limit';
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('score_mismatch');
  });

  it('a claim of a higher score than the simulation reached at the limit is rejected', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay, score } = aliveAtLimit(REFERENCE_SEED);
    replay.claimedResult!.score = score + 500;
    const res = await h.playAndSubmit(run, replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('score_mismatch');
  });

  it('the limit is not a client field: nothing in the body can move it', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay } = aliveAtLimit(REFERENCE_SEED, LIMIT - 300);
    const sneaky = { ...replay, timeLimitTicks: LIMIT - 300, header: { ...replay.header, timeLimitTicks: LIMIT - 300 } };
    const res = await h.playAndSubmit(run, sneaky);
    expect(res.status).toBe(422);
  });

  it('a limit-length replay still cannot arrive faster than real time', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    h.clock.advance(3000);
    const res = await h.submit(run, replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('too_fast');
  });
});

describe('limits are fixed when a run is issued', () => {
  it('lowering configuration preserves the old run and issues the lowered limit to new runs', async () => {
    const h = makeHarness({ settings });
    const old = await h.start({ seed: REFERENCE_SEED });
    h.settings.maxTicks = LIMIT - 300;
    const fresh = await h.start({ seed: REFERENCE_SEED });
    expect(fresh.timeLimitTicks).toBe(LIMIT - 300);
    const row = await h.db.first<{ time_limit_ticks: number }>('SELECT time_limit_ticks FROM runs WHERE id = ?', [fresh.runId]);
    expect(row!.time_limit_ticks).toBe(LIMIT - 300);
    const accepted = await h.playAndSubmit(old, aliveAtLimit(REFERENCE_SEED).replay);
    expect(accepted.status).toBe(200);
    expect(accepted.body.score.endReason).toBe('time_limit');
    expect(accepted.body.score.durationSeconds).toBe(LIMIT / 60);
    expect((await h.playAndSubmit(fresh, aliveAtLimit(REFERENCE_SEED, LIMIT - 300).replay)).status).toBe(200);
  });

  it('lowering configuration cannot turn an old run ending early into a valid time-limit ending', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    h.settings.maxTicks = LIMIT - 300;
    const res = await h.playAndSubmit(run, aliveAtLimit(REFERENCE_SEED, LIMIT - 300).replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('not_game_over');
  });

  it('raising configuration cannot let a replay exceed its issued limit, even with client limits', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    h.settings.maxTicks = LIMIT * 4;
    const replay = aliveAtLimit(REFERENCE_SEED, LIMIT + 1).replay;
    Object.assign(replay, { timeLimitTicks: LIMIT * 4 });
    Object.assign(replay.header, { timeLimitTicks: LIMIT * 4 });
    const res = await h.playAndSubmit(run, replay, { rawBody: JSON.stringify({ replay, timeLimitTicks: LIMIT * 4 }) });
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('too_long');
  });

  it('client limits in the body, replay and header cannot shorten the persisted limit', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    h.settings.maxTicks = LIMIT - 300;
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    Object.assign(replay, { timeLimitTicks: 1 });
    Object.assign(replay.header, { timeLimitTicks: 1 });
    const res = await h.playAndSubmit(run, replay, { rawBody: JSON.stringify({ replay, timeLimitTicks: 1 }) });
    expect(res.status).toBe(200);
    expect(res.body.score.durationSeconds).toBe(LIMIT / 60);
  });

  it('an invalid persisted limit cannot raise the absolute ranked resource ceiling', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.db.run('UPDATE runs SET time_limit_ticks = 72001 WHERE id = ?', [run.runId]);
    const res = await h.playAndSubmit(run, aliveAtLimit(REFERENCE_SEED).replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('invalid_replay');
  });

  it('raising the configured limit does not strand a run issued under the old one', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    h.settings.maxTicks = LIMIT * 4;
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    expect((await h.playAndSubmit(run, replay)).status).toBe(200);
  });

  it('a run issued before limits were recorded can only end in game over', async () => {
    const h = makeHarness({ settings });
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.db.run('UPDATE runs SET time_limit_ticks = NULL WHERE id = ?', [run.runId]);
    const { replay } = aliveAtLimit(REFERENCE_SEED);
    const res = await h.playAndSubmit(run, replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('not_game_over');
    // ...while a genuine game over for the same legacy row is accepted.
    const run2 = await h.start({ seed: REFERENCE_SEED });
    await h.db.run('UPDATE runs SET time_limit_ticks = NULL WHERE id = ?', [run2.runId]);
    expect((await h.playAndSubmit(run2, botRun(REFERENCE_SEED).replay)).status).toBe(200);
  });
});
