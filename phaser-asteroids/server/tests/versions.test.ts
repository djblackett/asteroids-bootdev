import { describe, expect, it, vi } from 'vitest';
import type { VerificationResult } from '../../src/replay/types';
import { ENGINES, engineFor, issueEngine, registry, type RulesEngine } from '../src/engines';
import { botRun, count, makeHarness, REFERENCE_SEED } from './harness';

// Several rules versions served side by side: how a challenge's version is chosen, and that the version recorded at issue (never the
// submission) selects the frozen verifier. Real games, verified by the real frozen 1.2.0 engine; "1.3.0" is a stand-in for a future
// version, so its verifier is a spy.
vi.setConfig({ testTimeout: 60_000 });

const V12 = ENGINES['1.2.0']!;

function futureEngine(): RulesEngine & { calls: number } {
  const engine = {
    rulesVersion: '1.3.0',
    schemaVersion: 1,
    tickRate: 60,
    calls: 0,
    verifyReplay(): VerificationResult {
      engine.calls++;
      return { valid: false, calculatedScore: 0, totalTicks: 0, simulatedDuration: 0, phase: 'playing', gameOverReason: null, stats: {} as VerificationResult['stats'], error: 'stand-in engine' };
    },
  };
  return engine;
}

/** A server that has been upgraded: it issues 1.3.0 by default and still verifies 1.2.0. */
function upgraded() {
  const h = makeHarness({ settings: { rulesVersion: '1.3.0' } });
  const future = futureEngine();
  h.deps.engines = registry([V12, future]);
  return { h, future };
}

const startWith = (h: ReturnType<typeof makeHarness>, query: string, ip = '203.0.113.9') => h.call('POST', `/api/v1/runs${query}`, { ip });

describe('choosing the rules a challenge is issued under', () => {
  it('a client naming a supported version gets exactly that version and its schema', async () => {
    const { h } = upgraded();
    const res = await startWith(h, '?rules=1.2.0&schema=1');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rulesVersion: '1.2.0', schemaVersion: 1, tickRate: 60 });
    expect((await h.db.first<{ rules_version: string }>('SELECT rules_version FROM runs'))!.rules_version).toBe('1.2.0');
  });

  it('a client that names nothing (web pages from before this) gets the current version, as before', async () => {
    const { h } = upgraded();
    expect((await startWith(h, '')).body.rulesVersion).toBe('1.3.0');
  });

  it('an unsupported, malformed or hostile version falls back to the current one, which the client then refuses ("update")', async () => {
    const { h } = upgraded();
    const asked = ['?rules=1.1.0&schema=1', '?rules=9.9.9', '?rules=1.2.0&schema=2', '?rules=1.2.0&schema=', '?rules=__proto__', '?rules=constructor', '?rules=toString', '?rules=hasOwnProperty', `?rules=${'9'.repeat(5000)}`, '?rules=1.2.0%00'];
    const issued = [];
    for (const [i, q] of asked.entries()) issued.push((await startWith(h, q, `198.51.100.${i}`)).body.rulesVersion);
    expect(issued).toEqual(asked.map(() => '1.3.0'));
  });

  it('only the query string counts: a body cannot choose the version (or anything else)', async () => {
    const { h } = upgraded();
    const res = await h.call('POST', '/api/v1/runs', { json: { rules: '1.2.0', rulesVersion: '1.2.0', schema: 1 }, ip: '198.51.100.40' });
    expect(res.body.rulesVersion).toBe('1.3.0');
  });

  it('engineFor and issueEngine only ever match registered keys', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'valueOf', '', null, undefined, 1.2, {}]) expect(engineFor(ENGINES, k)).toBeNull();
    expect(engineFor(ENGINES, '1.2.0')).toBe(V12);
    expect(issueEngine(ENGINES, '1.2.0', 'nope', null)).toBe(V12);
    expect(issueEngine(ENGINES, 'missing', null, null)).toBeNull();
  });

  it('a server whose current version is not registered refuses to issue rather than issuing something unverifiable', async () => {
    const h = makeHarness({ settings: { rulesVersion: '7.0.0' } });
    const res = await startWith(h, '');
    expect(res.status).toBe(503);
    expect(await count(h.db, 'runs')).toBe(0);
  });

  it('health lists every supported version and keeps the fields existing readers use', async () => {
    const { h } = upgraded();
    const res = await h.call('GET', '/api/v1/health');
    expect(res.body).toMatchObject({ ok: true, rulesVersion: '1.3.0', schemaVersion: 1, supportedRules: ['1.2.0', '1.3.0'] });
  });
});

describe('verifying with the version recorded at issue', () => {
  it('a 1.2.0 run from an installed app is verified by the frozen 1.2.0 engine on a server whose current version is newer', async () => {
    const { h, future } = upgraded();
    const run = (await startWith(h, '?rules=1.2.0&schema=1')).body;
    await h.db.run('UPDATE runs SET seed = ? WHERE id = ?', [REFERENCE_SEED, run.runId]);
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect(res.status).toBe(200);
    expect(res.body.score).toMatchObject({ score: 34735, rulesVersion: '1.2.0' });
    expect(future.calls).toBe(0);
  });

  it('a rules update deployed while a run is in progress does not invalidate it', async () => {
    const h = makeHarness(); // today's server: 1.2.0 only
    const run = await h.start({ seed: REFERENCE_SEED });
    expect(run.rulesVersion).toBe('1.2.0');
    // ...the player is mid-game when the new version deploys:
    h.settings.rulesVersion = '1.3.0';
    h.deps.engines = registry([V12, futureEngine()]);
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect(res.status).toBe(200);
    expect(res.body.score.score).toBe(34735);
  });

  it('a submission cannot pick its verifier: a 1.3.0 run with a replay that claims 1.2.0 is rejected without running 1.2.0', async () => {
    const { h, future } = upgraded();
    const run = (await startWith(h, '')).body;
    expect(run.rulesVersion).toBe('1.3.0');
    await h.db.run('UPDATE runs SET seed = ? WHERE id = ?', [REFERENCE_SEED, run.runId]);
    const spy = vi.fn(V12.verifyReplay);
    h.deps.engines = registry([{ ...V12, verifyReplay: spy }, future]);
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay); // a genuine 1.2.0 recording
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('rules_mismatch');
    expect(spy).not.toHaveBeenCalled();
    expect(future.calls).toBe(0);
  });

  it('a 1.2.0 run whose recording is altered is still rejected by the frozen engine (re-simulation, not trust)', async () => {
    const { h } = upgraded();
    const run = (await startWith(h, '?rules=1.2.0&schema=1')).body;
    await h.db.run('UPDATE runs SET seed = ? WHERE id = ?', [REFERENCE_SEED, run.runId]);
    const forged = botRun(REFERENCE_SEED).replay;
    forged.claimedResult!.score += 5000;
    const res = await h.playAndSubmit(run, forged);
    expect(res.body.error.reason).toBe('score_mismatch');
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('once a version is retired, its remaining runs are refused as rules_mismatch (final), and nothing is scored', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    h.settings.rulesVersion = '1.3.0';
    h.deps.engines = registry([futureEngine()]);
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ reason: 'rules_mismatch' });
    expect(await count(h.db, 'scores')).toBe(0);
  });
});
