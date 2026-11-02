// node --test scripts/build-android.test.mjs   (npm run test:android-build)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProductionApiUrl, parseEnvFile, resolveAndroidApiOrigin, verifyAndroidBuild } from './build-android.mjs';

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
