// End-to-end: real Chromium -> real game build -> real Cloudflare Worker runtime (workerd) -> real local D1 database -> public API.
// Nothing about verification is mocked. Also proves casual play is unaffected when the backend is offline.
//
//   npm run test:ranked          (builds first)
//
// Lifecycle exercised:
//   Chromium asks for a ranked run -> Worker issues seed/config -> the browser plays the deterministic game and records inputs ->
//   at game over it submits the recording -> the Worker replays it independently -> D1 stores the SERVER's score ->
//   GET /leaderboard returns that score.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { playUntilScoredThenDie } from './lib/browserPlay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const { verifyReplay } = await import(pathToFileURL(path.join(root, 'dist', 'node', 'index.js')).href);
const GAME_PORT = Number(process.env.RANKED_GAME_PORT ?? 4410); // must be in wrangler.toml ALLOWED_ORIGINS
const API_PORT = Number(process.env.RANKED_API_PORT ?? 8793);
const GAME = `http://127.0.0.1:${GAME_PORT}/`;
const API = `http://127.0.0.1:${API_PORT}`;
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'asteroids-ranked-e2e-'));
const wranglerBin = path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Chromium found. Set CHROME_PATH to a browser executable.');
  return found;
}

async function waitFor(url, ok = (s) => s === 200) {
  for (let i = 0; i < 200; i++) {
    const status = await new Promise((resolve) => http.get(url, (res) => (res.resume(), resolve(res.statusCode))).on('error', () => resolve(0)));
    if (ok(status)) return;
    await sleep(150);
  }
  throw new Error(`${url} did not come up`);
}

if (!fs.existsSync(path.join(root, 'dist', 'index.html')) || !fs.existsSync(path.join(root, 'dist', 'node', 'index.js'))) {
  throw new Error('dist/ is missing; run `npm run build` first.');
}

const migrate = spawnSync(process.execPath, [wranglerBin, 'd1', 'migrations', 'apply', 'asteroids-leaderboard', '--local', '--persist-to', persist], { cwd: serverDir, env, encoding: 'utf8' });
check('local D1 migrated from the repository migration files', migrate.status === 0, migrate.status === 0 ? '' : (migrate.stdout + migrate.stderr).slice(-300));
if (migrate.status !== 0) process.exit(1);

const worker = spawn(
  process.execPath,
  [wranglerBin, 'dev', '--local', '--port', String(API_PORT), '--persist-to', persist, '--var', 'IP_HASH_SALT:ranked-e2e'],
  { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] },
);
let workerLog = '';
worker.stdout.on('data', (d) => (workerLog += d));
worker.stderr.on('data', (d) => (workerLog += d));
const preview = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(GAME_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stopAll = () => {
  worker.kill();
  preview.kill();
};
process.on('exit', stopAll);

let browser;
try {
  await waitFor(`${API}/api/v1/health`);
  await waitFor(GAME);
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Part 1: ranked run, Chromium -> Worker -> D1 -> leaderboard ---');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const apiCalls = [];
  page.on('request', (r) => r.url().startsWith(API) && apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`));
  const NICK = 'Browser Ace';

  let record = null;
  let browserScore = 0;
  let attempts = 0;
  let maxCombo = 0;
  while (attempts < 4) {
    attempts++;
    await page.goto(`${GAME}?ranked=1&api=${encodeURIComponent(API)}&nick=${encodeURIComponent(NICK)}&debug=1`);
    await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await page.keyboard.press('Space'); // PLAY: asks the server for a challenge first
    await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), null, { timeout: 10000 });
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isVerified === true, null, { timeout: 5000 });

    const session = await page.evaluate(() => ({ ranked: window.__ASTEROIDS_RANKED__, seed: window.__ASTEROIDS_REPLAY__.seed }));
    if (attempts === 1) {
      check('challenge issued by the server before play (phase=playing, run id held)', session.ranked?.phase === 'playing' && /^[0-9a-f-]{36}$/.test(session.ranked.runId ?? ''));
      check('simulation seed is the server-issued seed, not the default or a URL value', Number.isInteger(session.seed) && session.seed > 1);
      check('the challenge came from POST /api/v1/runs', apiCalls.includes('POST /api/v1/runs'));
      const urlSeedIgnored = await page.evaluate(() => new URLSearchParams(location.search).has('seed'));
      check('no client-chosen seed in the launch URL', urlSeedIgnored === false);
    }

    maxCombo = await playUntilScoredThenDie(page);
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true, null, { timeout: 60000, polling: 50 });
    browserScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
    record = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getReplay());
    if (browserScore > 0) break;
    console.log(`  attempt ${attempts} scored 0; asking for a fresh server-issued run`);
  }
  check('browser game reached game over with a nonzero score', browserScore > 0, `score=${browserScore} after ${attempts} attempt(s), max combo ${maxCombo}`);

  await page.waitForFunction(() => ['accepted', 'rejected', 'failed'].includes(window.__ASTEROIDS_RANKED__?.phase), null, { timeout: 45000 });
  const ranked = await page.evaluate(() => window.__ASTEROIDS_RANKED__);
  check('browser submitted the recording and the server accepted it', ranked.phase === 'accepted', `phase=${ranked.phase} ${ranked.message}`);
  check('server-verified score equals the browser\'s own score', ranked.verifiedScore === browserScore, `server=${ranked.verifiedScore} browser=${browserScore}`);
  check('submission POSTed to /submit (gzip) exactly once', apiCalls.filter((c) => /POST \/api\/v1\/runs\/[0-9a-f-]+\/submit/.test(c)).length === 1);

  const node = verifyReplay(record);
  check('an independent Node replay agrees with the server\'s score', node.valid && node.calculatedScore === ranked.verifiedScore, `node=${node.calculatedScore}`);
  check('recording carries no client score for the server to trust (claim only cross-checked)', record.claimedResult?.score === browserScore);

  const overlay = await page.evaluate(() => {
    const texts = [];
    const walk = (list) => list.forEach((o) => (o.type === 'Text' ? texts.push(o.text) : o.list && walk(o.list)));
    walk(window.__game.scene.getScene('GameScene').children.list);
    const t = texts;
    return t.find((x) => x.startsWith('VERIFIED')) ?? t.find((x) => x.startsWith('RANKED')) ?? '';
  });
  check('game-over screen shows the server-verified result', overlay.startsWith('VERIFIED'), overlay);

  const board = await (await fetch(`${API}/api/v1/leaderboard/all-time`)).json();
  const weekly = await (await fetch(`${API}/api/v1/leaderboard/weekly`)).json();
  const entry = board.entries.find((e) => e.id === ranked.outcome.score.id);
  check('GET /leaderboard/all-time returns that score', !!entry && entry.score === browserScore && entry.nickname === NICK, JSON.stringify(entry));
  check('GET /leaderboard/weekly returns it too', weekly.entries.some((e) => e.id === ranked.outcome.score.id));
  check('exactly one score row exists', board.total === 1);

  const stored = await page.evaluate(() => localStorage.getItem('asteroids.rankedScores'));
  check('device-local personal best remembers the accepted score id', !!stored && JSON.parse(stored)[0].id === ranked.outcome.score.id);

  const sql = spawnSync(
    process.execPath,
    [wranglerBin, 'd1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', persist, '--json', '--command', 'SELECT s.score, s.reported_controls, s.ticks, r.status, r.seed FROM scores s JOIN runs r ON r.id = s.run_id'],
    { cwd: serverDir, env, encoding: 'utf8' },
  );
  let row = null;
  try {
    row = JSON.parse(sql.stdout)[0].results[0];
  } catch {}
  check('D1 holds the authoritative score and the run is terminal (accepted)', row?.score === browserScore && row?.status === 'accepted', JSON.stringify(row));
  check('D1 stored the server-issued seed that the browser used', row?.seed === record.header.seed);
  check('reported control scheme was recorded as untrusted metadata (keyboard)', row?.reported_controls === 'keyboard', `reported_controls=${row?.reported_controls}`);

  // The challenge is single-use: nothing in the page can resubmit it.
  const reused = await page.evaluate(() => window.__ASTEROIDS_RANKED__.runId);
  const resubmit = await fetch(`${API}/api/v1/runs/${reused}/submit`, { method: 'POST', headers: { authorization: 'Bearer guessed-token' }, body: '{}' });
  check('a guessed credential cannot touch the finished run (401)', resubmit.status === 401);

  // After game over, RETRY returns to the title screen: a ranked challenge is never silently reused or downgraded.
  await sleep(2200);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 5000 });
  check('RETRY after a ranked game returns to the title screen (needs a new server challenge)', true);

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Part 2: backend offline ---');
  worker.kill();
  await sleep(1500);
  const offline = await fetch(`${API}/api/v1/health`).then(() => true, () => false);
  check('the backend is really down', offline === false);

  const casual = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const casualApiCalls = [];
  casual.on('request', (r) => /\/api\/v1\//.test(r.url()) && casualApiCalls.push(r.url()));
  await casual.goto(`${GAME}?debug=1&api=${encodeURIComponent(API)}`);
  await casual.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await casual.keyboard.press('Space');
  await casual.waitForFunction(() => window.__game?.scene.isActive('GameScene'), null, { timeout: 5000 });
  const t1 = await casual.evaluate(() => window.__game.scene.getScene('GameScene').sim.time);
  await sleep(1200);
  const t2 = await casual.evaluate(() => window.__game.scene.getScene('GameScene').sim.time);
  check('casual game starts instantly and runs with the backend offline', t2 - t1 > 0.8, `sim clock advanced ${(t2 - t1).toFixed(2)} s in ~1.2 s`);
  check('casual game is not a recorded/verified run and has no ranked state', await casual.evaluate(() => !window.__ASTEROIDS_REPLAY__ && !window.__ASTEROIDS_RANKED__));
  check('casual game never contacts the leaderboard API', casualApiCalls.length === 0, `${casualApiCalls.length} calls`);
  await casual.close();

  const down = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await down.goto(`${GAME}?ranked=1&debug=1&api=${encodeURIComponent(API)}`);
  await down.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await down.keyboard.press('Space');
  await down.waitForFunction(() => window.__ASTEROIDS_RANKED__?.phase === 'failed', null, { timeout: 15000 });
  const stay = await down.evaluate(() => ({ start: window.__game.scene.isActive('StartScene'), game: window.__game.scene.isActive('GameScene') }));
  check('ranked request with the backend down stays on the title screen (no silent casual game)', stay.start && !stay.game);
  const noteText = await down.evaluate(() => window.__game.scene.getScene('StartScene').children.list.filter((o) => o.type === 'Text').map((o) => o.text).find((t) => t.startsWith('RANKED')) ?? '');
  check('the player is told ranked play is unavailable and can retry', /RANKED UNAVAILABLE/.test(noteText), noteText);
  await down.close();
} finally {
  await browser?.close();
  stopAll();
  await sleep(500);
  fs.rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${total - failures}/${total} ranked browser-to-backend checks passed\n`);
if (failures) console.log('Worker log tail:\n' + workerLog.slice(-1500));
process.exit(failures ? 1 : 0);
