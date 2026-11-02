// node --test scripts/build-android.test.mjs   (npm run test:android-build)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProductionApiUrl, parseEnvFile, parseGradleVersion, parseReplayVersions, releaseRecordProblems, resolveAndroidApiOrigin, verifyAndroidBuild } from './build-android.mjs';
import { readManifest, readReleased } from '../server/rules/policy.mjs';

const PROD = 'https://asteroids-leaderboard.davejandrea.workers.dev';
const envText = `# comment\n\nVITE_LEADERBOARD_API_URL=${PROD}\r\n`;

test('parses the dotenv file (comments, CRLF, quotes)', () => {
  assert.equal(parseEnvFile(envText).get('VITE_LEADERBOARD_API_URL'), PROD);
  assert.equal(parseEnvFile(`A="x y"\nB='z'`).get('A'), 'x y');
});

test('accepts only a bare public https origin', () => {
  assert.equal(checkProductionApiUrl(PROD), PROD);
  assert.equal(checkProductionApiUrl(`${PROD}/`), PROD);
  for (const bad of [
    undefined,
    '',
    'not a url',
    'http://asteroids-leaderboard.davejandrea.workers.dev',
    'https://localhost',
    'https://127.0.0.1',
    'https://127.0.0.1:8787',
    'https://10.0.0.5',
    'https://192.168.1.20',
    'https://172.20.0.1',
    'https://[::1]',
    'https://box.local',
    `${PROD}/api/v1`,
    `${PROD}?x=1`,
    'https://user:pw@example.com',
    'https://example.com:8443',
  ]) {
    assert.ok(checkProductionApiUrl(bad) instanceof Error, `should reject ${bad}`);
  }
});

test('the shell may repeat the file value but never replace it', () => {
  assert.equal(resolveAndroidApiOrigin(envText, undefined), PROD);
  assert.equal(resolveAndroidApiOrigin(envText, ''), PROD);
  assert.equal(resolveAndroidApiOrigin(envText, `${PROD}/`), PROD);
  assert.throws(() => resolveAndroidApiOrigin(envText, 'http://127.0.0.1:8787'), /disagrees/);
  assert.throws(() => resolveAndroidApiOrigin(envText, 'https://other.example'), /disagrees/);
  assert.throws(() => resolveAndroidApiOrigin('# nothing here\n', undefined), /not set/);
  assert.throws(() => resolveAndroidApiOrigin('VITE_LEADERBOARD_API_URL=http://127.0.0.1:8787\n', undefined), /https/);
});

function fakeBuild({ api = PROD, node = false, index = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-build-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  if (index) fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js'), `const a="${api}";`);
  if (node) fs.mkdirSync(path.join(dir, 'node'));
  return dir;
}

test('a correct build passes', () => {
  assert.deepEqual(verifyAndroidBuild(fakeBuild(), PROD), []);
});

test('a build without the production origin, with the server bundle, or without index.html fails', () => {
  assert.match(verifyAndroidBuild(fakeBuild({ api: 'http://127.0.0.1:8787' }), PROD).join('\n'), /production API origin/);
  assert.match(verifyAndroidBuild(fakeBuild({ node: true }), PROD).join('\n'), /server-only/);
  assert.match(verifyAndroidBuild(fakeBuild({ index: false }), PROD).join('\n'), /index\.html/);
});

test('the committed .env.android names the production Worker', () => {
  const text = fs.readFileSync(new URL('../.env.android', import.meta.url), 'utf8');
  assert.equal(resolveAndroidApiOrigin(text, undefined), PROD);
});

test('this tree can be packaged: its rules are frozen and its versionCode is recorded with them', () => {
  const build = {
    ...parseGradleVersion(fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8')),
    ...parseReplayVersions(fs.readFileSync(new URL('../src/replay/constants.ts', import.meta.url), 'utf8')),
  };
  assert.deepEqual(releaseRecordProblems(build, readManifest(), readReleased()), []);
});

test('refuses to package a build whose rules are not frozen, or whose versionCode is unrecorded or recorded with other rules', () => {
  const manifest = { versions: { '1.2.0': { schemaVersion: 1 } } };
  const released = { policy: { supportDays: 90 }, builds: [{ platform: 'android', versionName: '1.0', versionCode: 1, rulesVersion: '1.2.0', schemaVersion: 1, distributed: null, supersededOn: null }] };
  const build = { versionCode: 1, versionName: '1.0', rulesVersion: '1.2.0', schemaVersion: 1 };
  assert.deepEqual(releaseRecordProblems(build, manifest, released), []);
  assert.match(releaseRecordProblems({ ...build, rulesVersion: '1.3.0' }, manifest, released).join(), /not frozen.*raise versionCode/s);
  assert.match(releaseRecordProblems({ ...build, versionCode: 2 }, manifest, released).join(), /versionCode 2 is not recorded/);
  assert.match(releaseRecordProblems({ ...build, versionName: '1.1' }, manifest, released).join(), /recorded as versionName 1\.0/);
  assert.throws(() => parseGradleVersion('defaultConfig {}'), /versionCode/);
  assert.deepEqual(parseGradleVersion('        versionCode 12\r\n        versionName "1.4"\r\n'), { versionCode: 12, versionName: '1.4' });
});
