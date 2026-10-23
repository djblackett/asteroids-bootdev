// Build once, then run only the explicitly selected, existing suites. No retries.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timed } from './lib/testTiming.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.TEST_TIMINGS ??= '1';
const suites = {
  smoke: 'scripts/smoke.mjs', keyboard: 'scripts/keyboard.mjs',
  combat: 'scripts/combat.mjs', coop: 'scripts/coop.mjs',
  gamepad: 'scripts/gamepad.mjs', touch: 'scripts/touch.mjs',
  music: 'scripts/music.mjs', menu: 'scripts/menu.mjs',
  'mobile-entry': 'scripts/mobile-entry.mjs', pages: 'scripts/pages-check.mjs',
  replay: 'scripts/replay-browser.mjs', ranked: 'scripts/ranked-browser.mjs',
  'ranked-ui': 'scripts/ranked-ui.mjs', 'ranked-input': 'scripts/ranked-input.mjs',
  worker: 'server/scripts/worker-e2e.mjs',
};
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const reuse = args.includes('--no-build');
const names = args.filter((arg) => arg !== '--no-build');
if (!names.length || names.some((name) => !Object.hasOwn(suites, name)) || new Set(names).size !== names.length) {
  console.error(`Usage: npm run test:feature -- [--no-build] <suite ...>\nSuites: ${Object.keys(suites).join(', ')}`);
  process.exit(1);
}
let active;
function stop() {
  if (!active?.pid || active.exitCode !== null || active.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(active.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  else {
    try { process.kill(-active.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
process.once('exit', stop);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { stop(); process.exit(code); });
async function run(name, childArgs) {
  await timed(name, () => new Promise((resolve, reject) => {
    active = spawn(process.execPath, childArgs, { cwd: root, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' });
    let expired = false;
    const timeout = setTimeout(() => { expired = true; stop(); }, 10 * 60 * 1000);
    active.once('error', (error) => { clearTimeout(timeout); reject(error); });
    active.once('exit', (code) => {
      clearTimeout(timeout);
      if (expired || code !== 0) reject(new Error(`${name}: ${expired ? 'exceeded 10-minute limit' : `exit ${code}`}`));
      else resolve();
    });
  }));
}
// An explicit --no-build is useful after a build when editing test scripts only.
// Never infer freshness from the mere existence of dist/.
try {
  if (reuse) console.log('Reusing dist/: you must rebuild after source, assets or build configuration changes.');
  else {
    if (!process.env.npm_execpath) throw new Error('Run through npm run test:feature so the existing build command is available.');
    await run('build', [process.env.npm_execpath, 'run', 'build']);
  }
  for (const name of names) await run(name, [suites[name]]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
