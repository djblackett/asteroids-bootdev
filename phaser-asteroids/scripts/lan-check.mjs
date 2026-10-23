// Focused opt-in smoke check against an ALREADY RUNNING LAN stack. Writes real test scores to local LAN D1.
// npm.cmd run test:lan -- http://<PC-LAN-IP>:5173
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { chromium } from 'playwright-core';
import { findChrome, openTitle, clickItem, rankedState, waitRanked, sleep } from './lib/rankedStack.mjs';
import { playUntilScoredThenDie } from './lib/browserPlay.mjs';

const base = process.argv[2] ? new URL(process.argv[2]) : null;
if (!base || base.protocol !== 'http:' || isIP(base.hostname) !== 4 ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base.hostname)) {
  throw new Error('Supply the running private LAN URL, e.g. http://192.168.7.198:5173');
}
const origin = base.origin;
const probe = async (path, status, init) => {
  const response = await fetch(origin + path, init);
  assert.equal(response.status, status, path);
};
await probe('/api/v1/health', 200);
for (const path of ['/api/v1/admin/scores/x/visibility', '/cdn-cgi/local/explorer/api', '/__scheduled']) await probe(path, 404);
for (const path of ['/server/wrangler.toml', '/Server/wrangler.toml', '/server/.dev.vars', '/server/.wrangler/state-lan/', '/%73erver/wrangler.toml']) await probe(path, 403);
await probe('/api/v1/runs', 403, { method: 'POST', headers: { Origin: 'https://foreign.example' } });
console.log('PASS LAN health; admin/tooling/files blocked; foreign-origin POST refused');

const browser = await chromium.launch({ executablePath: findChrome(), headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await openTitle(context, origin + '/', { query: 'touch=0' });
  const environment = await page.evaluate(async () => {
    const api = await import('/src/ranked/api.ts');
    return { api: api.getApiBase(), secureContext: isSecureContext, compression: typeof CompressionStream };
  });
  assert.equal(environment.api, origin);
  console.log('PASS actual browser API selection:', JSON.stringify(environment));
  const requests = [];
  page.on('request', (r) => r.url().includes('/api/v1/') && requests.push(r.url()));
  let score;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt === 0) {
      await clickItem(page, 'ranked');
      await clickItem(page, 'start');
    } else {
      await clickItem(page, 'skip', 'result');
      await clickItem(page, 'play-again', 'result');
    }
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isVerified === true, null, { timeout: 20000 });
    await playUntilScoredThenDie(page);
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isGameOver(), null, { timeout: 90000 });
    await page.waitForFunction(() => window.__game.scene.getScene('GameScene').resultMenuSnapshot()?.page === 'result');
    score = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
    if (score > 0) break;
  }
  assert.ok(score > 0, 'scored a natural game over');
  await sleep(800);
  await page.locator('.nick-input').fill('LAN Smoke');
  await page.locator('.nick-input').press('Enter');
  await waitRanked(page, "r => ['accepted', 'rejected', 'failed'].includes(r?.phase)");
  const result = await rankedState(page);
  assert.equal(result.phase, 'accepted', result.message);
  assert.equal(result.verifiedScore, score);
  const id = result.outcome.score.id;
  for (const scope of ['weekly', 'all-time']) {
    const board = await page.evaluate(async (scope) => (await fetch(`/api/v1/leaderboard/${scope}?limit=100`)).json(), scope);
    assert.ok(board.entries.some((entry) => entry.id === id && entry.score === score && entry.nickname === 'LAN Smoke'));
  }
  assert.ok(requests.length >= 2 && requests.every((url) => new URL(url).origin === origin));
  assert.deepEqual(page.problems, []);
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('asteroids.rankedScores') ?? '[]'));
  assert.ok(stored.some((entry) => entry.id === id && entry.score === score));
  console.log(`PASS real browser ranked launch -> natural game over -> Worker replay accepted (${score}) -> both D1 boards -> persisted score after reload; id=${id}`);
  console.log('Desktop Chromium only. Android hardware/keyboard/fullscreen still require manual testing.');
} finally {
  await browser.close();
}
