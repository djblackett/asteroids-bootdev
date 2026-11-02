import assert from 'node:assert/strict';
import test from 'node:test';
import { GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../dist/node/index.js';
import { verifyProductionHealth } from './production-health.mjs';

const healthy = { ok: true, rulesVersion: GAMEPLAY_RULES_VERSION, schemaVersion: REPLAY_SCHEMA_VERSION, supportedRules: [GAMEPLAY_RULES_VERSION] };
// An Android build on older rules that is still inside its support period.
const releasedOld = { policy: { supportDays: 90 }, builds: [{ platform: 'android', versionName: '1.0', versionCode: 1, rulesVersion: '0.9.0', schemaVersion: 1, distributed: '2026-11-01', supersededOn: null }] };

test('accepts matching production versions with a read-only unauthenticated request', async () => {
  await verifyProductionHealth(async (url, options) => {
    assert.equal(url, 'https://asteroids-leaderboard.davejandrea.workers.dev/api/v1/health');
    assert.equal(options.method, undefined); // fetch defaults to GET
    assert.equal(options.headers, undefined);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(healthy);
  });
});

test('retries propagation failures, then accepts a compatible Worker', async () => {
  let calls = 0;
  const waits = [];
  await verifyProductionHealth(async () => {
    calls++;
    if (calls === 1) throw new Error('network unavailable');
    if (calls === 2) return Response.json({ ...healthy, rulesVersion: 'previous-version' });
    return Response.json(healthy);
  }, async (ms) => waits.push(ms));
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5_000, 5_000]);
});

test('accepts a Worker that still supports an older version a distributed app needs', async () => {
  await verifyProductionHealth(async () => Response.json({ ...healthy, supportedRules: ['0.9.0', GAMEPLAY_RULES_VERSION] }), async () => {}, { released: releasedOld });
});

test('blocks publication when the Worker dropped a version a distributed app still needs', async () => {
  let calls = 0;
  await assert.rejects(verifyProductionHealth(async () => {
    calls++;
    return Response.json(healthy);
  }, async () => {}, { released: releasedOld }), /verification failed; do not publish/);
  assert.equal(calls, 5);
});

for (const [name, response] of [
  ['HTTP failure', () => new Response('unavailable', { status: 503 })],
  ['invalid JSON', () => new Response('not JSON')],
  ['null body', () => Response.json(null)],
  ['ok false', () => Response.json({ ...healthy, ok: false })],
  ['truthy ok', () => Response.json({ ...healthy, ok: 'true' })],
  ['wrong rules', () => Response.json({ ...healthy, rulesVersion: 'previous-version' })],
  ['wrong schema', () => Response.json({ ...healthy, schemaVersion: REPLAY_SCHEMA_VERSION + 1 })],
  ['missing schema', () => Response.json({ ok: true, rulesVersion: GAMEPLAY_RULES_VERSION, supportedRules: [GAMEPLAY_RULES_VERSION] })],
  ['missing supportedRules (a Worker from before multi-version support)', () => Response.json({ ok: true, rulesVersion: GAMEPLAY_RULES_VERSION, schemaVersion: REPLAY_SCHEMA_VERSION })],
  ['supportedRules without the current rules', () => Response.json({ ...healthy, supportedRules: ['0.9.0'] })],
  ['network timeout', () => { throw new Error('request timed out'); }],
]) {
  test(`blocks publication after five attempts: ${name}`, async () => {
    let calls = 0;
    let waits = 0;
    await assert.rejects(verifyProductionHealth(async () => {
      calls++;
      return response();
    }, async () => { waits++; }), /verification failed; do not publish/);
    assert.equal(calls, 5);
    assert.equal(waits, 4);
  });
}
