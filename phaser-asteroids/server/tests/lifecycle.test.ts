import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { ReplayRecord } from '../../src/replay';
import { faultyDb, openSqliteDb } from '../testing/sqliteDb';
import { botRun, count, makeClock, makeHarness, REFERENCE_SEED, T0 } from './harness';

// Replaying real games is CPU-heavy; do not let a busy machine turn that into a spurious timeout.
vi.setConfig({ testTimeout: 60_000 });

const reference = () => botRun(REFERENCE_SEED);

describe('starting a ranked run', () => {
  it('issues a server-chosen seed, rules version, approved config and expiry', async () => {
    const h = makeHarness();
    const run = await h.start();
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.token.length).toBeGreaterThanOrEqual(40);
    expect(Number.isInteger(run.seed) && run.seed >= 0 && run.seed <= 0xffffffff).toBe(true);
    expect(run.rulesVersion).toBe('1.0.0');
    expect(run.tickRate).toBe(60);
    expect(run.config).toEqual({ playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] });
    expect(Date.parse(run.expiresAt) - Date.parse(run.issuedAt)).toBe(h.settings.runTtlMs);
    expect(Date.parse(run.issuedAt)).toBe(T0);
  });

  it('stores only a hash of the token', async () => {
    const h = makeHarness();
    const run = await h.start();
    const row = await h.db.first<{ token_hash: string }>('SELECT token_hash FROM runs WHERE id = ?', [run.runId]);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(run.token);
  });

  it('ignores anything the client tries to choose (seed, config, rules) in the request', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/api/v1/runs', {
      json: { seed: 1, config: { playerCount: 2 }, rulesVersion: '0.0.1' },
      ip: '198.51.100.1',
    });
    expect(res.status).toBe(201);
    expect(res.body.seed).not.toBe(1);
    expect(res.body.config.playerCount).toBe(1);
    expect(res.body.rulesVersion).toBe('1.0.0');
  });

  it('issues unique ids, tokens and (practically) unique seeds', async () => {
    const h = makeHarness({ settings: { rate: { ...makeHarness().settings.rate, startPerIp: 1000, startGlobal: 1000 } } });
    const runs = await Promise.all(Array.from({ length: 60 }, () => h.start()));
    expect(new Set(runs.map((r) => r.runId)).size).toBe(60);
    expect(new Set(runs.map((r) => r.token)).size).toBe(60);
    expect(new Set(runs.map((r) => r.seed)).size).toBeGreaterThan(55);
  });
});

describe('submitting a legitimate run', () => {
  it('accepts it and stores the score the SERVER computed', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    const res = await h.playAndSubmit(run, bot.replay, { nickname: 'Dave J', controls: { scheme: 'keyboard' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.replayed).toBe(false);
    expect(res.body.score.score).toBe(9114);
    expect(res.body.score.nickname).toBe('Dave J');
    expect(res.body.ranks).toEqual({ allTime: 1, weekly: 1 });

    const row = await h.db.first<Record<string, unknown>>('SELECT * FROM scores');
    expect(row).toMatchObject({ score: 9114, ticks: bot.ticks, reported_controls: 'keyboard', visibility: 'visible', rules_version: '1.0.0' });
    expect(await count(h.db, 'runs', "status = 'accepted'")).toBe(1);
    expect(await count(h.db, 'scores')).toBe(1);

    const board = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(board.body.entries.map((e: { score: number }) => e.score)).toEqual([9114]);
  });

  it('ignores the score the client claims when it is not consistent, and never takes it as the score', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    // Strip the claim: the server still computes (and stores) its own number, not any number the client could have supplied.
    delete (bot.replay as { claimedResult?: unknown }).claimedResult;
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(200);
    expect(res.body.score.score).toBe(9114);
  });
});

describe('forged and invalid recordings are rejected', () => {
  async function rejectedWith(mutate: (r: ReplayRecord) => void, reason: string, seed = REFERENCE_SEED) {
    const h = makeHarness();
    const run = await h.start({ seed });
    const bot = botRun(seed);
    mutate(bot.replay);
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('replay_rejected');
    expect(res.body.error.reason).toBe(reason);
    expect(await count(h.db, 'scores')).toBe(0);
    const row = await h.db.first<{ status: string; reject_reason: string }>('SELECT status, reject_reason FROM runs');
    expect(row).toEqual({ status: 'rejected', reject_reason: reason });
    return h;
  }

  it('inflated client score claim', () => rejectedWith((r) => void (r.claimedResult!.score += 100000), 'score_mismatch'));
  it('seed that is not the issued seed', () => rejectedWith((r) => void (r.header.seed = 7), 'seed_mismatch'));
  it('seed chosen by the client at the issuing stage is useless: replay of another seed fails', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: 999 });
    const res = await h.playAndSubmit(run, reference().replay); // replay was recorded for 54321
    expect(res.body.error.reason).toBe('seed_mismatch');
  });
  it('co-op config', () => rejectedWith((r) => void (r.header.config = { ...r.header.config, playerCount: 2 }), 'config_mismatch'));
  it('shared-lives config', () => rejectedWith((r) => void (r.header.config = { ...r.header.config, livesMode: 'shared' }), 'config_mismatch'));
  it('extra config keys', () => rejectedWith((r) => void ((r.header.config as unknown as Record<string, unknown>).godMode = true), 'config_mismatch'));
  it('speed handicap config', () => rejectedWith((r) => void (r.header.config = { ...r.header.config, speed: [2, 1] }), 'config_mismatch'));
  it('unsupported rules version', () => rejectedWith((r) => void (r.header.rulesVersion = '0.9.0'), 'rules_mismatch'));
  it('a run issued under older rules, after the server moved on, is rejected with a clear reason', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.db.run("UPDATE runs SET rules_version = '0.9.0' WHERE id = ?", [run.runId]);
    const bot = botRun(REFERENCE_SEED);
    bot.replay.header.rulesVersion = '0.9.0';
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('rules_mismatch');
    expect(await count(h.db, 'scores')).toBe(0);
  });
  it('unsupported schema version', () => rejectedWith((r) => void (r.header.schemaVersion = 99), 'invalid_replay'));
  it('wrong tick rate', () => rejectedWith((r) => void (r.header.tickRate = 120), 'invalid_replay'));
  it('modified input timing (the altered run no longer matches the recording)', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = botRun(REFERENCE_SEED);
    (() => {
      const r = bot.replay;
      const mid = Math.floor(r.inputs.length / 2);
      r.inputs[mid]!.tick += 1;
      if (r.inputs[mid + 1] && r.inputs[mid]!.tick >= r.inputs[mid + 1]!.tick) r.inputs[mid]!.tick -= 1;
      r.inputs[mid]!.input.move = r.inputs[mid]!.input.move > 0 ? -1 : 1;
    })();
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(['score_mismatch', 'invalid_replay', 'not_game_over']).toContain(res.body.error.reason);
    expect(await count(h.db, 'scores')).toBe(0);
  });
  it('reordered ticks', () => rejectedWith((r) => void r.inputs.reverse(), 'invalid_replay'));
  it('extra ticks padded after game over', () => rejectedWith((r) => void (r.totalTicks += 10), 'invalid_replay'));
  it('input appended after game over', () =>
    rejectedWith((r) => {
      r.totalTicks += 5;
      r.inputs.push({ tick: r.totalTicks - 1, input: { rotate: 0, move: 1, shoot: true } });
    }, 'invalid_replay'));
  it('abandoned run that never reached game over', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = botRun(REFERENCE_SEED, { maxTicks: 1200 });
    expect(bot.gameOver).toBe(false);
    delete (bot.replay as { claimedResult?: unknown }).claimedResult;
    const res = await h.playAndSubmit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('not_game_over');
    expect(await count(h.db, 'scores')).toBe(0);
  });
  it('over-long replay', async () => {
    const h = makeHarness({ settings: { maxTicks: 1000 } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, reference().replay);
    expect(res.body.error.reason).toBe('too_long');
  });
  it('NaN / out-of-range input values', () => rejectedWith((r) => void (r.inputs[1]!.input.rotate = 50), 'invalid_replay'));

  it('a ten-minute replay cannot arrive seconds after the challenge was issued', async () => {
    const h = makeHarness();
    const seed = 4018; // 36,554 ticks = 10.2 minutes
    const run = await h.start({ seed });
    const bot = botRun(seed);
    h.clock.advance(5000);
    const res = await h.submit(run, bot.replay);
    expect(res.status).toBe(422);
    expect(res.body.error.reason).toBe('too_fast');
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('the same ten-minute replay is accepted once the full time has really elapsed', async () => {
    const h = makeHarness();
    const seed = 4018;
    const run = await h.start({ seed });
    const bot = botRun(seed);
    h.clock.advance((bot.replay.totalTicks / 60) * 1000 + 1000);
    expect((await h.submit(run, bot.replay)).status).toBe(200);
  });

  it('a long pause (wall time >> simulated time) is fine within the expiry window', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    h.clock.advance(40 * 60_000); // 40 min of pauses / tab suspension
    expect((await h.submit(run, reference().replay)).status).toBe(200);
  });
});

describe('credentials, ownership and expiry', () => {
  it('unknown and malformed run ids -> 404', async () => {
    const h = makeHarness();
    const bot = reference();
    for (const id of [crypto.randomUUID(), 'not-a-uuid', '../../etc/passwd']) {
      const res = await h.call('POST', `/api/v1/runs/${encodeURIComponent(id)}/submit`, { json: { replay: bot.replay }, token: 'x' });
      expect(res.status).toBe(404);
    }
  });

  it('missing, wrong and truncated tokens -> 401 and the run stays open', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    for (const token of [null, 'wrong', run.token.slice(0, -1), run.token + 'x', '']) {
      const res = await h.playAndSubmit(run, bot.replay, { token });
      expect(res.status).toBe(401);
    }
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
    expect((await h.submit(run, bot.replay)).status).toBe(200);
  });

  it("another player's run cannot be submitted with your token (or theirs, without it)", async () => {
    const h = makeHarness();
    const mine = await h.start({ seed: REFERENCE_SEED });
    const theirs = await h.start({ seed: REFERENCE_SEED, ip: '198.51.100.9' });
    const bot = reference();
    h.clock.advance(200_000);
    expect((await h.submit(theirs, bot.replay, { token: mine.token })).status).toBe(401);
    expect((await h.submit(theirs, bot.replay, { token: null })).status).toBe(401);
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('an expired challenge is refused (410) and never creates a score', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    h.clock.advance(h.settings.runTtlMs + 1);
    const res = await h.submit(run, reference().replay);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('run_expired');
    expect(await count(h.db, 'scores')).toBe(0);
  });
});

describe('one-use runs', () => {
  it('re-sending the identical body after success is idempotent: same score, no second row', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    const first = await h.playAndSubmit(run, bot.replay, { nickname: 'Dave J' });
    const again = await h.submit(run, bot.replay, { nickname: 'Dave J' });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.score.id).toBe(first.body.score.id);
    expect(await count(h.db, 'scores')).toBe(1);
  });

  it('a different body for an accepted run is refused (409) and cannot change the stored score', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    await h.playAndSubmit(run, bot.replay, { nickname: 'Dave J' });
    const other = await h.submit(run, bot.replay, { nickname: 'Someone Else' });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('run_already_submitted');
    expect((await h.db.first<{ nickname: string }>('SELECT nickname FROM scores'))!.nickname).toBe('Dave J');
  });

  it('a rejected run is terminal: a corrected replay cannot be tried again', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bad = reference();
    bad.replay.claimedResult!.score += 1;
    expect((await h.playAndSubmit(run, bad.replay)).status).toBe(422);
    const retry = await h.submit(run, reference().replay);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('run_rejected');
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('simultaneous identical submissions create exactly one score', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    h.clock.advance(200_000);
    const results = await Promise.all(Array.from({ length: 12 }, () => h.submit(run, bot.replay, { nickname: 'Racer' })));
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.score.id)).size).toBe(1);
    for (const r of results.filter((r) => r.status !== 200)) expect([409]).toContain(r.status);
    expect(await count(h.db, 'scores')).toBe(1);
    expect(await count(h.db, 'runs', "status = 'accepted'")).toBe(1);
  });

  it('simultaneous DIFFERENT submissions (different nicknames) for one run: exactly one wins', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    h.clock.advance(200_000);
    const results = await Promise.all(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((n) => h.submit(run, bot.replay, { nickname: n })));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(await count(h.db, 'scores')).toBe(1);
  });

  it('holds across separate database connections (several Worker instances sharing one database)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'lb-'));
    const file = join(dir, 'shared.sqlite');
    const clock = makeClock();
    const instances = Array.from({ length: 4 }, () => makeHarness({ db: openSqliteDb(file), clock }));
    try {
      const run = await instances[0]!.start({ seed: REFERENCE_SEED });
      const bot = reference();
      clock.advance(200_000);
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, i) => instances[i % 4]!.submit(run, bot.replay, { nickname: `Inst${i % 4}` })),
      );
      expect(results.filter((r) => r.status === 200 && !r.body.replayed).length).toBe(1);
      expect(await count(instances[0]!.db, 'scores')).toBe(1);
      expect(await count(instances[3]!.db, 'runs', "status = 'accepted'")).toBe(1);
    } finally {
      for (const i of instances) i.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the scores table itself refuses a second score for one run', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.playAndSubmit(run, reference().replay);
    await expect(
      h.db.run(`INSERT INTO scores (id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms) VALUES ('dup', ?, 1, 'Dup Dup', 1, '1.0.0', 1, 1)`, [run.runId]),
    ).rejects.toThrow();
  });
});

describe('request size and encoding limits', () => {
  it('rejects an oversized body (413) without consuming the run', async () => {
    const h = makeHarness({ settings: { maxBodyBytes: 4096 } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.submit(run, reference().replay);
    expect(res.status).toBe(413);
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
  });

  it('refuses a declared Content-Length over the limit before reading', async () => {
    const h = makeHarness({ settings: { maxBodyBytes: 1000 } });
    const run = await h.start();
    const res = await h.call('POST', `/api/v1/runs/${run.runId}/submit`, { token: run.token, headers: { 'content-length': '999999' }, body: '{}' });
    expect(res.status).toBe(413);
  });

  it('a gzip bomb stops at the decoded limit', async () => {
    const h = makeHarness({ settings: { maxBodyBytes: 1024 * 1024 } });
    const run = await h.start();
    const bomb = gzipSync(Buffer.alloc(32 * 1024 * 1024, 0x20)); // 32 MiB of spaces (32x the limit), ~32 KB compressed
    expect(bomb.length).toBeLessThan(h.settings.maxCompressedBytes);
    const res = await h.call('POST', `/api/v1/runs/${run.runId}/submit`, { token: run.token, headers: { 'content-encoding': 'gzip' }, body: bomb as unknown as BodyInit });
    expect(res.status).toBe(413);
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
  });

  it('rejects an over-limit compressed body', async () => {
    const h = makeHarness({ settings: { maxCompressedBytes: 100 } });
    const run = await h.start();
    const res = await h.call('POST', `/api/v1/runs/${run.runId}/submit`, {
      token: run.token,
      headers: { 'content-encoding': 'gzip' },
      body: gzipSync(Buffer.from(crypto.getRandomValues(new Uint8Array(2000)))) as unknown as BodyInit, // incompressible
    });
    expect(res.status).toBe(413);
  });

  it('accepts a legitimate gzip upload', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, reference().replay, { gzip: true });
    expect(res.status).toBe(200);
    expect(res.body.score.score).toBe(9114);
  });

  it('truncated gzip and corrupt gzip -> 400, run not consumed', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const full = gzipSync(Buffer.from(JSON.stringify({ replay: reference().replay })));
    for (const body of [full.subarray(0, Math.floor(full.length / 2)), Buffer.from('definitely not gzip')]) {
      const res = await h.call('POST', `/api/v1/runs/${run.runId}/submit`, { token: run.token, headers: { 'content-encoding': 'gzip' }, body: body as unknown as BodyInit });
      expect(res.status).toBe(400);
    }
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
  });

  it('unsupported content-encodings -> 415', async () => {
    const h = makeHarness();
    const run = await h.start();
    const res = await h.call('POST', `/api/v1/runs/${run.runId}/submit`, { token: run.token, headers: { 'content-encoding': 'br' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('truncated JSON, non-JSON and wrong shapes -> 400 without consuming the run, and a correct retry succeeds', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    const json = JSON.stringify({ replay: bot.replay });
    h.clock.advance(200_000);
    for (const rawBody of [json.slice(0, json.length - 40), 'not json', '[]', '{}', '{"replay": 5}', '{"replay": []}', '']) {
      const res = await h.submit(run, null, { rawBody });
      expect([400]).toContain(res.status);
    }
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
    expect((await h.submit(run, bot.replay)).status).toBe(200);
  });
});

describe('nicknames', () => {
  it('invalid nicknames are refused before the run is consumed', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    h.clock.advance(200_000);
    for (const nickname of ['ab', 'x'.repeat(17), '<script>alert(1)</script>', 'a&b c', 'bad"quote', 123, {}, '   ']) {
      const res = await h.submit(run, bot.replay, { nickname });
      // Whitespace-only collapses to the default name, everything else is refused.
      expect(res.status === 400 || (nickname === '   ' && res.status === 200)).toBe(true);
      if (res.status === 200) return;
    }
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
  });

  it('normalises whitespace and keeps unicode letters', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, reference().replay, { nickname: '  Élodie   B_2  ' });
    expect(res.body.score.nickname).toBe('Élodie B_2');
  });

  it('defaults to Anonymous', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    expect((await h.playAndSubmit(run, reference().replay)).body.score.nickname).toBe('Anonymous');
  });

  it('untrusted control metadata is whitelisted, never trusted', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.playAndSubmit(run, reference().replay, { controls: { scheme: "'; DROP TABLE scores;--" } });
    expect((await h.db.first<{ reported_controls: string }>('SELECT reported_controls FROM scores'))!.reported_controls).toBe('unknown');
  });
});

describe('failure handling', () => {
  it('a database failure while recording the score returns 503, leaves no score, and the player can retry', async () => {
    let fail = true;
    const h = makeHarness({ dbWrap: (db) => faultyDb(db, (sql) => fail && /INSERT INTO scores/.test(sql)) });
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    const first = await h.playAndSubmit(run, bot.replay);
    expect(first.status).toBe(503);
    expect(await count(h.db, 'scores')).toBe(0);
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('issued');
    fail = false;
    const retry = await h.submit(run, bot.replay);
    expect(retry.status).toBe(200);
    expect(await count(h.db, 'scores')).toBe(1);
  });

  it('if even releasing the claim fails, the claim lease lets a later request take over', async () => {
    let failScores = true;
    const h = makeHarness({ dbWrap: (db) => faultyDb(db, (sql) => (failScores && /INSERT INTO scores/.test(sql)) || (failScores && /SET status = 'issued'/.test(sql))) });
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    expect((await h.playAndSubmit(run, bot.replay)).status).toBe(503);
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('verifying');
    failScores = false;
    const early = await h.submit(run, bot.replay);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('run_in_progress');
    h.clock.advance(h.settings.claimLeaseMs + 1);
    expect((await h.submit(run, bot.replay)).status).toBe(200);
    expect(await count(h.db, 'scores')).toBe(1);
  });

  it('a database outage when starting a run is reported, not hidden', async () => {
    const h = makeHarness({ dbWrap: (db) => faultyDb(db, () => true) });
    const res = await h.call('POST', '/api/v1/runs');
    expect(res.status).toBe(500);
  });

  it('a verifier crash is a rejection, not a retry loop', async () => {
    const h = makeHarness();
    h.deps.verify = () => {
      throw new Error('boom');
    };
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, reference().replay);
    expect(res.status).toBe(422);
    expect((await h.db.first<{ status: string }>('SELECT status FROM runs'))!.status).toBe('rejected');
  });
});

describe('rate limits', () => {
  it('limits run starts per client and reports Retry-After', async () => {
    const h = makeHarness({ settings: { rate: { ...makeHarness().settings.rate, startPerIp: 3 } } });
    for (let i = 0; i < 3; i++) expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.1' })).status).toBe(201);
    const blocked = await h.call('POST', '/api/v1/runs', { ip: '192.0.2.1' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.2' })).status).toBe(201); // a different client is unaffected
    h.clock.advance(3_600_000);
    expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.1' })).status).toBe(201); // the window rolled over
  });

  it('a global ceiling bounds total starts regardless of client', async () => {
    const h = makeHarness({ settings: { rate: { ...makeHarness().settings.rate, startGlobal: 2 } } });
    expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.1' })).status).toBe(201);
    expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.2' })).status).toBe(201);
    expect((await h.call('POST', '/api/v1/runs', { ip: '192.0.2.3' })).status).toBe(429);
  });

  it('limits submissions before any verification work happens', async () => {
    const h = makeHarness({ settings: { rate: { ...makeHarness().settings.rate, submitPerIp: 2 } } });
    const run = await h.start({ seed: REFERENCE_SEED });
    const bot = reference();
    h.clock.advance(200_000);
    await h.submit(run, bot.replay, { token: 'bad' });
    await h.submit(run, bot.replay, { token: 'bad' });
    const res = await h.submit(run, bot.replay);
    expect(res.status).toBe(429);
    expect(await count(h.db, 'scores')).toBe(0);
  });

  it('refuses browser origins that are not allow-listed, but serves origin-less callers', async () => {
    const h = makeHarness({ settings: { allowedOrigins: ['https://game.example'] } });
    expect((await h.call('POST', '/api/v1/runs', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const ok = await h.call('POST', '/api/v1/runs', { headers: { origin: 'https://game.example' } });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://game.example');
    expect((await h.call('POST', '/api/v1/runs', { ip: '1.1.1.1' })).status).toBe(201);
    const pre = await h.call('OPTIONS', '/api/v1/runs', { headers: { origin: 'https://evil.example' } });
    expect(pre.status).toBe(403);
  });
});
