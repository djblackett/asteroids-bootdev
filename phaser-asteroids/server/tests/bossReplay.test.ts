import { describe, expect, it } from 'vitest';
import { verifyReplay } from '../../src/replay';
import { botRun, makeHarness, REFERENCE_SEED } from './harness';

describe('authoritative mothership replay', () => {
  it.each([0, 35])('reproduces natural boss combat, damage, scoring and termination (attack delay %ss)', async bossDelay => {
    const bot = botRun(REFERENCE_SEED, { bossFight: true, bossDelay });
    expect(bot.gameOver).toBe(true);
    expect(bot.encounter.startTick).toBe(3600);
    expect(bot.encounter.combatTick).toBe(4260);
    expect(bot.encounter.hits).toBeGreaterThan(0);
    expect(bot.encounter.fires).toContain('single');
    if (bossDelay === 0) {
      expect(bot.encounter.fires).toContain('pulse');
      expect(bot.encounter.bonuses).toBe(1);
      expect(bot.encounter.victoryTick).toBe(6326);
      expect(bot.score).toBe(13064);
    } else {
      expect(bot.encounter.bossHits).toBeGreaterThan(0);
      expect(bot.encounter.fires).toContain('spread');
      expect(bot.encounter.beam).toBe(true);
      expect(bot.encounter.bonuses).toBe(0);
    }
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

  it('ends a ranked run at its issued limit even during the noninteractive entrance', async () => {
    const limit = 3900; // 60s of ordinary play and only 5s of the 11s introduction.
    const bot = botRun(REFERENCE_SEED, { maxTicks: limit });
    expect(bot.gameOver).toBe(false);
    expect(bot.encounter.startTick).toBe(3600);
    expect(bot.encounter.combatTick).toBeNull();
    const h = makeHarness({ settings: { maxTicks: limit } });
    const issued = await h.start({ seed: REFERENCE_SEED });
    const result = await h.playAndSubmit(issued, bot.replay);
    expect(result.status).toBe(200);
    expect(result.body.score).toMatchObject({ score: bot.score, endReason: 'time_limit', durationSeconds: 65 });
    const overrun = botRun(REFERENCE_SEED, { maxTicks: limit + 1 });
    const next = await h.start({ seed: REFERENCE_SEED });
    expect((await h.playAndSubmit(next, overrun.replay)).body.error.reason).toBe('too_long');
  });

  it('rejects old V3 recordings, a second bonus claim, and extra ticks after a fixed ranked limit', async () => {
    const h = makeHarness();
    const bot = botRun(REFERENCE_SEED, { bossFight: true });
    let issued = await h.start({ seed: REFERENCE_SEED });
    const old = structuredClone(bot.replay);
    old.header.rulesVersion = '1.2.0';
    expect((await h.playAndSubmit(issued, old)).body.error.reason).toBe('rules_mismatch');
    issued = await h.start({ seed: REFERENCE_SEED });
    const inflated = structuredClone(bot.replay);
    inflated.claimedResult!.score += 2000;
    expect((await h.playAndSubmit(issued, inflated)).body.error.reason).toBe('score_mismatch');
    expect(verifyReplay(bot.replay, { timeLimitTicks: 4260, maxTicks: 4260 }).valid).toBe(false);
  });
});
