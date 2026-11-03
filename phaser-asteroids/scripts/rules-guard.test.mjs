// node --test scripts/rules-guard.test.mjs
// Runs the real guard script against a scratch git repository laid out like this one, so the CI step is shown to fail on the changes
// it exists to stop. The rules themselves are unit-tested in server/tests/rulesCompat.test.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseNameStatus } from './rules-guard.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-guard-'));
  const rules = path.join(dir, 'phaser-asteroids', 'server', 'rules');
  fs.mkdirSync(path.join(rules, '1.2.0'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'phaser-asteroids', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(app, 'scripts', 'rules-guard.mjs'), path.join(dir, 'phaser-asteroids', 'scripts', 'rules-guard.mjs'));
  fs.copyFileSync(path.join(app, 'server', 'rules', 'policy.mjs'), path.join(rules, 'policy.mjs'));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(rules, file)), { recursive: true });
    fs.writeFileSync(path.join(rules, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  };
  const manifest = (hash) => ({ versions: { '1.2.0': { schemaVersion: 1, files: { 'engine.mjs': hash } } } });
  const released = (supersededOn = null) => ({ policy: { supportDays: 90 }, builds: [{ platform: 'android', versionName: '1.0', versionCode: 1, rulesVersion: '1.2.0', schemaVersion: 1, distributed: null, supersededOn }] });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  const guard = () => spawnSync(process.execPath, ['phaser-asteroids/scripts/rules-guard.mjs', 'HEAD~1'], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  write('1.2.0/engine.mjs', 'export const GAMEPLAY_RULES_VERSION = "1.2.0";\n');
  write('versions.json', manifest('a'));
  write('released.json', released());
  commit('freeze 1.2.0');
  return { dir, write, manifest, released, commit, guard, rm: (f) => fs.rmSync(path.join(rules, f), { recursive: true }) };
}

test('adding a new frozen version and filling in a release date passes', () => {
  const r = scratchRepo();
  r.write('1.3.0/engine.mjs', 'export const GAMEPLAY_RULES_VERSION = "1.3.0";\n');
  r.commit('freeze 1.3.0');
  const res = r.guard();
  assert.equal(res.status, 0, res.stderr);
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test('editing a frozen engine (and re-pinning its hash) fails', () => {
  const r = scratchRepo();
  r.write('1.2.0/engine.mjs', 'export const GAMEPLAY_RULES_VERSION = "1.2.0"; // tweaked\n');
  r.write('versions.json', r.manifest('b'));
  r.commit('edit');
  const res = r.guard();
  assert.equal(res.status, 1);
  assert.match(res.stderr, /frozen file modified/, res.stdout);
  assert.match(res.stderr, /entry for released rules 1\.2\.0 changed/);
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test('dropping a version that a distributed Android build needs fails, even with its records removed too', () => {
  const r = scratchRepo();
  r.rm('1.2.0');
  r.write('versions.json', { versions: {} });
  r.write('released.json', { policy: { supportDays: 90 }, builds: [] });
  r.commit('drop');
  const res = r.guard();
  assert.equal(res.status, 1);
  assert.match(res.stderr, /was removed \(records are permanent\)/);
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test('parseNameStatus keeps only the status letter and strips the rules prefix', () => {
  assert.deepEqual(parseNameStatus('A\tp/server/rules/1.3.0/engine.mjs\nM\tp/server/rules/released.json\n', 'p/server/rules/'), [
    { status: 'A', path: '1.3.0/engine.mjs' },
    { status: 'M', path: 'released.json' },
  ]);
});
