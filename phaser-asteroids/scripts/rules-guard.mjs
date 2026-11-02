// CI guard for the frozen replay engines (server/rules/): compares this commit with a base commit and refuses changes that would make the
// server verify an already released rules version differently, or stop verifying one a distributed Android build still needs.
//
//   node scripts/rules-guard.mjs <base-ref>       e.g. origin/main (pull request) or the previous main commit (push)
//   npm run rules:guard -- origin/main
//
// The unit tests (server/tests/rulesCompat.test.ts) already check the files against their pinned hashes; this guard is what stops the
// hashes being re-pinned. The rules themselves are in server/rules/policy.mjs (guardProblems). Needs the base commit in the clone
// (actions/checkout with fetch-depth: 0).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardProblems, RULES_DIR } from '../server/rules/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, cwd = root) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

/** `git diff --name-status` lines for paths under server/rules, relative to it. Renames are reported as delete + add. */
export function parseNameStatus(text, prefix) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status: status[0], path: file.startsWith(prefix) ? file.slice(prefix.length) : file };
    });
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error('usage: node scripts/rules-guard.mjs <base-ref>');
  const top = git(['rev-parse', '--show-toplevel']).trim();
  const rel = path.relative(top, RULES_DIR).split(path.sep).join('/');
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  // Both ends are read from commits, not the working tree, so the guard judges exactly what would be merged. Paths are relative to
  // the top of the repository, so git runs there.
  const show = (rev, file) => {
    const res = spawnSync('git', ['show', `${rev}:${rel}/${file}`], { cwd: top, encoding: 'utf8' });
    return res.status === 0 ? JSON.parse(res.stdout) : null;
  };
  // Before server/rules existed there is nothing to protect.
  const state = (rev) => ({ manifest: show(rev, 'versions.json') ?? { versions: {} }, released: show(rev, 'released.json') ?? { policy: { supportDays: 1 }, builds: [] } });
  const changes = parseNameStatus(git(['diff', '--name-status', '--no-renames', mergeBase, 'HEAD', '--', rel], top), `${rel}/`);
  const problems = guardProblems({ changes, base: state(mergeBase), head: state('HEAD'), today: new Date() });
  console.log(`[rules:guard] ${changes.length} change(s) under ${rel} since ${mergeBase.slice(0, 12)}`);
  if (problems.length) throw new Error(`frozen rules guard failed:\n  - ${problems.join('\n  - ')}`);
  console.log('[rules:guard] OK: no released rules version was modified or dropped');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`[rules:guard] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
