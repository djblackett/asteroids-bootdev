// The compatibility rules for frozen replay engines, in one place, as plain functions over the two data files next to this one:
//   versions.json  every frozen rules version and the sha256 of each of its files (written by `npm run rules:freeze`)
//   released.json  every Android build handed out, the rules version it plays, and when a successor replaced it
// Used by server/tests/rulesCompat.test.ts (unit tests, before every deploy), scripts/rules-guard.mjs (CI: frozen files never change),
// scripts/production-health.mjs (after deploy) and scripts/build-android.mjs (before packaging an app). See README.md.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86_400_000;

/** sha256 of a file's bytes; for text files (anything but .gz) with CRLF read as LF, so a Windows checkout and CI agree. */
export function digest(bytes, name) {
  const buf = Buffer.from(bytes);
  if (name.endsWith('.gz')) return crypto.createHash('sha256').update(buf).digest('hex');
  return crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export const readJson = (file, dir = RULES_DIR) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
export const readManifest = (dir) => readJson('versions.json', dir);
export const readReleased = (dir) => readJson('released.json', dir);

const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the shape of released.json (empty: fine). */
export function releasedProblems(released) {
  const problems = [];
  if (!Number.isInteger(released?.policy?.supportDays) || released.policy.supportDays < 1) problems.push('policy.supportDays must be a positive integer');
  if (!Array.isArray(released?.builds)) return [...problems, 'builds must be an array'];
  const seen = new Set();
  for (const [i, b] of released.builds.entries()) {
    const at = `builds[${i}]`;
    if (b.platform !== 'android') problems.push(`${at}.platform must be "android"`);
    if (!Number.isInteger(b.versionCode) || b.versionCode < 1) problems.push(`${at}.versionCode must be a positive integer`);
    if (typeof b.versionName !== 'string' || !b.versionName) problems.push(`${at}.versionName is required`);
    if (!VERSION.test(b.rulesVersion ?? '')) problems.push(`${at}.rulesVersion must look like 1.2.0`);
    if (!Number.isInteger(b.schemaVersion)) problems.push(`${at}.schemaVersion must be an integer`);
    for (const f of ['distributed', 'supersededOn']) if (b[f] !== null && !DATE.test(b[f] ?? '')) problems.push(`${at}.${f} must be null or YYYY-MM-DD`);
    const key = `${b.platform}:${b.versionCode}`;
    if (seen.has(key)) problems.push(`${at}: versionCode ${b.versionCode} is listed twice`);
    seen.add(key);
  }
  return problems;
}

/**
 * The rules versions the server must still verify on `today`: every version a listed build plays, until `supportDays` after the day
 * that build was superseded (a successor that no longer needs those rules reached all users). A build not yet superseded, or not yet
 * handed out at all, always counts. Over time this set can only shrink, so a passing check never starts failing by itself.
 */
export function requiredVersions(released, today = new Date()) {
  const now = today.getTime();
  const out = new Set();
  for (const b of released.builds) {
    const end = b.supersededOn === null ? Infinity : Date.parse(`${b.supersededOn}T00:00:00Z`) + released.policy.supportDays * DAY_MS;
    if (now < end) out.add(b.rulesVersion);
  }
  return [...out].sort();
}

/** Problems with a set of supported versions (what the server registers or what /health reports) against the release record. */
export function supportProblems({ supported, current, released, today }) {
  const have = new Set(supported);
  const problems = [];
  if (!have.has(current)) problems.push(`the current rules version ${current} is not supported`);
  for (const v of requiredVersions(released, today)) {
    if (!have.has(v)) {
      const builds = released.builds.filter((b) => b.rulesVersion === v).map((b) => `${b.versionName} (${b.versionCode})`).join(', ');
      problems.push(`rules ${v} is still needed by distributed Android build(s) ${builds} and must stay supported`);
    }
  }
  return problems;
}

/** The version directory a path inside server/rules belongs to (`1.2.0/engine.mjs` -> `1.2.0`), or null for the shared files. */
export function versionOf(relPath) {
  const first = relPath.replace(/\\/g, '/').split('/')[0];
  return VERSION.test(first) ? first : null;
}

/**
 * The frozen-files guard, given what changed under server/rules between the base and the head of a change:
 *   changes   [{ status: 'A' | 'M' | 'D', path }] with paths relative to server/rules
 *   base/head { manifest, released } as parsed at each end
 * A frozen version's files may be added, never modified; they may be deleted only when the version is retired (gone from the head
 * manifest and not required by any distributed build). Manifest entries of existing versions never change. Release records are
 * append-only: a build's `distributed` and `supersededOn` dates are filled in once (supersededOn not backdated), nothing else changes.
 */
export function guardProblems({ changes, base, head, today }) {
  const problems = [];
  const required = new Set(requiredVersions(head.released, today));
  for (const { status, path: p } of changes) {
    const v = versionOf(p);
    if (!v) continue;
    if (status === 'M') problems.push(`${p}: frozen file modified (rules ${v} is released; bump the rules version and freeze a new one instead)`);
    if (status === 'D' && (head.manifest.versions[v] || required.has(v))) {
      problems.push(`${p}: frozen file deleted while rules ${v} is still ${required.has(v) ? 'required by a distributed Android build' : 'registered in versions.json'}`);
    }
  }
  for (const [v, entry] of Object.entries(base.manifest.versions)) {
    const now = head.manifest.versions[v];
    if (now && JSON.stringify(now) !== JSON.stringify(entry)) problems.push(`versions.json: the entry for released rules ${v} changed`);
    if (!now && required.has(v)) problems.push(`versions.json: rules ${v} was removed but distributed builds still need it`);
  }
  for (const b of base.released.builds) {
    const now = head.released.builds.find((x) => x.platform === b.platform && x.versionCode === b.versionCode);
    const at = `released.json: build ${b.versionCode}`;
    if (!now) {
      problems.push(`${at} was removed (records are permanent)`);
      continue;
    }
    for (const f of ['versionName', 'rulesVersion', 'schemaVersion']) if (now[f] !== b[f]) problems.push(`${at}: ${f} changed`);
    // The two dates are filled in once (null -> date) and never changed afterwards.
    for (const f of ['distributed', 'supersededOn']) if (b[f] !== null && now[f] !== b[f]) problems.push(`${at}: ${f} changed after it was set`);
    if (b.supersededOn === null && now.supersededOn !== null && Date.parse(`${now.supersededOn}T00:00:00Z`) < today.getTime() - 2 * DAY_MS) {
      problems.push(`${at} is marked superseded on ${now.supersededOn}, before this change (no backdating: the support period starts when it is recorded)`);
    }
  }
  return problems;
}
