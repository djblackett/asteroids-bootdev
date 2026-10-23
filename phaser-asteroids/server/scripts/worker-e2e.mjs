// Integration test against the REAL Worker runtime (workerd via `wrangler dev --local`) with a real local D1 database and the
// real clock. Nothing is mocked: runs are issued by the Worker, games are played by the headless bot, recordings are submitted over
// HTTP (some gzip-compressed, some concurrently) and read back through the public API.
//
//   npm run build            (in ..)   # builds dist/node for the bot
//   node scripts/worker-e2e.mjs          (or: npm run test:worker in this folder)
//
// It takes about a minute because ranked runs cannot be submitted before the time they took to play has really elapsed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { generateBotReplay } from '../testing/bot.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(serverDir, '..', 'dist', 'node', 'index.js')).href);
const PORT = Number(process.env.WORKER_E2E_PORT ?? 8792);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'e2e-admin-token-0123456789abcdef';
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'asteroids-lb-e2e-'));
const wranglerBin = path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' };

let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Create the local D1 database from the real migration files.
const migrate = spawnSync(process.execPath, [wranglerBin, 'd1', 'migrations', 'apply', 'asteroids-leaderboard', '--local', '--persist-to', persist], { cwd: serverDir, env, encoding: 'utf8' });
check('D1 migrations apply cleanly (local)', migrate.status === 0, migrate.status === 0 ? '' : (migrate.stdout + migrate.stderr).slice(-400));
if (migrate.status !== 0) process.exit(1);

// 2. Start the Worker.
const worker = spawn(
  process.execPath,
  [wranglerBin, 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--test-scheduled', '--var', `ADMIN_TOKEN:${ADMIN}`, '--var', 'IP_HASH_SALT:e2e-salt'],
  { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
worker.stdout.on('data', (d) => (log += d));
worker.stderr.on('data', (d) => (log += d));
const stop = () => worker.kill();
process.on('exit', stop);

async function waitReady() {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${BASE}/api/v1/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Worker did not start:\n' + log);
}

async function api(method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers, text };
}
const startRun = () => api('POST', '/api/v1/runs').then((r) => r.json);
const submitBody = (replay, extra = {}) => JSON.stringify({ replay, ...extra });

/** Issues runs until the bot, playing the server's own seed, finishes a short game with a positive score. */
async function playableRun() {
  for (let i = 0; i < 40; i++) {
    const run = await startRun();
    const bot = generateBotReplay(engine, { seed: run.seed, spin: true });
    if (bot.gameOver && bot.score > 0 && bot.ticks < 1800) return { run, bot };
  }
  throw new Error('could not find a short scoring game');
}

try {
  await waitReady();
  console.log(`\nWorker ready at ${BASE} (workerd + local D1, state in ${persist})\n`);

  // --- challenge issuance -------------------------------------------------------------------------------------------------
  const health = await api('GET', '/api/v1/health');
  check('health reports rules version', health.json?.rulesVersion === '1.1.0');
  const probe = await api('POST', '/api/v1/runs', { body: JSON.stringify({ seed: 1, config: { playerCount: 2 } }), headers: { 'content-type': 'application/json' } });
  check('POST /runs issues a challenge (201) with server-chosen seed and approved config', probe.status === 201 && probe.json.seed !== 1 && probe.json.config.playerCount === 1);
  check('challenge carries id, secret token, rules version, expiry', !!probe.json.runId && probe.json.token?.length >= 40 && probe.json.rulesVersion === '1.1.0' && Date.parse(probe.json.expiresAt) > Date.now());

  // --- prepare several real games, all played against server-issued seeds -----------------------------------------------------
  const honest = await playableRun();
  const forged = await playableRun();
  const wrongSeed = await playableRun();
  const impatient = await playableRun();
  const hidden = await playableRun();
  const nonOwner = await playableRun();
  const t0 = Date.now();
  console.log(`Prepared 6 server-seeded games (honest score ${honest.bot.score}, ${honest.bot.ticks} ticks).`);

  // Submissions that do not depend on elapsed time.
  const wrongToken = await api('POST', `/api/v1/runs/${nonOwner.run.runId}/submit`, { token: honest.run.token, body: submitBody(nonOwner.bot.replay) });
  check("another run's token cannot submit this run (401)", wrongToken.status === 401);
  const noToken = await api('POST', `/api/v1/runs/${nonOwner.run.runId}/submit`, { body: submitBody(nonOwner.bot.replay) });
  check('missing token is refused (401)', noToken.status === 401);
  const unknown = await api('POST', `/api/v1/runs/00000000-0000-4000-8000-000000000000/submit`, { token: 'x', body: '{}' });
  check('unknown run id is 404', unknown.status === 404);

  const bomb = gzipSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
  const bombRes = await api('POST', `/api/v1/runs/${nonOwner.run.runId}/submit`, { token: nonOwner.run.token, body: bomb, headers: { 'content-encoding': 'gzip' } });
  check('gzip bomb (40 MiB inflated) is refused with 413 inside workerd', bombRes.status === 413, `status=${bombRes.status}`);
  const trunc = submitBody(nonOwner.bot.replay).slice(0, 500);
  const truncRes = await api('POST', `/api/v1/runs/${nonOwner.run.runId}/submit`, { token: nonOwner.run.token, body: trunc });
  check('truncated JSON is refused (400) without burning the run', truncRes.status === 400);
  const badGzip = await api('POST', `/api/v1/runs/${nonOwner.run.runId}/submit`, { token: nonOwner.run.token, body: gzipSync(Buffer.from('{"replay":{}}')).subarray(0, 10), headers: { 'content-encoding': 'gzip' } });
  check('truncated gzip is refused (400)', badGzip.status === 400, `status=${badGzip.status}`);

  // A ten-minute recording claimed seconds after issue.
  const tenMinute = structuredClone(impatient.bot.replay);
  tenMinute.totalTicks = 36000;
  delete tenMinute.claimedResult;
  const fast = await api('POST', `/api/v1/runs/${impatient.run.runId}/submit`, { token: impatient.run.token, body: submitBody(tenMinute) });
  check('a ten-minute replay submitted seconds after issue is rejected (too_fast)', fast.status === 422 && fast.json.error.reason === 'too_fast', JSON.stringify(fast.json?.error?.reason));

  // Wait until the honest games have really taken as long as they claim.
  const needMs = Math.max(honest.bot.ticks, forged.bot.ticks, wrongSeed.bot.ticks, hidden.bot.ticks) * (1000 / 60) + 1500;
  const waitMs = Math.max(0, needMs - (Date.now() - t0));
  console.log(`Waiting ${(waitMs / 1000).toFixed(1)} s for the real clock to catch up with the longest game...`);
  await sleep(waitMs);

  // --- forgeries -------------------------------------------------------------------------------------------------------------
  const inflated = structuredClone(forged.bot.replay);
  inflated.claimedResult.score += 5000;
  const forgedRes = await api('POST', `/api/v1/runs/${forged.run.runId}/submit`, { token: forged.run.token, body: submitBody(inflated) });
  check('inflated score claim is rejected (422 score_mismatch)', forgedRes.status === 422 && forgedRes.json.error.reason === 'score_mismatch');
  const forgedAgain = await api('POST', `/api/v1/runs/${forged.run.runId}/submit`, { token: forged.run.token, body: submitBody(forged.bot.replay) });
  check('a rejected run is terminal even with a corrected replay (409)', forgedAgain.status === 409);

  const swapped = structuredClone(wrongSeed.bot.replay);
  swapped.header.seed = (swapped.header.seed + 1) >>> 0;
  const seedRes = await api('POST', `/api/v1/runs/${wrongSeed.run.runId}/submit`, { token: wrongSeed.run.token, body: submitBody(swapped) });
  check('replay with a different seed is rejected (seed_mismatch)', seedRes.status === 422 && seedRes.json.error.reason === 'seed_mismatch');

  // --- the honest run: concurrent, mixed gzip / identity, with duplicate and replayed requests ------------------------------------
  const body = submitBody(honest.bot.replay, { nickname: 'E2E Pilot', controls: { scheme: 'keyboard' } });
  const gz = gzipSync(Buffer.from(body));
  console.log(`Honest recording: ${(body.length / 1024).toFixed(0)} KB raw, ${(gz.length / 1024).toFixed(0)} KB gzip`);
  const tSubmit = performance.now();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? api('POST', `/api/v1/runs/${honest.run.runId}/submit`, { token: honest.run.token, body: gz, headers: { 'content-encoding': 'gzip' } })
        : api('POST', `/api/v1/runs/${honest.run.runId}/submit`, { token: honest.run.token, body }),
    ),
  );
  const submitMs = performance.now() - tSubmit;
  const accepted = results.filter((r) => r.status === 200);
  const fresh = accepted.filter((r) => r.json.replayed === false);
  const ids = new Set(accepted.map((r) => r.json.score.id));
  check('10 simultaneous submissions of one run: at least one 200, exactly one NEW acceptance', accepted.length >= 1 && fresh.length === 1, `statuses=${results.map((r) => r.status).join(',')}`);
  check('every acceptance refers to the same single score id', ids.size === 1);
  check('server-calculated score equals the independent Node result', accepted[0].json.score.score === honest.bot.score, `server=${accepted[0].json.score.score} node=${honest.bot.score} (${submitMs.toFixed(0)} ms for the batch)`);
  check('others were told to retry (409) rather than double-accepting', results.every((r) => r.status === 200 || r.status === 409));
  const replayedHttp = await api('POST', `/api/v1/runs/${honest.run.runId}/submit`, { token: honest.run.token, body });
  check('re-sending the recorded request returns the same score, flagged replayed', replayedHttp.status === 200 && replayedHttp.json.replayed === true && replayedHttp.json.score.id === [...ids][0]);
  const other = await api('POST', `/api/v1/runs/${honest.run.runId}/submit`, { token: honest.run.token, body: submitBody(honest.bot.replay, { nickname: 'Intruder' }) });
  check('a different payload for the accepted run is refused (409)', other.status === 409);

  // --- leaderboard -----------------------------------------------------------------------------------------------------------
  const allTime = await api('GET', '/api/v1/leaderboard/all-time');
  const weekly = await api('GET', '/api/v1/leaderboard/weekly');
  check('all-time board contains exactly the one verified score', allTime.json.total === 1 && allTime.json.entries[0].score === honest.bot.score && allTime.json.entries[0].nickname === 'E2E Pilot');
  check('weekly board contains it with the Halifax window', weekly.json.entries.length === 1 && weekly.json.timeZone === 'America/Halifax', `${weekly.json.weekStart} -> ${weekly.json.weekEnd}`);
  const detail = await api('GET', `/api/v1/scores/${[...ids][0]}`);
  check('score lookup returns ranks', detail.json.ranks.allTime === 1 && detail.json.ranks.weekly === 1);
  check('forged / wrong-seed / impatient runs left nothing on the board', allTime.json.entries.every((e) => e.score === honest.bot.score));

  // --- moderation ------------------------------------------------------------------------------------------------------------
  const hiddenBody = submitBody(hidden.bot.replay, { nickname: 'Hide Me' });
  const hiddenSubmit = await api('POST', `/api/v1/runs/${hidden.run.runId}/submit`, { token: hidden.run.token, body: hiddenBody });
  check('second honest run accepted', hiddenSubmit.status === 200);
  const noAuth = await api('POST', `/api/v1/admin/scores/${hiddenSubmit.json.score.id}/visibility`, { body: '{"visible":false}' });
  check('admin endpoint refuses requests without the token (401)', noAuth.status === 401);
  const hide = await api('POST', `/api/v1/admin/scores/${hiddenSubmit.json.score.id}/visibility`, { token: ADMIN, body: JSON.stringify({ visible: false, reason: 'e2e' }) });
  const afterHide = await api('GET', '/api/v1/leaderboard/all-time');
  check('hidden entry disappears from the public board', hide.status === 200 && afterHide.json.entries.every((e) => e.nickname !== 'Hide Me'));

  // --- CORS and housekeeping -------------------------------------------------------------------------------------------------
  const pre = await api('OPTIONS', '/api/v1/runs', { headers: { origin: 'http://127.0.0.1:4410', 'access-control-request-method': 'POST' } });
  check('CORS preflight allows the configured game origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:4410');
  const evil = await api('POST', '/api/v1/runs', { headers: { origin: 'https://evil.example' } });
  check('a browser origin that is not allow-listed is refused (403)', evil.status === 403);
  const cron = await fetch(`${BASE}/__scheduled?cron=17+7+*+*+*`);
  check('scheduled cleanup handler runs', cron.status === 200, `status=${cron.status}`);

  // --- rate limiting (last: it exhausts this client's start budget) ---------------------------------------------------------
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const r = await api('POST', '/api/v1/runs');
    if (r.status === 429) limited = r;
  }
  check('run starts are rate limited (429 with Retry-After)', !!limited && Number(limited.headers.get('retry-after')) > 0);
  const stillRead = await api('GET', '/api/v1/leaderboard/all-time');
  check('public reads still work while a client is throttled', stillRead.status === 200);
} finally {
  stop();
  await sleep(500);
  fs.rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${total - failures}/${total} real-Worker integration checks passed\n`);
process.exit(failures ? 1 : 0);
