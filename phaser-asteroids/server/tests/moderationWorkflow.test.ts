import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sanitizeNickname } from '../src/nickname';
import { botRun, count, insertScore, makeHarness, REFERENCE_SEED, type Harness } from './harness';

describe('moderation security and workflow', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());
  const score = () => insertScore(h.db, { score: 100, nickname: 'Pilot', completedAt: h.clock.now() });
  const admin = (method: string, path: string, json?: unknown) => h.call(method, '/api/v1/admin/' + path, { token: h.settings.adminToken!, json });
  const decide = (id: string, action: string, revision: number, extra = {}) => admin('POST', `scores/${id}/moderate`, { action, revision, category: 'offensive', ...extra });
  const report = (id: string, ip = '203.0.113.20') => h.call('POST', `/api/v1/scores/${id}/report`, { ip, json: { reason: 'suspicious_score' } });

  it('guards every administrative read/write and unknown route, without CORS or cache exposure', async () => {
    const id = await score();
    const routes = [['GET','audit'], ['GET','scores'], ['GET',`scores/${id}/history`], ['POST',`scores/${id}/moderate`], ['POST',`scores/${id}/visibility`], ['POST',`scores/${id}/delete`], ['GET','unknown']];
    for (const [method, path] of routes) {
      const res = await h.call(method!, '/api/v1/admin/' + path);
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect((await h.call(method!, '/api/v1/admin/' + path, { token: h.settings.adminToken!, headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    }
    expect((await h.call('OPTIONS', '/api/v1/admin/scores', { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    h.settings.adminToken = null;
    for (const [method, path] of routes) expect((await h.call(method!, '/api/v1/admin/' + path)).status).toBe(404);
    expect((await h.call('GET', '/admin')).status).toBe(404);
  });

  it('throttles failed auth without locking out a valid administrator', async () => {
    for (let i = 0; i < 10; i++) expect((await h.call('GET', '/api/v1/admin/scores', { token: 'incorrect' })).status).toBe(401);
    expect((await h.call('GET', '/api/v1/admin/scores', { token: 'incorrect' })).status).toBe(429);
    expect((await admin('GET', 'scores')).status).toBe(200);
  });

  it('replaces/restores public names on both boards, detail and token-authenticated retry; preserves score and original', async () => {
    const run = await h.start({ seed: REFERENCE_SEED });
    const replay = botRun(REFERENCE_SEED).replay;
    const accepted = await h.playAndSubmit(run, replay, { nickname: 'Pilot' });
    const id = accepted.body.score.id;
    expect((await decide(id, 'rename', 0, { name: 'Anonymous' })).status).toBe(200);
    for (const url of ['/api/v1/leaderboard/all-time', '/api/v1/leaderboard/weekly', `/api/v1/scores/${id}`]) {
      const res = await h.call('GET', url);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain('Pilot');
      expect(JSON.stringify(res.body)).toContain('Anonymous');
    }
    const retry = await h.submit(run, replay, { nickname: 'Pilot' });
    expect(retry.body.score.nickname).toBe('Anonymous');
    expect(retry.body.score.score).toBe(accepted.body.score.score);
    expect((await decide(id, 'restore_name', 1, { category: 'appeal' })).status).toBe(200);
    expect((await h.call('GET', `/api/v1/scores/${id}`)).body.score.nickname).toBe('Pilot');
    expect((await decide(id, 'hide', 2)).status).toBe(200);
    for (const scope of ['all-time','weekly']) expect((await h.call('GET', `/api/v1/leaderboard/${scope}`)).body.total).toBe(0);
    expect((await h.submit(run, replay, { nickname: 'Pilot' })).body.ranks).toEqual({ allTime: null, weekly: null });
    expect((await decide(id, 'restore', 3)).status).toBe(200);
    expect((await h.call('GET', `/api/v1/scores/${id}`)).body.score.score).toBe(accepted.body.score.score);
    const history = (await admin('GET', `scores/${id}/history`)).body;
    expect(history.audit.map((a: any) => a.action)).toEqual(['restore','hide','restore_name','rename']);
    expect(JSON.stringify(history)).not.toContain('Pilot');
  });

  it('prevents stale decisions, malformed actions and mutation/audit partial commits', async () => {
    const id = await score();
    expect((await decide(id, 'hide', 0)).status).toBe(200);
    expect((await decide(id, 'restore', 0)).status).toBe(409);
    expect((await decide(id, 'rename', 1, { name: '<script>' })).status).toBe(400);
    expect((await decide(id, 'rename', 1, { name: 'fuck' })).status).toBe(400);
    expect((await decide(id, 'bogus', 1)).status).toBe(400);
    expect((await decide(id, 'restore', -1)).status).toBe(400);
    expect((await decide(id, 'restore', 1, { category: 'arbitrary free text' })).status).toBe(400);
    expect(await count(h.db, 'moderation_audit')).toBe(1);
    h.db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON scores BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await decide(id, 'restore', 1)).status).toBe(500);
    expect(await count(h.db, 'moderation_audit')).toBe(1);
    h.db.exec('DROP TRIGGER fail_update');
    h.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await decide(id, 'restore', 1)).status).toBe(500);
    expect((await h.db.first<any>('SELECT visibility FROM scores WHERE id = ?', [id])).visibility).toBe('hidden');
  });

  it('resolves and reopens reports, prevents one reporter reopening a resolved complaint, and accepts new evidence', async () => {
    const id = await score();
    await report(id);
    expect((await decide(id, 'resolve', 1)).status).toBe(200);
    await report(id);
    expect((await admin('GET', 'scores')).body.entries).toHaveLength(0);
    await report(id, '203.0.113.21');
    const queue = (await admin('GET', 'scores')).body.entries;
    expect(queue[0].openReports).toBe(1);
    expect(JSON.stringify(queue)).not.toMatch(/reporter_hash|token_hash|issuer_hash/);
    expect((await decide(id, 'reopen', 3)).status).toBe(200);
    expect((await admin('GET', 'scores')).body.entries[0].openReports).toBe(2);
    expect((await h.call('GET', '/api/v1/leaderboard/all-time')).body.entries[0].id).toBe(id);
  });

  it('allows only one concurrent decision per revision and pages the private audit without gaps', async () => {
    const id = await score();
    const results = await Promise.all([decide(id, 'hide', 0), decide(id, 'rename', 0, { name: 'Anonymous' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await count(h.db, 'moderation_audit')).toBe(1);
    for (let revision = 1; revision <= 101; revision++) expect((await decide(id, 'restore', revision)).status).toBe(200);
    const first = (await admin('GET', 'audit')).body;
    const last = (await admin('GET', 'audit?before=' + first.next)).body;
    expect(first.entries).toHaveLength(100);
    expect(last.entries).toHaveLength(2);
    expect(new Set([...first.entries, ...last.entries].map(a => a.id)).size).toBe(102);
    expect(last.next).toBeNull();
  });

  it('enforces global report limits across IPs and never hides via brigading', async () => {
    const id = await score();
    const window = Math.floor(h.clock.now() / h.settings.rate.windowMs) * h.settings.rate.windowMs;
    await h.db.run('INSERT INTO rate_limits VALUES (?, ?, ?)', ['report:global', window, 999]);
    expect((await report(id)).status).toBe(200);
    const limited = await report(id, '203.0.113.99');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await count(h.db, 'score_reports')).toBe(1);
    expect((await h.call('GET', `/api/v1/scores/${id}`)).status).toBe(200);
  });

  it('does not resolve a newly arrived report from a stale review snapshot', async () => {
    const id = await score();
    await report(id);
    expect((await decide(id, 'resolve', 0)).status).toBe(409);
    await report(id); // identical duplicates do not invalidate the reviewed revision
    expect((await decide(id, 'resolve', 1)).status).toBe(200);
    await report(id, '203.0.113.22');
    expect((await decide(id, 'resolve', 2)).status).toBe(409);
    expect((await admin('GET', 'scores')).body.entries[0].openReports).toBe(1);
  });

  it('uses conservative version-specific scoring bounds and scans old entries without altering them', async () => {
    const id = await score();
    await h.db.run('UPDATE scores SET score = 821, asteroids_destroyed = 1, ufos_destroyed = 1 WHERE id = ?', [id]);
    expect((await admin('GET', 'scores')).body.entries).toHaveLength(0);
    await h.db.run('UPDATE scores SET score = 822 WHERE id = ?', [id]);
    expect((await admin('GET', 'scores')).body.entries[0].suspicious).toBe(1);
    await h.db.run("UPDATE scores SET rules_version = 'future' WHERE id = ?", [id]);
    expect((await admin('GET', 'scores')).body.entries).toHaveLength(0);
    await h.db.run("UPDATE scores SET rules_version = '1.2.0', score = 0, duration_ms = 100 WHERE id = ?", [id]);
    expect((await admin('GET', 'scores')).body.entries[0].suspicious).toBe(1);
    const run = await h.start({ seed: REFERENCE_SEED });
    const accepted = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect((await admin('GET', 'scores?filter=all&id=' + accepted.body.score.id)).body.entries[0].suspicious).toBe(0);
  });

  it('paginates the queue deterministically, supports hidden entries and exact ID lookup', async () => {
    for (let i = 0; i < 52; i++) await score();
    const first = (await admin('GET', 'scores')).body;
    const second = (await admin('GET', 'scores?before=' + first.next)).body;
    expect(first.entries).toHaveLength(50);
    expect(second.entries).toHaveLength(2);
    expect(new Set([...first.entries, ...second.entries].map(s => s.id)).size).toBe(52);
    const id = first.entries[0].id;
    await decide(id, 'hide', 0);
    expect((await admin('GET', 'scores?filter=hidden')).body.entries[0].id).toBe(id);
    expect((await admin('GET', 'scores?filter=all&id=' + id)).body.entries).toHaveLength(1);
    expect((await admin('GET', 'scores?filter=__proto__')).status).toBe(400);
    expect((await admin('GET', 'scores?before=NaN')).status).toBe(400);
  });

  it('erases the actual linked run even with a stale reverse pointer; leaves unrelated data and anonymous audit', async () => {
    const id = await score(), other = await score();
    await report(id);
    await decide(id, 'rename', 1, { name: 'Replacement' });
    const row = await h.db.first<any>('SELECT run_id FROM scores WHERE id = ?', [id]);
    await h.db.run('UPDATE runs SET score_id = ? WHERE id = ?', [other, row.run_id]);
    h.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await admin('POST', `scores/${id}/delete`)).status).toBe(500);
    expect(await count(h.db, 'scores')).toBe(2);
    expect(await count(h.db, 'score_reports')).toBe(1);
    expect(await count(h.db, 'moderation_audit')).toBe(1);
    h.db.exec('DROP TRIGGER fail_delete');
    expect((await admin('POST', `scores/${id}/delete`)).status).toBe(200);
    expect(await count(h.db, 'scores')).toBe(1);
    expect(await count(h.db, 'runs')).toBe(1);
    expect(await count(h.db, 'score_reports')).toBe(0);
    const audit = await h.db.all<any>('SELECT * FROM moderation_audit');
    expect(audit.every(a => a.score_id === null)).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/Pilot|Replacement/);
    expect((await h.call('GET', `/api/v1/scores/${other}`)).status).toBe(200);
  });

  it('serves an inert console shell with CSP, no embedded credentials and no persistence', async () => {
    const res = await h.call('GET', '/admin');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.body).not.toContain(h.settings.adminToken!);
    expect(res.body).not.toMatch(/localStorage|sessionStorage|innerHTML/);
  });

  it('rejects objectionable nicknames before spending the run; old clients can correct and resubmit', async () => {
    const run = await h.start({ seed: REFERENCE_SEED });
    const replay = botRun(REFERENCE_SEED).replay;
    const rejected = await h.playAndSubmit(run, replay, { nickname: 'fuck' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('invalid_nickname');
    expect((await h.db.first<any>('SELECT status FROM runs WHERE id = ?', [run.runId])).status).toBe('issued');
    expect((await h.submit(run, replay, { nickname: 'Fukuda' })).status).toBe(200);
  });
});

describe('nickname false positives and normalization', () => {
  it.each(['Scunthorpe','Dickson','Assassin','Fukuda','José','李小龍','Anonymous','', 'Shitake'])('permits %s', name => expect(sanitizeNickname(name).ok).toBe(true));
  it.each(['fuck', 'FUCK!', 'f.u.c.k', 'f u c k', 'ＦＵＣＫ', 'fück', 'sh1t!', 'sh1t', 'sh!t', 'shit!', 'b1tch', 'faggot'])('blocks %s', name => expect(sanitizeNickname(name).ok).toBe(false));
});

it('migration 0004 preserves existing accepted data, reports and FK integrity', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of ['0001_init.sql','0002_time_limit.sql','0003_reports.sql']) db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    db.exec("INSERT INTO runs (id, token_hash, seed, rules_version, config_json, created_at, expires_at, status, score_id) VALUES ('r','token',1,'1.2.0','{}',0,1,'accepted','s')");
    db.exec("INSERT INTO scores (id,run_id,score,nickname,completed_at,rules_version,ticks,duration_ms) VALUES ('s','r',100,'Pilot',0,'1.2.0',60,1000)");
    db.exec("INSERT INTO score_reports VALUES ('s','hash','offensive',123)");
    db.exec(readFileSync(new URL('../migrations/0004_moderation_workflow.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT nickname, score, display_name FROM scores').get()).toEqual({nickname:'Pilot',score:100,display_name:null});
    expect(db.prepare('SELECT reason, created_at, status FROM score_reports').get()).toEqual({reason:'offensive',created_at:123,status:'open'});
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
