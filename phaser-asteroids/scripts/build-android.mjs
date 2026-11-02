// Builds the web game for the Android app (capacitor.config.ts `webDir`) and checks the result before Capacitor can package it.
//
//   npm run build:android            typecheck + build into dist-android/ + verify
//   npm run android:sync             the above, then `cap sync android` (copies dist-android/ into the Android project)
//   node scripts/build-android.mjs --verify-only    check an existing dist-android/ without rebuilding
//
// Before building it also checks that the leaderboard will keep accepting this app's runs after later gameplay updates: the rules
// version it plays must be frozen (server/rules/versions.json) and its versionCode recorded with those rules in
// server/rules/released.json, which is what makes CI refuse to drop them (see server/rules/README.md).
//
// Different from `npm run build` (GitHub Pages) in exactly two ways:
//   1. Only the browser game is built. The server-only replay verifier (dist/node, ~8 MB) is never in the app.
//   2. The leaderboard URL comes from .env.android and is required: the build stops if it is missing, not https, a loopback or private
//      address, or if the shell has a different VITE_LEADERBOARD_API_URL. Afterwards the bundle must contain that exact origin. An
//      installed app can therefore never fall back to a development endpoint (see also resolveApiBase in src/ranked/api.ts).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifest, readReleased } from '../server/rules/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ANDROID_OUT_DIR = 'dist-android';
export const ANDROID_ENV_FILE = '.env.android';
export const API_KEY = 'VITE_LEADERBOARD_API_URL';

/** The `KEY=value` lines of a dotenv file (comments and blank lines ignored, optional quotes removed). */
export function parseEnvFile(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    out.set(key, value);
  }
  return out;
}

function isPrivateOrLocalHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The production API origin the app may use, or an Error explaining why `value` is not one. Only a bare https origin is accepted
 * (no path, query, credentials or port), so what is baked in is exactly what the server's health check and CORS rules describe.
 */
export function checkProductionApiUrl(value) {
  if (!value) return new Error(`${API_KEY} is not set in ${ANDROID_ENV_FILE}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    return new Error(`${API_KEY} is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:') return new Error(`${API_KEY} must be https: ${value}`);
  if (url.username || url.password) return new Error(`${API_KEY} must not contain credentials`);
  if (url.port) return new Error(`${API_KEY} must not name a port: ${value}`);
  if (isPrivateOrLocalHost(url.hostname)) return new Error(`${API_KEY} points at a local or private address: ${value}`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return new Error(`${API_KEY} must be a bare origin (no path such as /api/v1): ${value}`);
  }
  return url.origin;
}

/** Problems with a finished Android build in `dir` (empty: fine). */
export function verifyAndroidBuild(dir, apiOrigin) {
  const problems = [];
  if (!fs.existsSync(path.join(dir, 'index.html'))) problems.push(`${dir}/index.html is missing`);
  if (fs.existsSync(path.join(dir, 'node'))) problems.push(`${dir}/node exists: the server-only replay verifier must not be packaged`);
  const assets = path.join(dir, 'assets');
  const scripts = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
  if (scripts.length === 0) problems.push(`${dir}/assets has no scripts`);
  const containsApi = scripts.some((f) => fs.readFileSync(path.join(assets, f), 'utf8').includes(apiOrigin));
  if (scripts.length > 0 && !containsApi) problems.push(`no script in ${dir}/assets contains the production API origin ${apiOrigin}`);
  return problems;
}

/** versionCode and versionName from android/app/build.gradle. */
export function parseGradleVersion(text) {
  const code = /^\s*versionCode\s+(\d+)\s*$/m.exec(text);
  const name = /^\s*versionName\s+"([^"]+)"\s*$/m.exec(text);
  if (!code || !name) throw new Error('android/app/build.gradle: versionCode / versionName not found');
  return { versionCode: Number(code[1]), versionName: name[1] };
}

/** The rules and replay schema this source tree plays (src/replay/constants.ts). */
export function parseReplayVersions(text) {
  const rules = /export const GAMEPLAY_RULES_VERSION = '([^']+)';/.exec(text);
  const schema = /export const REPLAY_SCHEMA_VERSION = (\d+);/.exec(text);
  if (!rules || !schema) throw new Error('src/replay/constants.ts: GAMEPLAY_RULES_VERSION / REPLAY_SCHEMA_VERSION not found');
  return { rulesVersion: rules[1], schemaVersion: Number(schema[1]) };
}

/** Why this app build must not be packaged yet, as far as ranked compatibility goes (empty: fine). */
export function releaseRecordProblems({ rulesVersion, schemaVersion, versionCode, versionName }, manifest, released) {
  const problems = [];
  if (manifest.versions[rulesVersion]?.schemaVersion !== schemaVersion) {
    problems.push(`rules ${rulesVersion} (schema ${schemaVersion}) are not frozen: run \`npm run rules:freeze\` and register them in server/src/engines.ts`);
  }
  const record = released.builds.find((b) => b.platform === 'android' && b.versionCode === versionCode);
  const wanted = JSON.stringify({ platform: 'android', versionName, versionCode, rulesVersion, schemaVersion, distributed: null, supersededOn: null });
  if (!record) {
    problems.push(`versionCode ${versionCode} is not recorded in server/rules/released.json; add ${wanted}`);
  } else if (record.rulesVersion !== rulesVersion || record.schemaVersion !== schemaVersion) {
    problems.push(`versionCode ${versionCode} is recorded with rules ${record.rulesVersion} (schema ${record.schemaVersion}) but this build plays ${rulesVersion} (schema ${schemaVersion}): raise versionCode in android/app/build.gradle and add ${wanted}`);
  } else if (record.versionName !== versionName) {
    problems.push(`versionCode ${versionCode} is recorded as versionName ${record.versionName}, but build.gradle says ${versionName}`);
  }
  return problems;
}

/** Reads and checks the API origin from .env.android against the shell environment. Throws with a clear message. */
export function resolveAndroidApiOrigin(envFileText, shellValue) {
  const fromFile = parseEnvFile(envFileText).get(API_KEY);
  const origin = checkProductionApiUrl(fromFile);
  if (origin instanceof Error) throw origin;
  if (shellValue !== undefined && shellValue !== '') {
    const shell = checkProductionApiUrl(shellValue);
    if (shell instanceof Error || shell !== origin) {
      throw new Error(`${API_KEY} in the environment (${shellValue}) disagrees with ${ANDROID_ENV_FILE} (${origin}); unset it or change the file`);
    }
  }
  return origin;
}

function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  const envPath = path.join(root, ANDROID_ENV_FILE);
  if (!fs.existsSync(envPath)) throw new Error(`${ANDROID_ENV_FILE} is missing`);
  const origin = resolveAndroidApiOrigin(fs.readFileSync(envPath, 'utf8'), process.env[API_KEY]);
  const outDir = path.join(root, ANDROID_OUT_DIR);
  const build = {
    ...parseGradleVersion(fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8')),
    ...parseReplayVersions(fs.readFileSync(path.join(root, 'src', 'replay', 'constants.ts'), 'utf8')),
  };
  const recordProblems = releaseRecordProblems(build, readManifest(), readReleased());
  if (recordProblems.length > 0) throw new Error(`ranked compatibility check failed:\n  - ${recordProblems.join('\n  - ')}`);
  console.log(`[build:android] ${build.versionName} (${build.versionCode}) plays rules ${build.rulesVersion}, schema ${build.schemaVersion}: frozen and recorded`);

  if (!verifyOnly) {
    console.log(`[build:android] API ${origin} -> ${ANDROID_OUT_DIR}/`);
    const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    const result = spawnSync(process.execPath, [vite, 'build', '--mode', 'android', '--outDir', ANDROID_OUT_DIR, '--emptyOutDir'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, [API_KEY]: origin },
    });
    if (result.status !== 0) throw new Error(`vite build failed (exit ${result.status ?? result.signal})`);
  }

  const problems = verifyAndroidBuild(outDir, origin);
  if (problems.length > 0) throw new Error(`Android build check failed:\n  - ${problems.join('\n  - ')}`);
  console.log(`[build:android] OK: ${ANDROID_OUT_DIR}/ uses ${origin} and has no server-only files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`[build:android] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
