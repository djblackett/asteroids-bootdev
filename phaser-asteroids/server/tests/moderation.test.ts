import { afterEach, describe, expect, it } from 'vitest';
import { pruneReports } from '../src/moderation';
import { count, insertScore, makeHarness } from './harness';

describe('private leaderboard moderation and erasure', () => {
  const h = makeHarness({ settings: { allowedOrigins: ['https://game.test'] } });
  afterEach(async () => {
    await h.db.batch(['score_reports', 'scores', 'runs', 'rate_limits'].map((table) => ({ sql: `DELETE FROM ${table}`, params: [] })));
  });
  const score = () => insertScore(h.db, { score: 100, completedAt: h.clock.now(), nickname: 'Pilot' });
  const report = (id: string, reason: unknown = 'offensive', ip = '203.0.113.8') => h.call('POST', `/api/v1/scores/${id}/report`, { json: { reason }, ip });

  it('stores a fixed reason and pseudonymous reporter, deduplicates, and leaves rankings unchanged', async () => {
    const id = await score();
    expect((await report(id)).status).toBe(200);
    expect((await report(id, 'personal_info')).status).toBe(200);
    const rows = await h.db.all<any>('SELECT * FROM score_reports');
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('personal_info');
    expect(rows[0].reporter_hash).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    const board = await h.call('GET', '/api/v1/leaderboard/all-time');
    expect(board.body.entries[0].id).toBe(id);
    const detail = await h.call('GET', `/api/v1/scores/${id}`);
    expect(JSON.stringify(detail.body)).not.toContain('reporter');
  });

  it('rejects unknown/hidden scores, invalid reasons, foreign origins and oversized bodies', async () => {
    const id = await score();
    expect((await report(crypto.randomUUID())).status).toBe(404);
    expect((await report(id, '<script>')).status).toBe(400);
    expect((await h.call('POST', `/api/v1/scores/${id}/report`, { json: { reason: 'other' }, headers: { Origin: 'https://foreign.test' } })).status).toBe(403);
    expect((await h.call('POST', `/api/v1/scores/${id}/report`, { body: 'x'.repeat(4097) })).status).toBe(413);
    await h.db.run("UPDATE scores SET visibility = 'hidden' WHERE id = ?", [id]);
    expect((await report(id)).status).toBe(404);
  });

  it('rate limits reports and allows the app CORS preflight', async () => {
    const id = await score();
    for (let i = 0; i < 10; i++) expect((await report(id)).status).toBe(200);
    expect((await report(id)).status).toBe(429);
    const preflight = await h.call('OPTIONS', `/api/v1/scores/${id}/report`, { headers: { Origin: 'https://game.test' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://game.test');
  });

  it('removes reports after 30 days without extending retention on duplicate reports', async () => {
    const id = await score();
    await report(id);
    h.clock.advance(29 * 86_400_000);
    await report(id);
    expect(await pruneReports(h.db, h.clock.now())).toBe(0);
    h.clock.advance(2 * 86_400_000);
    expect(await pruneReports(h.db, h.clock.now())).toBe(1);
  });

  it('requires admin authorization, preserves hide/unhide, then atomically erases score, run and reports', async () => {
    const id = await score();
    const other = await score();
    await report(id);
    const route = `/api/v1/admin/scores/${id}`;
    expect((await h.call('POST', `${route}/delete`)).status).toBe(401);
    const token = h.settings.adminToken!;
    expect((await h.call('POST', `${route}/visibility`, { token, json: { visible: false } })).status).toBe(200);
    expect((await h.call('GET', `/api/v1/scores/${id}`)).status).toBe(404);
    expect((await h.call('POST', `${route}/visibility`, { token, json: { visible: true } })).status).toBe(200);
    expect((await h.call('POST', `${route}/delete`, { token, headers: { Origin: 'https://game.test' } })).status).toBe(403);
    const deleted = await h.call('POST', `${route}/delete`, { token, headers: { Origin: 'https://api.test' } });
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await count(h.db, 'scores')).toBe(1);
    expect(await count(h.db, 'runs')).toBe(1);
    expect(await count(h.db, 'score_reports')).toBe(0);
    expect((await h.call('GET', `/api/v1/scores/${other}`)).status).toBe(200);
    expect((await h.call('POST', `${route}/delete`, { token })).status).toBe(404);
  });

  it('does not expose erasure when administration is disabled', async () => {
    const disabled = makeHarness({ settings: { adminToken: null } });
    try { expect((await disabled.call('POST', `/api/v1/admin/scores/${crypto.randomUUID()}/delete`)).status).toBe(404); }
    finally { disabled.db.close(); }
  });
});
