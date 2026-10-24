import { describe, expect, it } from 'vitest';
import { sanitizeNickname } from '../src/nickname';
import { weekWindow } from '../src/week';
import { botRun, insertScore, makeClock, makeHarness, REFERENCE_SEED, T0 } from './harness';

const HOUR = 3_600_000;
type Entry = { id: string; rank: number; nickname: string; score: number };
const scores = (b: { entries: Entry[] }) => b.entries.map((e) => e.score);

describe('leaderboard ordering', () => {
  it('sorts highest first, ties go to the earlier finisher, then to the smaller id; ranks are ordinal', async () => {
    const h = makeHarness();
    await insertScore(h.db, { id: 'b', score: 500, completedAt: T0 - 5 * HOUR, rules: '1.0.0' });
    await insertScore(h.db, { id: 'a', score: 500, completedAt: T0 - 5 * HOUR }); // same score, same instant: id decides
    await insertScore(h.db, { id: 'c', score: 500, completedAt: T0 - 9 * HOUR, rules: '1.0.0' }); // earlier: first among the 500s
    await insertScore(h.db, { id: 'd', score: 900, completedAt: T0 });
    await insertScore(h.db, { id: 'e', score: 100, completedAt: T0 });
    const res = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(res.body.entries.map((e: Entry) => [e.id, e.rank])).toEqual([['d', 1], ['c', 2], ['a', 3], ['b', 4], ['e', 5]]);
    expect(res.body.total).toBe(5);
    expect(res.body.entries.map((e: { rulesVersion: string }) => e.rulesVersion)).toEqual(['1.3.0', '1.0.0', '1.3.0', '1.0.0', '1.3.0']);
    const detail = await h.call('GET', '/api/v1/scores/b');
    expect(detail.body).toMatchObject({ score: { rank: 4, rulesVersion: '1.0.0' }, ranks: { allTime: 4, weekly: null } });
  });

  it('excludes hidden, zero-score and unsupported-rules entries', async () => {
    const h = makeHarness();
    await insertScore(h.db, { score: 300, completedAt: T0 });
    const hidden = await insertScore(h.db, { score: 9999, completedAt: T0, visibility: 'hidden', rules: '1.0.0' });
    await insertScore(h.db, { score: 0, completedAt: T0 });
    await insertScore(h.db, { score: 8888, completedAt: T0, rules: '0.9.0' });
    const unknown = await insertScore(h.db, { score: 99999, completedAt: T0, rules: '9.0.0' });
    const res = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(scores(res.body)).toEqual([300]);
    expect(res.body.total).toBe(1);
    expect((await h.call('GET', `/api/v1/scores/${hidden}`)).status).toBe(404);
    const detail = await h.call('GET', `/api/v1/scores/${unknown}`);
    expect(detail.body).toMatchObject({ score: { rulesVersion: '9.0.0', rank: null }, ranks: { allTime: null, weekly: null } });
  });

  it('exposes only public display fields', async () => {
    const h = makeHarness();
    await insertScore(h.db, { score: 300, completedAt: T0, nickname: 'Pilot One' });
    const entry = (await h.call('GET', '/api/v1/leaderboard/all-time')).body.entries[0];
    expect(Object.keys(entry).sort()).toEqual(['completedAt', 'durationSeconds', 'endReason', 'id', 'nickname', 'rank', 'rulesVersion', 'score']);
  });

  it('rejected and unsubmitted runs never appear', async () => {
    const h = makeHarness();
    const run = await h.start({ seed: REFERENCE_SEED });
    await h.start();
    const bad = botRun(REFERENCE_SEED);
    bad.replay.claimedResult!.score += 1;
    await h.playAndSubmit(run, bad.replay);
    expect((await h.call('GET', '/api/v1/leaderboard/all-time')).body.total).toBe(0);
  });
});

describe('pagination is bounded', () => {
  it('defaults to 10, honours limit/offset and reports total', async () => {
    const h = makeHarness();
    for (let i = 1; i <= 25; i++) await insertScore(h.db, { score: i * 10, completedAt: T0, rules: i % 2 ? '1.0.0' : '1.3.0' });
    const first = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(first.body.entries).toHaveLength(10);
    expect(first.body.entries[0].score).toBe(250);
    const page = await h.call('GET', '/api/v1/leaderboard/all-time?limit=5&offset=10');
    expect(scores(page.body)).toEqual([150, 140, 130, 120, 110]);
    expect(page.body.entries[0].rank).toBe(11);
    expect(page.body.total).toBe(25);
    expect((await h.call('GET', `/api/v1/scores/${page.body.entries[0].id}`)).body.ranks.allTime).toBe(11);
    expect((await h.call('GET', '/api/v1/leaderboard/all-time?limit=100')).body.entries).toHaveLength(25);
  });

  it.each(['limit=0', 'limit=101', 'limit=-1', 'limit=abc', 'limit=1.5', 'offset=1001', 'offset=-5', 'limit=1e3', 'limit=99999999999999999999'])(
    'refuses %s',
    async (q) => {
      const h = makeHarness();
      expect((await h.call('GET', `/api/v1/leaderboard/all-time?${q}`)).status).toBe(400);
    },
  );
});

describe('weekly leaderboard', () => {
  it('keeps V1 through V3 in history while THIS WEEK uses V4', async () => {
    const h = makeHarness();
    await insertScore(h.db, { id: 'v1-history', score: 900, completedAt: T0, rules: '1.0.0' });
    await insertScore(h.db, { id: 'v2-history', score: 800, completedAt: T0, rules: '1.1.0' });
    await insertScore(h.db, { id: 'v3-history', score: 750, completedAt: T0, rules: '1.2.0' });
    await insertScore(h.db, { id: 'v4-current', score: 700, completedAt: T0, rules: '1.3.0' });
    const all = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(all.body.entries.map((e: { rulesVersion: string }) => e.rulesVersion)).toEqual(['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.entries.map((e: Entry) => e.id)).toEqual(['v4-current']);
    expect((await h.call('GET', '/api/v1/scores/v3-history')).body.ranks.weekly).toBeNull();
    expect((await h.call('GET', '/api/v1/scores/v2-history')).body).toMatchObject({ score: { score: 800, rulesVersion: '1.1.0' }, ranks: { allTime: 2, weekly: null } });
  });
  it('only counts scores completed inside the current Halifax week, using the server timestamp', async () => {
    const clock = makeClock(Date.UTC(2026, 9, 22, 15, 0, 0)); // Thursday
    const h = makeHarness({ clock });
    const w = weekWindow(clock.t, 'America/Halifax');
    await insertScore(h.db, { id: 'in-start', score: 100, completedAt: w.startMs });
    await insertScore(h.db, { id: 'in-end', score: 200, completedAt: w.endMs - 1 });
    await insertScore(h.db, { id: 'before', score: 9000, completedAt: w.startMs - 1 });
    await insertScore(h.db, { id: 'after', score: 9001, completedAt: w.endMs });
    await insertScore(h.db, { id: 'historical', score: 9999, completedAt: T0, rules: '1.0.0' });
    const res = await h.call('GET', '/api/v1/leaderboard/weekly');
    expect(res.body.entries.map((e: Entry) => e.id)).toEqual(['in-end', 'in-start']);
    expect(res.body).toMatchObject({ timeZone: 'America/Halifax', weekStart: '2026-10-19T03:00:00.000Z', weekEnd: '2026-10-26T03:00:00.000Z' });
    const all = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(all.body.total).toBe(5);
    expect(all.body.entries[0]).toMatchObject({ id: 'historical', rulesVersion: '1.0.0' });
  });

  it('rolls over at Halifax Monday midnight', async () => {
    const clock = makeClock(Date.UTC(2026, 9, 26, 2, 59, 59)); // Sunday 23:59:59 ADT
    const h = makeHarness({ clock });
    await insertScore(h.db, { id: 'sunday', score: 100, completedAt: clock.t });
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.entries.map((e: Entry) => e.id)).toEqual(['sunday']);
    clock.advance(1000); // Monday 00:00:00 ADT
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.entries).toEqual([]);
    expect((await h.call('GET', '/api/v1/leaderboard/all-time')).body.total).toBe(1);
  });

  it('a verified run lands on both boards with consistent ranks', async () => {
    const h = makeHarness();
    await insertScore(h.db, { score: 50000, completedAt: T0 - HOUR, nickname: 'Old Champ', rules: '1.0.0' }); // all-time only, despite being this week
    await insertScore(h.db, { score: 100, completedAt: T0 - HOUR });
    const run = await h.start({ seed: REFERENCE_SEED });
    const res = await h.playAndSubmit(run, botRun(REFERENCE_SEED).replay);
    expect(res.body.ranks).toEqual({ allTime: 2, weekly: 1 });
    const detail = await h.call('GET', `/api/v1/scores/${res.body.score.id}`);
    expect(detail.body.ranks).toEqual({ allTime: 2, weekly: 1 });
    expect(detail.body.score.score).toBe(34735);
    expect(res.body.score.rulesVersion).toBe('1.3.0');
    expect(detail.body.score.rulesVersion).toBe('1.3.0');
  });

  it('selects the weekly era from the active rules and excludes unmapped future rules safely', async () => {
    const h = makeHarness({ settings: { rulesVersion: '1.0.0' } });
    await insertScore(h.db, { id: 'v1', score: 200, completedAt: T0, rules: '1.0.0' });
    await insertScore(h.db, { id: 'v2', score: 300, completedAt: T0 });
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.entries.map((e: Entry) => e.id)).toEqual(['v1']);
    h.settings.rulesVersion = '9.0.0';
    expect((await h.call('GET', '/api/v1/leaderboard/weekly')).body.total).toBe(0);
    expect((await h.call('GET', '/api/v1/scores/v2')).body.ranks).toEqual({ allTime: 1, weekly: null });
  });
});

describe('moderation', () => {
  const admin = { authorization: 'Bearer test-admin-token-1234567890' };

  it('hiding removes an entry from boards and lookups; unhiding restores it', async () => {
    const h = makeHarness();
    const id = await insertScore(h.db, { score: 700, completedAt: T0, nickname: 'Rude Name' });
    await insertScore(h.db, { score: 300, completedAt: T0 });
    const url = `/api/v1/admin/scores/${id}/visibility`;

    const hide = await h.call('POST', url, { headers: admin, json: { visible: false, reason: 'offensive' } });
    expect(hide.status).toBe(200);
    expect(scores((await h.call('GET', '/api/v1/leaderboard/all-time')).body)).toEqual([300]);
    expect((await h.call('GET', `/api/v1/scores/${id}`)).status).toBe(404);
    expect((await h.db.first<{ hidden_reason: string }>('SELECT hidden_reason FROM scores WHERE id = ?', [id]))!.hidden_reason).toBe('offensive');

    await h.call('POST', url, { headers: admin, json: { visible: true } });
    expect(scores((await h.call('GET', '/api/v1/leaderboard/all-time')).body)).toEqual([700, 300]);
  });

  it('shifts ranks of the entries below a hidden one', async () => {
    const h = makeHarness();
    const top = await insertScore(h.db, { score: 700, completedAt: T0 });
    const second = await insertScore(h.db, { score: 300, completedAt: T0 });
    expect((await h.call('GET', `/api/v1/scores/${second}`)).body.ranks.allTime).toBe(2);
    await h.call('POST', `/api/v1/admin/scores/${top}/visibility`, { headers: admin, json: { visible: false } });
    expect((await h.call('GET', `/api/v1/scores/${second}`)).body.ranks.allTime).toBe(1);
  });

  it('requires the admin token; failures are rate limited; unknown ids are 404', async () => {
    const h = makeHarness();
    const id = await insertScore(h.db, { score: 700, completedAt: T0 });
    const url = `/api/v1/admin/scores/${id}/visibility`;
    expect((await h.call('POST', url, { json: { visible: false } })).status).toBe(401);
    expect((await h.call('POST', url, { headers: { authorization: 'Bearer wrong' }, json: { visible: false } })).status).toBe(401);
    expect((await h.call('POST', `/api/v1/admin/scores/${crypto.randomUUID()}/visibility`, { headers: admin, json: { visible: false } })).status).toBe(404);
    expect((await h.call('POST', url, { headers: admin, json: { visible: 'yes' } })).status).toBe(400);
    for (let i = 0; i < 12; i++) await h.call('POST', url, { headers: { authorization: 'Bearer nope' }, json: { visible: false } });
    expect((await h.call('POST', url, { headers: { authorization: 'Bearer nope' }, json: { visible: false } })).status).toBe(429);
    expect((await h.db.first<{ visibility: string }>('SELECT visibility FROM scores'))!.visibility).toBe('visible');
  });

  it('admin routes do not exist when no (sufficiently long) token is configured, and never send CORS headers', async () => {
    const h = makeHarness({ settings: { adminToken: null } });
    const id = await insertScore(h.db, { score: 700, completedAt: T0 });
    const res = await h.call('POST', `/api/v1/admin/scores/${id}/visibility`, { headers: admin, json: { visible: false } });
    expect(res.status).toBe(404);
    const h2 = makeHarness({ settings: { allowedOrigins: ['https://game.example'] } });
    const res2 = await h2.call('POST', `/api/v1/admin/scores/x/visibility`, { headers: { ...admin, origin: 'https://game.example' }, json: { visible: false } });
    expect(res2.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('nickname validation', () => {
  const ok = (v: unknown) => {
    const r = sanitizeNickname(v);
    return r.ok ? r.value : null;
  };
  it('accepts 3-16 letter/number names with spaces and _ . ! -', () => {
    expect(ok('ACE')).toBe('ACE');
    expect(ok('Space Cadet_99')).toBe('Space Cadet_99');
    expect(ok('Zoë-Ann!')).toBe('Zoë-Ann!');
    expect(ok('A'.repeat(16))).toBe('A'.repeat(16));
    expect(ok('日本語プレイヤー')).toBe('日本語プレイヤー');
  });
  it('trims, collapses whitespace and normalises to NFC', () => {
    expect(ok('  a   b  c ')).toBe('a b c');
    expect(ok('Café Bar')).toBe('Café Bar');
    expect(ok('tab\tsplit')).toBeNull();
  });
  it('absent or blank becomes Anonymous', () => {
    expect(ok(undefined)).toBe('Anonymous');
    expect(ok(null)).toBe('Anonymous');
    expect(ok('   ')).toBe('Anonymous');
  });
  it.each(['ab', 'A'.repeat(17), '<b>hi</b>', 'quote"d', '...', 'nul\u0000l', 'zero​width', 'rtl‮evil', 'emoji 😀 yes', 5, {}, [], true])(
    'refuses %j',
    (v) => {
      expect(ok(v)).toBeNull();
    },
  );
});

describe('routing hygiene', () => {
  it('health reports the supported rules version', async () => {
    const h = makeHarness();
    const res = await h.call('GET', '/api/v1/health');
    expect(res.body).toMatchObject({ ok: true, rulesVersion: '1.3.0', schemaVersion: 1 });
  });
  it('wrong methods and unknown paths get JSON errors', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/api/v1/runs')).status).toBe(405);
    expect((await h.call('POST', '/api/v1/leaderboard/all-time')).status).toBe(405);
    expect((await h.call('GET', '/api/v1/nope')).status).toBe(404);
    expect((await h.call('GET', '/api/v1/scores/does-not-exist')).status).toBe(404);
  });
  it('sends nosniff and no-store on mutating responses', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/api/v1/runs');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
