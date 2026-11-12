import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS_PER_DAY, RESEND_API_URL, SEND_LEASE_MS, loadDigestConfig, resendSender,
  type DigestConfig, type SendResult, type Sender,
} from '../src/digest';
import type { Db } from '../src/db';
import { REPORT_RETENTION_MS } from '../src/moderation';
import { runScheduled } from '../src/scheduled';
import { faultyDb } from '../testing/sqliteDb';
import { count, insertScore, makeHarness, type Harness } from './harness';

// Every delivery here goes to an in-memory mock. Addresses use the reserved .test TLD; nothing contacts a real provider.
const DAY = 86_400_000;
const API_KEY = 're_test_DO_NOT_LEAK_0123456789';
const ENV = {
  RESEND_API_KEY: API_KEY,
  MODERATION_DIGEST_FROM: 'Hull & Havoc <moderation@digest.test>',
  MODERATION_DIGEST_TO: 'operator@digest.test',
  MODERATION_DASHBOARD_URL: 'https://worker.test/admin',
  IP_HASH_SALT: 'test-salt',
};

interface Sent { subject: string; text: string; key: string }

function mockSender(script: SendResult[] = []): { sent: Sent[]; send: Sender } {
  const sent: Sent[] = [];
  return {
    sent,
    send: async (message, key) => {
      sent.push({ ...message, key });
      return script.shift() ?? { ok: true, id: `msg-${sent.length}` };
    },
  };
}

describe('daily moderation digest', () => {
  let h: Harness;
  let logs: Array<Record<string, unknown>>;
  beforeEach(() => { h = makeHarness(); logs = []; });
  afterEach(() => h.db.close());

  /** A public entry with plausible kill counts, so it carries no integrity flag. */
  const cleanScore = async (nickname = 'Pilot') => {
    const id = await insertScore(h.db, { score: 1000, nickname, completedAt: h.clock.now() });
    await h.db.run('UPDATE scores SET asteroids_destroyed = 20 WHERE id = ?', [id]);
    return id;
  };
  /** insertScore leaves kill counts at 0, so any positive score exceeds the frozen 1.2.0 bound and is flagged. */
  const flaggedScore = () => insertScore(h.db, { score: 5000, nickname: 'Flagged', completedAt: h.clock.now() });
  const report = async (id: string, reason: string, ip = '203.0.113.20') => {
    const res = await h.call('POST', `/api/v1/scores/${id}/report`, { ip, json: { reason } });
    expect(res.status).toBe(200);
  };
  const resolve = async (id: string) => {
    const { moderation_revision: revision } = (await h.db.first<{ moderation_revision: number }>('SELECT moderation_revision FROM scores WHERE id = ?', [id]))!;
    const res = await h.call('POST', `/api/v1/admin/scores/${id}/moderate`, { token: h.settings.adminToken!, json: { action: 'resolve', category: 'offensive', revision } });
    expect(res.status).toBe(200);
  };
  const run = (send: Sender, opts: { env?: Record<string, string>; scheduledTime?: number; db?: Db } = {}) =>
    runScheduled(opts.db ?? h.db, opts.env ?? ENV, h.clock.now(), opts.scheduledTime ?? h.clock.now(), { send, sleep: async () => {}, log: (e) => logs.push(e) });

  it('sends nothing when the queue is empty', async () => {
    await cleanScore();
    const mail = mockSender();
    expect(await run(mail.send)).toEqual({ status: 'empty' });
    expect(mail.sent).toHaveLength(0);
    expect(await count(h.db, 'moderation_digests')).toBe(0);
  });

  it('one report produces one short digest with the dashboard link', async () => {
    await report(await cleanScore(), 'offensive');
    const mail = mockSender();
    expect(await run(mail.send)).toMatchObject({ status: 'sent', day: '2026-10-22', entries: 1, attempt: 1 });
    expect(mail.sent).toHaveLength(1);
    const [email] = mail.sent;
    expect(email!.subject).toBe('Hull & Havoc — 1 moderation item awaiting review');
    expect(email!.text).toContain('Needs review: 1 entry');
    expect(email!.text).toContain('Open player reports: 1 on 1 entry');
    expect(email!.text).toContain('Offensive name: 1');
    expect(email!.text).toContain('Review: https://worker.test/admin');
    expect(email!.text).toContain('Nothing was hidden, renamed or deleted automatically.');
    expect(email!.text.split('\n').length).toBeLessThan(15);
    expect(email!.key).toBe('hull-and-havoc-moderation-digest-2026-10-22');
    expect(await h.db.first('SELECT status, attempts, provider_id FROM moderation_digests')).toEqual({ status: 'sent', attempts: 1, provider_id: 'msg-1' });
  });

  it('multiple reports produce one digest with correct counts by category', async () => {
    const a = await cleanScore('A');
    const b = await cleanScore('B');
    await cleanScore('C');
    await report(a, 'offensive', '203.0.113.1');
    await report(a, 'offensive', '203.0.113.2');
    await report(b, 'personal_info', '203.0.113.3');
    await report(b, 'other', '203.0.113.4');
    const mail = mockSender();
    await run(mail.send);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe('Hull & Havoc — 2 moderation items awaiting review');
    const text = mail.sent[0]!.text;
    expect(text).toContain('Needs review: 2 entries');
    expect(text).toContain('Open player reports: 4 on 2 entries');
    expect(text).toContain('Offensive name: 2');
    expect(text).toContain('Personal information: 1');
    expect(text).toContain('Other: 1');
    expect(text).not.toContain('Suspected cheating');
    expect(text).not.toContain('integrity flags');
  });

  it('includes unreviewed integrity flags, counts an entry once, and drops flags once reviewed', async () => {
    const flagged = await flaggedScore();
    const both = await flaggedScore();
    await report(both, 'suspicious_score');
    const mail = mockSender();
    await run(mail.send);
    expect(mail.sent[0]!.subject).toBe('Hull & Havoc — 2 moderation items awaiting review');
    expect(mail.sent[0]!.text).toContain('Unreviewed integrity flags: 2');
    expect(mail.sent[0]!.text).toContain('Suspected cheating: 1');
    await resolve(flagged);
    await resolve(both);
    h.clock.advance(DAY);
    expect(await run(mail.send)).toEqual({ status: 'empty' });
    expect(mail.sent).toHaveLength(1);
  });

  it('repeated or retried cron invocations on one day send a single email', async () => {
    await report(await cleanScore(), 'offensive');
    const mail = mockSender();
    const scheduledTime = h.clock.now();
    await run(mail.send, { scheduledTime });
    for (let i = 0; i < 3; i++) {
      h.clock.advance(SEND_LEASE_MS * 2);
      expect(await run(mail.send, { scheduledTime })).toEqual({ status: 'skipped', day: '2026-10-22' });
    }
    // A different invocation the same UTC day (e.g. a manual trigger) is also covered by the day key.
    expect((await run(mail.send, { scheduledTime: scheduledTime + 3_600_000 })).status).toBe('skipped');
    expect(mail.sent).toHaveLength(1);
  });

  it('repeats once a day while items remain, picks up new reports and stops when the queue is clear', async () => {
    const first = await cleanScore('First');
    await report(first, 'offensive');
    const mail = mockSender();
    await run(mail.send);
    const second = await cleanScore('Second');
    await report(second, 'personal_info');
    expect((await run(mail.send)).status).toBe('skipped'); // same day: new report waits for tomorrow
    h.clock.advance(DAY);
    await run(mail.send);
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]!.subject).toBe('Hull & Havoc — 2 moderation items awaiting review');
    expect(mail.sent[1]!.text).toContain('Personal information: 1');
    await resolve(first);
    h.clock.advance(DAY);
    await run(mail.send);
    expect(mail.sent[2]!.subject).toBe('Hull & Havoc — 1 moderation item awaiting review');
    expect(mail.sent[2]!.text).not.toContain('Offensive name');
    await resolve(second);
    h.clock.advance(DAY);
    expect(await run(mail.send)).toEqual({ status: 'empty' });
    expect(mail.sent).toHaveLength(3);
  });

  it('retries transient failures with one idempotency key and identical payload, within a daily cap', async () => {
    await report(await cleanScore(), 'offensive');
    const outage: SendResult = { ok: false, retryable: true, error: 'http_503' };
    const mail = mockSender(Array(2 * MAX_ATTEMPTS_PER_DAY).fill(outage));
    expect(await run(mail.send)).toMatchObject({ status: 'failed', attempt: 1, error: 'http_503', retryable: true });
    expect(mail.sent).toHaveLength(2); // one immediate retry
    await report(await cleanScore('Later'), 'other'); // counts change, but a retry resends the stored text
    for (let attempt = 2; attempt <= MAX_ATTEMPTS_PER_DAY; attempt++) expect(await run(mail.send)).toMatchObject({ status: 'failed', attempt });
    expect(await run(mail.send)).toMatchObject({ status: 'skipped' });
    expect(mail.sent).toHaveLength(2 * MAX_ATTEMPTS_PER_DAY);
    expect(new Set(mail.sent.map((m) => m.key)).size).toBe(1);
    expect(new Set(mail.sent.map((m) => m.text)).size).toBe(1);
    expect(await h.db.first('SELECT status, attempts, error FROM moderation_digests')).toEqual({ status: 'failed', attempts: MAX_ATTEMPTS_PER_DAY, error: 'http_503' });
    // The next day's run starts fresh with current counts once the provider recovers.
    h.clock.advance(DAY);
    expect(await run(mail.send)).toMatchObject({ status: 'sent', day: '2026-10-23' });
    expect(mail.sent.at(-1)!.subject).toBe('Hull & Havoc — 2 moderation items awaiting review');
  });

  it('does not retry a permanent provider error the same day, and tries again the next day', async () => {
    await report(await cleanScore(), 'offensive');
    const mail = mockSender([{ ok: false, retryable: false, error: 'http_403:validation_error' }]);
    expect(await run(mail.send)).toMatchObject({ status: 'failed', retryable: false });
    expect(await run(mail.send)).toMatchObject({ status: 'skipped' });
    expect(mail.sent).toHaveLength(1);
    h.clock.advance(DAY);
    expect((await run(mail.send)).status).toBe('sent');
  });

  it('takes over an abandoned send only after its lease, with the same key', async () => {
    await report(await cleanScore(), 'offensive');
    await h.db.run(`INSERT INTO moderation_digests (day, status, attempts, claimed_at, subject, body, updated_at)
      VALUES ('2026-10-22', 'sending', 1, ?, 'stored subject', 'stored body', ?)`, [h.clock.now(), h.clock.now()]);
    const mail = mockSender();
    expect((await run(mail.send)).status).toBe('skipped');
    h.clock.advance(SEND_LEASE_MS + 1);
    expect(await run(mail.send)).toMatchObject({ status: 'sent', attempt: 2 });
    expect(mail.sent).toEqual([{ subject: 'stored subject', text: 'stored body', key: 'hull-and-havoc-moderation-digest-2026-10-22' }]);
  });

  it('cleanup still runs when delivery throws or the digest ledger is unusable', async () => {
    const id = await cleanScore();
    await report(id, 'offensive');
    await h.db.run("INSERT INTO rate_limits (bucket, window_start, count) VALUES ('old', ?, 1)", [h.clock.now() - 10 * 3_600_000]);
    const throwing: Sender = async () => { throw new Error(`boom ${API_KEY}`); };
    const outcome = await run(throwing);
    expect(outcome).toEqual({ status: 'error', error: 'Error: boom [redacted]' });
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
    expect(await count(h.db, 'rate_limits', "bucket = 'old'")).toBe(0);
    expect(logs[0]).toMatchObject({ evt: 'prune', rateLimitRows: 1 });

    h.db.exec('DROP TABLE moderation_digests');
    await h.db.run("INSERT INTO rate_limits (bucket, window_start, count) VALUES ('old', ?, 1)", [h.clock.now() - 10 * 3_600_000]);
    await expect(run(mockSender().send)).resolves.toMatchObject({ status: 'error' });
    expect(await count(h.db, 'rate_limits', "bucket = 'old'")).toBe(0);
  });

  it('a cleanup failure still lets the digest run, then fails the invocation', async () => {
    await report(await cleanScore(), 'offensive');
    const mail = mockSender();
    const db = faultyDb(h.db, (sql) => sql.startsWith('DELETE FROM rate_limits'));
    await expect(run(mail.send, { db })).rejects.toThrow('simulated database failure');
    expect(mail.sent).toHaveLength(1);
    expect(logs.map((l) => l.evt)).toEqual(['prune_failed', 'moderation_digest']);
  });

  it('warns before reports expire and announces open reports deleted at the retention limit', async () => {
    const id = await cleanScore();
    await report(id, 'offensive', '203.0.113.1');
    await report(await cleanScore('Resolved'), 'other', '203.0.113.2');
    await resolve((await h.db.first<{ id: string }>("SELECT id FROM scores WHERE nickname = 'Resolved'"))!.id);
    const mail = mockSender();
    h.clock.advance(24 * DAY);
    await run(mail.send);
    expect(mail.sent[0]!.text).toContain('Expiring: 1 open report reaches the 30-day retention limit within 7 days');
    h.clock.advance(7 * DAY);
    expect(await run(mail.send)).toMatchObject({ status: 'sent' });
    expect(logs.at(-2)).toMatchObject({ evt: 'prune', reportRows: 2, unresolvedReportRows: 1 });
    expect(mail.sent[1]!.subject).toBe('Hull & Havoc — 1 unreviewed report expired');
    expect(mail.sent[1]!.text).toContain('Expired: 1 open report reached the 30-day limit and was deleted without review.');
    expect(mail.sent[1]!.text).toContain('Needs review: 0 entries');
    // Retention itself is unchanged: both reports are gone, and the following day is quiet.
    expect(await count(h.db, 'score_reports')).toBe(0);
    h.clock.advance(DAY);
    expect(await run(mail.send)).toEqual({ status: 'empty' });
  });

  it('expired reports that were already resolved do not trigger an email', async () => {
    const id = await cleanScore();
    await report(id, 'offensive');
    await resolve(id);
    h.clock.advance(31 * DAY);
    const mail = mockSender();
    expect(await run(mail.send)).toEqual({ status: 'empty' });
  });

  // Regression (cleanup runs before the digest): the only open report expires in the cleanup of the very run that composes the
  // digest, so the remaining queue the digest reads is empty. The expiry must still be announced, from a fresh ledger.
  it('announces a report that expires during the same run\'s cleanup when the remaining queue is empty', async () => {
    const id = await cleanScore();
    await report(id, 'offensive');
    const reportedAt = h.clock.now();
    const mail = mockSender();
    // Exactly at the limit the report is kept (strict cutoff) and is still a queue item, not an expiry.
    h.clock.advance(REPORT_RETENTION_MS);
    expect(await run(mail.send)).toMatchObject({ status: 'sent', entries: 1 });
    expect(mail.sent[0]!.subject).toBe('Hull & Havoc — 1 moderation item awaiting review');
    expect(await count(h.db, 'score_reports')).toBe(1);
    // The next day's run deletes it during cleanup; the digest that follows sees an empty queue.
    h.clock.advance(86_400_000);
    expect(h.clock.now() - reportedAt).toBeGreaterThan(REPORT_RETENTION_MS);
    expect(await run(mail.send)).toMatchObject({ status: 'sent', entries: 0, attempt: 1 });
    expect(logs.map((l) => l.evt)).toEqual(['prune', 'moderation_digest', 'prune', 'moderation_digest']);
    expect(logs[2]).toMatchObject({ reportRows: 1, unresolvedReportRows: 1 });
    expect(await count(h.db, 'score_reports')).toBe(0);
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]!.subject).toBe('Hull & Havoc — 1 unreviewed report expired');
    expect(mail.sent[1]!.text).toContain('Needs review: 0 entries');
    expect(mail.sent[1]!.text).toContain('Expired: 1 open report reached the 30-day limit and was deleted without review.');
    expect(mail.sent[1]!.text).not.toContain('earlier days');
    expect(await h.db.first(`SELECT status, expired FROM moderation_digests WHERE day = '${new Date(h.clock.now()).toISOString().slice(0, 10)}'`))
      .toEqual({ status: 'sent', expired: 1 });
    // The entry itself is untouched by expiry.
    expect(await count(h.db, 'scores', `id = '${id}' AND visibility = 'visible'`)).toBe(1);
  });

  it('carries an expiry notice past a provider outage that crosses the day boundary', async () => {
    await report(await cleanScore(), 'offensive');
    h.clock.advance(REPORT_RETENTION_MS + 1);
    const outage: SendResult = { ok: false, retryable: true, error: 'timeout' };
    const mail = mockSender([outage, outage]);
    // Day 1: the report expires in cleanup; both sends of the day time out (the provider may or may not have accepted them).
    expect(await run(mail.send)).toMatchObject({ status: 'failed', entries: 0, retryable: true });
    const day1 = new Date(h.clock.now()).toISOString().slice(0, 10);
    expect(await h.db.first(`SELECT status, expired FROM moderation_digests WHERE day = '${day1}'`)).toEqual({ status: 'failed', expired: 1 });
    // Day 2: nothing new expires and the queue is empty, but the undelivered notice is carried under a new day's key.
    h.clock.advance(86_400_000);
    expect(await run(mail.send)).toMatchObject({ status: 'sent', entries: 0, attempt: 1 });
    const last = mail.sent.at(-1)!;
    expect(last.subject).toBe('Hull & Havoc — 1 unreviewed report expired');
    expect(last.text).toContain('(1 of them on earlier days whose digest was not confirmed delivered)');
    expect(last.key).not.toBe(mail.sent[0]!.key);
    expect(await h.db.all('SELECT status, expired FROM moderation_digests ORDER BY day')).toEqual([
      { status: 'superseded', expired: 1 }, { status: 'sent', expired: 1 },
    ]);
    // Day 3: delivered, so quiet; nothing is pending.
    h.clock.advance(86_400_000);
    expect(await run(mail.send)).toEqual({ status: 'empty' });
    expect(mail.sent).toHaveLength(3);
  });

  it('adds carried expiries to new ones and resolves an earlier send abandoned mid-flight', async () => {
    await report(await cleanScore('Old'), 'offensive', '203.0.113.1');
    h.clock.advance(REPORT_RETENTION_MS - 86_400_000 + 1); // expires tomorrow
    await report(await cleanScore('Newer'), 'other', '203.0.113.2');
    const yesterday = new Date(h.clock.now() - 86_400_000).toISOString().slice(0, 10);
    // An earlier day's Worker died mid-send: its row is 'sending', so it is ambiguous whether that email arrived.
    await h.db.run(`INSERT INTO moderation_digests (day, status, attempts, claimed_at, subject, body, expired, updated_at)
      VALUES (?, 'sending', 1, ?, 's', 'b', 2, ?)`, [yesterday, h.clock.now() - 86_400_000, h.clock.now() - 86_400_000]);
    h.clock.advance(86_400_000);
    const mail = mockSender();
    expect(await run(mail.send)).toMatchObject({ status: 'sent', entries: 1 });
    expect(mail.sent[0]!.subject).toBe('Hull & Havoc — 1 moderation item awaiting review');
    expect(mail.sent[0]!.text).toContain('Expired: 3 open reports reached the 30-day limit and were deleted without review (2 of them on earlier days');
    expect(await h.db.first('SELECT status FROM moderation_digests WHERE day = ?', [yesterday])).toEqual({ status: 'superseded' });
  });

  it('a same-day takeover resends the stored text and does not supersede earlier days', async () => {
    await report(await cleanScore(), 'offensive');
    const today = new Date(h.clock.now()).toISOString().slice(0, 10);
    // Earlier failure with an expiry count, and today's first claim already stored (the Worker died before resolving earlier rows).
    await h.db.run(`INSERT INTO moderation_digests (day, status, attempts, claimed_at, subject, body, expired, updated_at)
      VALUES ('2026-10-01', 'failed', 3, 0, 's', 'b', 4, 0), (?, 'sending', 1, ?, 'stored subject', 'stored body', 4, ?)`, [today, h.clock.now(), h.clock.now()]);
    h.clock.advance(SEND_LEASE_MS + 1);
    const mail = mockSender();
    expect(await run(mail.send)).toMatchObject({ status: 'sent', attempt: 2 });
    expect(mail.sent).toEqual([{ subject: 'stored subject', text: 'stored body', key: `hull-and-havoc-moderation-digest-${today}` }]);
    // Left for tomorrow to carry again: a repeated notice is preferred to a lost one.
    expect(await h.db.first("SELECT status FROM moderation_digests WHERE day = '2026-10-01'")).toEqual({ status: 'failed' });
  });

  it('logs, rather than silently drops, reports that expire after the day\'s digest was already sent', async () => {
    await report(await cleanScore(), 'offensive');
    const today = new Date(h.clock.now() + REPORT_RETENTION_MS + 1).toISOString().slice(0, 10);
    await h.db.run(`INSERT INTO moderation_digests (day, status, attempts, claimed_at, subject, body, updated_at) VALUES (?, 'sent', 1, 0, 's', 'b', 0)`, [today]);
    h.clock.advance(REPORT_RETENTION_MS + 1);
    const mail = mockSender();
    expect(await run(mail.send)).toEqual({ status: 'skipped', day: today, expiredNotAnnounced: 1 });
    expect(logs.at(-1)).toMatchObject({ evt: 'moderation_digest', status: 'skipped', expiredNotAnnounced: 1 });
    expect(mail.sent).toHaveLength(0);
  });

  it('puts no credentials, names, identifiers or reporter data in the email or logs', async () => {
    const id = await cleanScore('SecretNick');
    await report(id, 'personal_info', '198.51.100.77');
    const flagged = await flaggedScore();
    const mail = mockSender();
    await run(mail.send);
    const reporterHash = (await h.db.first<{ reporter_hash: string }>('SELECT reporter_hash FROM score_reports'))!.reporter_hash;
    const { issuer_hash: issuerHash } = (await h.db.first<{ issuer_hash: string | null }>('SELECT issuer_hash FROM runs LIMIT 1'))!;
    const output = JSON.stringify(mail.sent) + JSON.stringify(logs);
    for (const secret of [API_KEY, reporterHash, 'SecretNick', 'Flagged', id, flagged, '198.51.100.77', 'test-salt', h.settings.adminToken!, ENV.MODERATION_DIGEST_TO]) {
      expect(output, secret).not.toContain(secret);
    }
    if (issuerHash) expect(output).not.toContain(issuerHash);
    expect(JSON.stringify(await h.db.all('SELECT * FROM moderation_digests'))).not.toContain(reporterHash);
  });

  it('is disabled, without touching the digest ledger, until fully and validly configured', async () => {
    await report(await cleanScore(), 'offensive');
    h.db.exec('DROP TABLE moderation_digests'); // proves the disabled path never queries it (i.e. safe before migration 0005)
    const mail = mockSender();
    expect(await run(mail.send, { env: { IP_HASH_SALT: 'x' } })).toEqual({ status: 'disabled', reason: 'not_configured' });
    const { MODERATION_DIGEST_FROM: _omit, ...partial } = ENV;
    expect(await run(mail.send, { env: partial })).toEqual({ status: 'disabled', reason: 'incomplete:MODERATION_DIGEST_FROM' });
    expect(await run(mail.send, { env: { ...ENV, MODERATION_DIGEST_TO: 'a@b.test, c@d.test', MODERATION_DASHBOARD_URL: 'http://worker.test/admin' } }))
      .toEqual({ status: 'disabled', reason: 'invalid:MODERATION_DIGEST_TO,MODERATION_DASHBOARD_URL' });
    expect(mail.sent).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
  });

  it('leaves scores, leaderboards and moderation state unchanged', async () => {
    const id = await cleanScore();
    await report(id, 'offensive');
    await flaggedScore();
    const snapshot = async () => JSON.stringify([
      await h.db.all('SELECT * FROM scores ORDER BY id'),
      await h.db.all('SELECT score_id, reason, status, created_at FROM score_reports ORDER BY score_id'),
      await h.db.all('SELECT * FROM moderation_audit'),
      (await h.call('GET', '/api/v1/leaderboard/all-time')).body,
      (await h.call('GET', '/api/v1/leaderboard/weekly')).body,
    ]);
    const before = await snapshot();
    await run(mockSender().send);
    await run(mockSender([{ ok: false, retryable: true, error: 'timeout' }]).send);
    expect(await snapshot()).toBe(before);
  });
});

describe('Resend delivery adapter', () => {
  const config: DigestConfig = { apiKey: API_KEY, apiUrl: RESEND_API_URL, from: ENV.MODERATION_DIGEST_FROM, to: ENV.MODERATION_DIGEST_TO, dashboardUrl: ENV.MODERATION_DASHBOARD_URL };
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('posts one plain-text email with bearer auth and the idempotency key', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchMock = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await resendSender(config, fetchMock)({ subject: 'S', text: 'T' }, 'key-1');
    expect(result).toEqual({ ok: true, id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    expect(seen!.url).toBe('https://api.resend.com/emails');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Idempotency-Key']).toBe('key-1');
    expect(seen!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(seen!.init.body as string)).toEqual({ from: ENV.MODERATION_DIGEST_FROM, to: [ENV.MODERATION_DIGEST_TO], subject: 'S', text: 'T' });
  });

  it('classifies provider errors without echoing their messages', async () => {
    const cases: Array<[number, unknown, boolean]> = [
      [500, { name: 'internal_server_error', message: 'x' }, true],
      [429, { name: 'rate_limit_exceeded' }, true],
      [409, { name: 'concurrent_idempotent_requests' }, true],
      [409, { name: 'invalid_idempotent_request' }, false],
      [401, { name: 'missing_api_key' }, false],
      [422, { name: 'validation_error', message: `The ${ENV.MODERATION_DIGEST_TO} domain is not verified ${API_KEY}` }, false],
    ];
    for (const [status, body, retryable] of cases) {
      const result = await resendSender(config, respond(status, body) as unknown as typeof fetch)({ subject: 'S', text: 'T' }, 'k');
      expect(result).toEqual({ ok: false, retryable, error: `http_${status}:${(body as { name: string }).name}` });
    }
    const html = await resendSender(config, (async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch)({ subject: 'S', text: 'T' }, 'k');
    expect(html).toEqual({ ok: false, retryable: true, error: 'http_502' });
  });

  it('treats network errors and timeouts as retryable', async () => {
    const offline = (async () => { throw new TypeError(`fetch failed ${API_KEY}`); }) as unknown as typeof fetch;
    expect(await resendSender(config, offline)({ subject: 'S', text: 'T' }, 'k')).toEqual({ ok: false, retryable: true, error: 'network_error' });
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    expect(await resendSender(config, hanging, 20)({ subject: 'S', text: 'T' }, 'k')).toEqual({ ok: false, retryable: true, error: 'timeout' });
  });

  it('validates configuration and only allows https or loopback endpoints', () => {
    expect(loadDigestConfig(ENV)).toMatchObject({ ok: true, config: { apiUrl: RESEND_API_URL, to: 'operator@digest.test' } });
    expect(loadDigestConfig({ ...ENV, MODERATION_DIGEST_FROM: 'moderation@digest.test' }).ok).toBe(true);
    expect(loadDigestConfig({ ...ENV, RESEND_API_URL: 'http://127.0.0.1:9999/emails' }).ok).toBe(true);
    expect(loadDigestConfig({ ...ENV, RESEND_API_URL: 'http://mail.example/emails' })).toEqual({ ok: false, reason: 'invalid:RESEND_API_URL' });
    expect(loadDigestConfig({ ...ENV, MODERATION_DIGEST_FROM: 'Hull & Havoc <not an address>' })).toEqual({ ok: false, reason: 'invalid:MODERATION_DIGEST_FROM' });
    expect(loadDigestConfig({ ...ENV, RESEND_API_KEY: '  ' })).toEqual({ ok: false, reason: 'incomplete:RESEND_API_KEY' });
  });
});
