// Non-production release rehearsal: staged Wrangler migrations, historical Worker and client.
// Never accepts a remote database or production configuration. Requires local Git history, tar and dist/node.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { root, serverDir, waitFor, sleep } from './lib/rankedStack.mjs';
import { stopTestProcess } from './lib/stopTestProcess.mjs';
import { generateBotReplay } from '../server/testing/bot.mjs';

const baseline = 'c1871a92c6f2a99bbac6f8dc8885691804826737';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbital-release-rehearsal-'));
const migrations = path.join(temp, 'migrations');
// `d1 export --local` has no --persist-to flag in pinned Wrangler; use its config-relative default.
const persist = path.join(temp, '.wrangler', 'state');
const wrangler = path.join(serverDir, 'node_modules/wrangler/bin/wrangler.js');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(temp, 'logs') };
const base = `http://127.0.0.1:${Number(process.env.RELEASE_TEST_PORT ?? 8799)}`;
const admin = 'release-rehearsal-local-admin-only';
const origin = 'https://spacearcade.davidandrea.ca';
let worker;
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS  ${name}`); }
function cli(config, args) {
  const r = spawnSync(process.execPath, [wrangler, ...args, '--config', config], { cwd: serverDir, env, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, output: r.stdout + r.stderr, stdout: r.stdout };
}
function query(sql, config = current) {
  const r = cli(config, ['d1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', persist, '--json', '--command', sql]);
  assert.ok(r.ok, r.output);
  return JSON.parse(r.stdout).flatMap(r => r.results);
}
function execute(sql, config = current) {
  const file = path.join(temp, 'execute.sql'); fs.writeFileSync(file, sql);
  return cli(config, ['d1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', persist, '--file', file]);
}
function migrate() { return cli(current, ['d1', 'migrations', 'apply', 'asteroids-leaderboard', '--local', '--persist-to', persist]); }
function stage(name) { fs.copyFileSync(path.join(serverDir, 'migrations', name), path.join(migrations, name)); }
function config(name, main) {
  const file = path.join(temp, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ name: 'orbital-local-rehearsal', main, compatibility_date: '2026-06-01',
    d1_databases: [{ binding: 'DB', database_name: 'asteroids-leaderboard', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: migrations }],
    vars: { ADMIN_TOKEN: admin, IP_HASH_SALT: 'release-local-only', ALLOWED_ORIGINS: origin, RANKED_TIME_LIMIT_SECONDS: '5' } }));
  return file;
}
async function start(configFile) {
  let log = '';
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', configFile, '--persist-to', persist, '--port', new URL(base).port, '--inspector-port', '0'], { cwd: serverDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', d => { log += d; }); worker.stderr.on('data', d => { log += d; });
  try { await waitFor(`${base}/api/v1/health`); } catch { throw new Error(log); }
}
async function stop() { stopTestProcess(worker); worker = undefined; await sleep(400); }
async function api(route, body, authorized = false) {
  const r = await fetch(base + '/api/v1' + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(authorized ? { authorization: `Bearer ${admin}` } : { Origin: origin }), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control'), cors: r.headers.get('access-control-allow-origin') };
}
const current = config('current', path.join(serverDir, 'src/worker.ts'));
try {
  fs.mkdirSync(migrations);
  // Extract tracked sources only; no checkout, credentials, signing material or worktree changes.
  const historical = path.join(temp, 'historical');
  fs.mkdirSync(historical);
  const archive = path.join(temp, 'historical.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baseline, '--', 'phaser-asteroids/src', 'phaser-asteroids/server/src', 'phaser-asteroids/server/rules'], { cwd: path.dirname(root) });
  execFileSync('tar', ['-xf', archive, '-C', historical]);
  const legacyRoot = path.join(historical, 'phaser-asteroids');
  const old = config('old', path.join(legacyRoot, 'server/src/worker.ts'));
  const require = createRequire(path.join(serverDir, 'package.json'));
  const { build } = require('esbuild');
  const clientFile = path.join(temp, 'old-client.mjs');
  await build({ entryPoints: [path.join(legacyRoot, 'src/ranked/api.ts')], outfile: clientFile, bundle: true, format: 'esm', platform: 'browser', nodePaths: [path.join(root, 'node_modules')], define: { 'import.meta.env': '{}' } });
  const client = await import(pathToFileURL(clientFile));
  const engine = await import(pathToFileURL(path.join(root, 'dist/node/index.js')));
  const legacyFetch = (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Origin: origin } });
  stage('0001_init.sql'); stage('0002_time_limit.sql');
  check('Wrangler applies 0001/0002 to disposable pre-moderation D1', migrate().ok);
  const now = Date.now();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const seed = ids.map((id, i) => `INSERT INTO runs (id,token_hash,seed,rules_version,config_json,created_at,expires_at,status,score_id,replay_hash,issuer_hash) VALUES ('run-${id}','hash-${i}',1,'1.2.0','{}',${now},${now + 3600000},'accepted','${id}','replay-${i}','issuer-${i}');
    INSERT INTO scores (id,run_id,score,nickname,completed_at,rules_version,ticks,duration_ms,visibility,hidden_reason,hidden_at) VALUES ('${id}','run-${id}',${300 - i * 100},'Legacy ${i}',${now},'1.2.0',300,5000,'${i === 1 ? 'hidden' : 'visible'}',${i === 1 ? "'offensive'" : 'NULL'},${i === 1 ? now : 'NULL'});`).join('\n');
  assert.ok(execute(seed).ok);
  const beforeScores = query('SELECT * FROM scores ORDER BY id');
  const beforeRuns = query('SELECT * FROM runs ORDER BY id');
  stage('0003_reports.sql'); check('0003 applies independently', migrate().ok);
  assert.ok(execute(`INSERT INTO score_reports VALUES ('${ids[0]}','reporter-a','offensive',${now}),('${ids[1]}','reporter-b','other',${now - 1000});`).ok);
  const beforeReports = query('SELECT * FROM score_reports ORDER BY score_id');
  stage('0004_moderation_workflow.sql');
  // Inject a late statement failure into the disposable migration, then restore the exact committed bytes.
  fs.appendFileSync(path.join(migrations, '0004_moderation_workflow.sql'), '\nINSERT INTO deliberately_missing_table VALUES (1);\n');
  check('failed 0004 is reported as failure', !migrate().ok);
  check('failed 0004 rolls back rebuilt reports and additive columns', JSON.stringify(query('SELECT * FROM score_reports ORDER BY score_id')) === JSON.stringify(beforeReports) && !query('PRAGMA table_info(scores)').some(c => c.name === 'display_name'));
  check('failed migration is not recorded as applied', !query('SELECT name FROM d1_migrations').some(r => r.name.startsWith('0004')));
  stage('0004_moderation_workflow.sql'); check('corrected exact 0004 applies after failure', migrate().ok);
  const afterScores = query('SELECT * FROM scores ORDER BY id').map(({ display_name, moderation_revision, suspicion_reviewed, ...row }) => row);
  check('all historical score fields and hidden state preserved', JSON.stringify(afterScores) === JSON.stringify(beforeScores));
  check('linked runs, replay hashes and issuer hashes unchanged', JSON.stringify(query('SELECT * FROM runs ORDER BY id')) === JSON.stringify(beforeRuns));
  check('reports preserved with open default', JSON.stringify(query('SELECT score_id, reporter_hash, reason, created_at FROM score_reports ORDER BY score_id')) === JSON.stringify(beforeReports) && query('SELECT status FROM score_reports').every(r => r.status === 'open'));
  check('foreign keys valid after rebuild', query('PRAGMA foreign_key_check').length === 0);
  check('report and audit indexes present', ['idx_score_reports_created', 'idx_score_reports_queue', 'idx_moderation_audit_score'].every(n => query("SELECT name FROM sqlite_master WHERE type='index'").some(r => r.name === n)));
  check('invalid report reason and orphan audit rejected', !execute(`INSERT INTO score_reports VALUES ('${ids[0]}','new','bad',${now},'open');`).ok && !execute(`INSERT INTO moderation_audit (score_id,action,category,created_at,revision,was_visible,had_display_name,open_reports) VALUES ('missing','hide','other',${now},0,1,0,0);`).ok);
  const snapshot = JSON.stringify(query('SELECT * FROM scores ORDER BY id'));
  check('Wrangler reapply skips recorded migrations without changing data', migrate().ok && JSON.stringify(query('SELECT * FROM scores ORDER BY id')) === snapshot);
  check('raw SQL rerun fails rather than silently duplicating data', !execute(fs.readFileSync(path.join(migrations, '0004_moderation_workflow.sql'), 'utf8')).ok && JSON.stringify(query('SELECT * FROM scores ORDER BY id')) === snapshot);
  // The actual historical Worker must still write valid scores on the expanded schema.
  await start(old);
  check('historical Worker reads expanded D1 and excludes hidden entries', (await client.fetchLeaderboard(base, 'all-time', { limit: 10, offset: 0 }, legacyFetch)).total === 2);
  const issued = await client.requestChallenge(base, legacyFetch);
  const bot = generateBotReplay(engine, { seed: issued.seed, maxTicks: issued.timeLimitTicks, spin: true });
  await sleep(5200);
  async function submit(challenge, replay, nickname) {
    const prepared = await client.prepareSubmission({ base, challenge, replay, nickname, controls: 'unknown' });
    const response = await legacyFetch(prepared.url, { method: 'POST', headers: prepared.headers, body: prepared.body });
    return client.classifySubmitResponse({ status: response.status, body: await response.json() });
  }
  const accepted = await submit(issued, bot.replay);
  check('historical Worker accepts anonymous legacy gzip submission after migration', accepted.kind === 'accepted' && accepted.score.nickname === 'Anonymous');
  await stop(); await start(current);
  const retried = await submit(issued, bot.replay);
  check('new Worker accepts retry of historical Worker-issued/accepted run', retried.kind === 'accepted' && retried.replayed && retried.score.id === accepted.score.id);
  const fresh = await client.requestChallenge(base, legacyFetch);
  const freshBot = generateBotReplay(engine, { seed: fresh.seed, maxTicks: fresh.timeLimitTicks, spin: true });
  const screened = await submit(fresh, freshBot.replay, 'fuck');
  check('old client recognizes new content rejection and run remains issued', screened.kind === 'invalid_nickname' && query(`SELECT status FROM runs WHERE id='${fresh.runId}'`)[0].status === 'issued');
  await sleep(5200);
  const corrected = await submit(fresh, freshBot.replay, 'Legacy Pilot');
  check('old client corrects nickname and submits verified replay on new Worker', corrected.kind === 'accepted');
  const row = query(`SELECT * FROM runs WHERE id='${fresh.runId}'`)[0];
  check('accepted run preserves score/hash relationship', row.score_id === corrected.score.id && row.replay_hash?.length === 64 && query(`SELECT run_id FROM scores WHERE id='${corrected.score.id}'`)[0].run_id === fresh.runId);
  const target = ids[0];
  async function action(action, name) {
    const revision = query(`SELECT moderation_revision FROM scores WHERE id='${target}'`)[0].moderation_revision;
    const result = await api(`/admin/scores/${target}/moderate`, { action, category: 'other', revision, ...(name ? { name } : {}) }, true);
    assert.equal(result.status, 200);
  }
  for (const scope of ['all-time', 'weekly']) {
    const board = await api(`/leaderboard/${scope}?limit=1&offset=0`);
    check(`${scope} and detail advertise no-store with Android CORS`, board.cache === 'no-store' && board.cors === origin && (await api(`/scores/${target}`)).cache === 'no-store');
  }
  await action('rename', 'Reviewed Pilot');
  check('historical client displays replacement name and unchanged score', (await client.fetchScoreDetail(base, target, legacyFetch)).score.nickname === 'Reviewed Pilot' && (await client.fetchScoreDetail(base, target, legacyFetch)).score.score === 300);
  await action('hide');
  for (const scope of ['all-time', 'weekly']) {
    const board = await client.fetchLeaderboard(base, scope, { limit: 50, offset: 0 }, legacyFetch);
    const page = await client.fetchLeaderboard(base, scope, { limit: 1, offset: 1 }, legacyFetch);
    check(`${scope} hidden rows excluded from totals, ranks and offset pages`, !board.entries.some(e => e.id === target || e.id === ids[1]) && board.total === board.entries.length && board.entries.every((e, i) => e.rank === i + 1) && (!page.entries.length || page.entries[0].id === board.entries[1].id));
  }
  check('historical client handles hidden detail as missing', await client.fetchScoreDetail(base, target, legacyFetch) === null && (await api(`/scores/${target}`)).cache === 'no-store');
  await action('restore'); await action('restore_name');
  check('restored entry and original name immediately public', (await client.fetchScoreDetail(base, target, legacyFetch)).score.nickname === 'Legacy 0');
  for (const reason of ['offensive', 'personal_info', 'other']) {
    check(`old report reason ${reason} remains valid`, (await api(`/scores/${target}/report`, { reason })).status === 200);
  }
  check('cross-origin admin reads refused', (await api('/admin/scores')).status === 403);
  check('missing admin token refused without Origin', (await fetch(base + '/api/v1/admin/scores')).status === 401);
  const history = await api(`/admin/scores/${target}/history`, undefined, true);
  check('audit records associated with target entry', history.body.audit.length === 4 && query(`SELECT COUNT(*) AS n FROM moderation_audit WHERE score_id='${target}'`)[0].n === 4);
  const otherRun = query(`SELECT * FROM runs WHERE id='run-${ids[2]}'`);
  check('erasure API succeeds', (await api(`/admin/scores/${target}/delete`, {}, true)).status === 200);
  check('erasure cascades reports and anonymizes audit links', query(`SELECT * FROM score_reports WHERE score_id='${target}'`).length === 0 && query('SELECT * FROM moderation_audit WHERE score_id IS NULL').length === 5);
  check('actual linked run deleted and unrelated run preserved', query(`SELECT * FROM runs WHERE id='run-${target}'`).length === 0 && JSON.stringify(query(`SELECT * FROM runs WHERE id='run-${ids[2]}'`)) === JSON.stringify(otherRun));
  check('final foreign-key integrity and complete migration ledger', query('PRAGMA foreign_key_check').length === 0 && query('SELECT name FROM d1_migrations').length === 4);
  await stop();
  // 0005 (moderation digest ledger) is additive: stage it alone on the used 0004 database; no existing row may change.
  const tables0004 = () => JSON.stringify(['scores', 'runs', 'score_reports', 'moderation_audit', 'rate_limits'].map(t => query(`SELECT * FROM ${t} ORDER BY 1, 2`)));
  const before0005 = tables0004();
  stage('0005_moderation_digest.sql');
  check('additive 0005 applies after 0004 and changes no existing row', migrate().ok && tables0004() === before0005 && query('SELECT COUNT(*) AS n FROM moderation_digests')[0].n === 0);
  check('ledger records exactly 0001-0005 with valid foreign keys', query('PRAGMA foreign_key_check').length === 0 && JSON.stringify(query('SELECT name FROM d1_migrations ORDER BY id').map(r => r.name.slice(0, 4))) === '["0001","0002","0003","0004","0005"]');
  await start(old);
  check('historical Worker still serves boards on the 0005 schema', (await client.fetchLeaderboard(base, 'all-time', { limit: 10, offset: 0 }, legacyFetch)).total >= 1);
  await stop();
  const exportFile = path.join(temp, 'recovery.sql');
  const exported = cli(current, ['d1', 'export', 'asteroids-leaderboard', '--local', '--output', exportFile]);
  assert.ok(exported.ok, exported.output);
  check('local full SQL export succeeds and contains data', exported.ok && fs.statSync(exportFile).size > 0);
  const recovery = path.join(temp, 'recovered-state');
  const imported = cli(current, ['d1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', recovery, '--file', exportFile]);
  check('SQL export imports into a distinct empty local D1', imported.ok);
  const recoveryResult = cli(current, ['d1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', recovery, '--json', '--command', 'PRAGMA foreign_key_check; SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM score_reports) AS reports, (SELECT COUNT(*) FROM moderation_audit) AS audits;']);
  assert.ok(recoveryResult.ok, recoveryResult.output);
  const recovered = JSON.parse(recoveryResult.stdout);
  const expected = query('SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM score_reports) AS reports, (SELECT COUNT(*) FROM moderation_audit) AS audits;');
  check('recovered local D1 has matching counts and no FK errors', recovered[0].results.length === 0 && JSON.stringify(recovered[1].results) === JSON.stringify(expected));
  console.log(`\n${checks}/${checks} release migration and historical compatibility checks passed (baseline ${baseline}).`);
} finally {
  await stop();
  // Only this process's mkdtemp directory is eligible for cleanup.
  assert.ok(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('orbital-release-rehearsal-'));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
