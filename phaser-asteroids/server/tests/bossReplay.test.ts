import { describe, expect, it } from 'vitest';
import { verifyReplay } from '../../src/replay';
import { botRun, makeHarness, REFERENCE_SEED } from './harness';

describe('Classic ranked excludes Invasion', () => {
  it.each([0, 35])('reproduces Classic survival without a boss (attack delay %ss)', async bossDelay => {
    const bot = botRun(REFERENCE_SEED, { bossFight: true, bossDelay });
    expect(bot.gameOver).toBe(true);
    expect(bot.encounter.startTick).toBeNull();
    expect(bot.encounter.combatTick).toBeNull();
    expect(bot.encounter.bonuses).toBe(0);
    const verified = verifyReplay(bot.replay);
    expect(verified.valid).toBe(true);
    expect(verified.calculatedScore).toBe(bot.score);
    expect(verified.totalTicks).toBe(bot.ticks);
    const h = makeHarness();
    const issued = await h.start({ seed: REFERENCE_SEED });
    const accepted = await h.playAndSubmit(issued, bot.replay);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('accepted');
    expect(accepted.body.score.score).toBe(bot.score);
    expect(accepted.body.score.rulesVersion).toBe('1.3.0');
    const repeated = await h.submit(issued, bot.replay);
    expect(repeated.body.replayed).toBe(true);
    expect(repeated.body.score.score).toBe(bot.score);
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.total).toBe(1);
  });

  it('ends a Classic ranked run at its issued limit', async () => {
    const limit = 7500; // Past the Invasion trigger; Classic continues ordinary play.
    const bot = botRun(REFERENCE_SEED, { maxTicks: limit });
    expect(bot.gameOver).toBe(false);
    expect(bot.encounter.startTick).toBeNull();
    expect(bot.encounter.combatTick).toBeNull();
    const h = makeHarness({ settings: { maxTicks: limit } });
    const issued = await h.start({ seed: REFERENCE_SEED });
    const result = await h.playAndSubmit(issued, bot.replay);
    expect(result.status).toBe(200);
    expect(result.body.score).toMatchObject({ score: bot.score, endReason: 'time_limit', durationSeconds: 125 });
    const overrun = botRun(REFERENCE_SEED, { maxTicks: limit + 1 });
    const next = await h.start({ seed: REFERENCE_SEED });
    expect((await h.playAndSubmit(next, overrun.replay)).body.error.reason).toBe('too_long');
  });

  it('rejects old V3 recordings, an unearned boss bonus claim, and extra ticks after a fixed ranked limit', async () => {
    const h = makeHarness();
    const bot = botRun(REFERENCE_SEED, { bossFight: true });
    let issued = await h.start({ seed: REFERENCE_SEED });
    const old = structuredClone(bot.replay);
    old.header.rulesVersion = '1.2.0';
    expect((await h.playAndSubmit(issued, old)).body.error.reason).toBe('rules_mismatch');
    issued = await h.start({ seed: REFERENCE_SEED });
    const inflated = structuredClone(bot.replay);
    inflated.claimedResult!.score += 20000;
    expect((await h.playAndSubmit(issued, inflated)).body.error.reason).toBe('score_mismatch');
    expect(verifyReplay(bot.replay, { timeLimitTicks: 4260, maxTicks: 4260 }).valid).toBe(false);
  });
});
