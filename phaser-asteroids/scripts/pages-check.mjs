// Deployment check: serves the production build from dist/ as the root of the deployed site, the way GitHub Pages will and loads it in a real
// (headless) Chrome. It exists to catch base-path mistakes that `vite preview` at "/" hides.
//
//   npm run test:pages          (builds first)
//   node scripts/pages-check.mjs               (reuse an existing build in dist/)
//
// The build is mounted at each of these URL prefixes, one after the other:
//   /asteroids-bootdev/   the deployed site: https://djblackett.github.io/asteroids-bootdev/ (override: PAGES_BASE_PATH=/other/)
//   /                     a custom domain such as asteroids.davidandrea.ca
// The server answers 404 for anything outside the mount, so a root-absolute asset URL that only works at "/" fails here.
// Like Pages, it redirects the mount without a trailing slash to the one with it.
//
// Chrome: CHROME_PATH, or a standard install location (GitHub's ubuntu runners ship /usr/bin/google-chrome).
// When CI is set Chrome runs with --no-sandbox, which hosted runners need and which is safe for our own build.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const projectMount = (process.env.PAGES_BASE_PATH ?? '/asteroids-bootdev/').replace(/^\/?/, '/').replace(/\/?$/, '/');
const MOUNTS = [...new Set([projectMount, '/'])];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json',
};

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

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

/** Serves dist/ under `mount`; everything else is a 404 that is recorded in `stray`. */
function startServer(mount) {
  const stray = [];
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (mount !== '/' && pathname === mount.slice(0, -1)) {
      res.writeHead(301, { Location: mount }).end();
      return;
    }
    if (!pathname.startsWith(mount)) {
      stray.push(pathname);
      res.writeHead(404).end('outside the deployment base path');
      return;
    }
    const rel = decodeURIComponent(pathname.slice(mount.length)) || 'index.html';
    const file = path.resolve(dist, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, stray, origin: `http://127.0.0.1:${server.address().port}` })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ is missing; run `npm run build` first.');
const audioFiles = fs.existsSync(path.join(dist, 'audio'))
  ? listFiles(path.join(dist, 'audio'), 'audio/').filter((f) => f.endsWith('.ogg'))
  : [];
if (audioFiles.length === 0) throw new Error('dist/audio has no .ogg files; the build is incomplete.');
// The two extra soundtracks are not loaded at start-up (only the saved / default one is); they download when somebody picks them.
const onDemandMusic = ['audio/music/megaman.mp3', 'audio/music/gatekeeper.mp3'];
for (const f of onDemandMusic) if (!fs.existsSync(path.join(dist, f))) throw new Error(`dist/${f} is missing; the build is incomplete.`);

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CI ? ['--no-sandbox'] : [])],
});
try {
  for (const mount of MOUNTS) await checkMount(mount);
} finally {
  await browser.close();
}
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function checkMount(mount) {
  const { server, stray, origin } = await startServer(mount);
  const url = (query = '') => `${origin}${mount}${query}`;
  const label = `[${mount}]`;
  console.log(`\n== ${origin}${mount}`);
  try {
    // 1. Plain URL, exactly what a visitor opens: it must load cleanly and fetch every audio file from under the mount.
    {
      const { page, problems, ok } = await open();
      await page.goto(url());
      const canvas = await page.waitForSelector('#game canvas', { timeout: 20000 }).then(() => true, () => false);
      if (!canvas) {
        check(`${label} canvas is created`, false, `no canvas; ${problems.join(' | ')}`);
        await page.close();
        return;
      }
      const wanted = audioFiles.map((f) => `${mount}${f}`);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !wanted.every((p) => ok.has(p))) await sleep(100);
      const missing = wanted.filter((p) => !ok.has(p));
      check(`${label} canvas is created and the page has no errors`, problems.length === 0, problems.join(' | '));
      check(`${label} all ${audioFiles.length} audio files load (200) from the base path`, missing.length === 0, `missing: ${missing.join(', ')}`);
      const early = onDemandMusic.filter((f) => ok.has(`${mount}${f}`));
      check(`${label} the extra soundtracks are not downloaded at start-up`, early.length === 0, `requested early: ${early.join(', ')}`);
      const secure = await page.evaluate(() => ({ secure: window.isSecureContext, pads: typeof navigator.getGamepads === 'function' }));
      check(`${label} Gamepad API is available in this (secure) context`, secure.secure && secure.pads, JSON.stringify(secure));
      await page.close();
    }
    // 2. Start a one-player game (?debug exposes the Phaser game instance).
    {
      const { page, problems } = await open();
      await page.goto(url('?debug'));
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      const info = await page.evaluate(() => ({ type: window.__game.renderer.type, w: window.__game.scale.width, h: window.__game.scale.height }));
      check(`${label} title screen renders (WebGL, 1280x720)`, info.type === 2 && info.w === 1280 && info.h === 720, JSON.stringify(info));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
      // The first key press unlocks audio; decoding on a cold headless browser can take a moment, so poll.
      const musicPlaying = () => window.__game.registry.get('audio').musicSound?.isPlaying ?? false;
      await page.waitForFunction(musicPlaying, null, { timeout: 10000 }).catch(() => {});
      const run = await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene').sim;
        return { lives: s.player.lives, music: window.__game.registry.get('audio').musicSound?.isPlaying ?? false };
      });
      check(`${label} a single-player game starts with the music playing`, run.lives === 3 && run.music === true, JSON.stringify(run));
      check(`${label} no errors while playing`, problems.length === 0, problems.join(' | '));
      await page.close();
    }
    // 2b. The soundtrack selector: a track picked on the title screen is fetched from under the base path and plays; a saved choice survives a reload.
    {
      const { page, problems, ok } = await open();
      await page.goto(url('?debug'));
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      for (const [i, file] of onDemandMusic.entries()) {
        const key = i === 0 ? 'music-megaman' : 'music-gatekeeper';
        if (i === 0) await page.keyboard.press('ArrowDown'), await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction((k) => window.__game.registry.get('audio').musicSound?.key === k && window.__game.registry.get('audio').musicSound.isPlaying, key, { timeout: 15000 }).catch(() => {});
        const now = await page.evaluate(() => {
          const a = window.__game.registry.get('audio');
          return { key: a.musicSound?.key, playing: a.musicSound?.isPlaying ?? false, choice: a.musicChoice, saved: localStorage.getItem('asteroids.musicTrack'), scene: window.__game.scene.isActive('StartScene') };
        });
        check(`${label} choosing ${key} on the title screen downloads it from the base path and plays it`, ok.has(`${mount}${file}`) && now.key === key && now.playing && now.saved === now.choice && now.scene, JSON.stringify(now));
      }
      await page.reload();
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.registry.get('audio').musicSound?.isPlaying, null, { timeout: 15000 }).catch(() => {});
      const reloaded = await page.evaluate(() => {
        const a = window.__game.registry.get('audio');
        return { choice: a.musicChoice, key: a.musicSound?.key, playing: a.musicSound?.isPlaying ?? false, game: window.__game.scene.isActive('GameScene') };
      });
      check(`${label} after a reload the saved soundtrack plays in the game`, reloaded.choice === 'gatekeeper' && reloaded.key === 'music-gatekeeper' && reloaded.playing && reloaded.game, JSON.stringify(reloaded));
      check(`${label} no errors with the extra soundtracks`, problems.length === 0, problems.join(' | '));
      await page.close();
    }
    // 3. Development query parameters must not break a normal load.
    {
      const { page, problems } = await open();
      await page.goto(url('?keydebug&debug'));
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
      await sleep(300);
      const panel = await page.evaluate(() => document.querySelector('[data-keydebug]') !== null);
      check(`${label} ?keydebug loads and shows its panel, with no errors`, panel && problems.length === 0, problems.join(' | '));
      await page.close();
    }
    check(`${label} nothing was requested outside the base path`, stray.length === 0, [...new Set(stray)].join(', '));
    const redirect = mount === '/' ? null : await fetch(`${origin}${mount.slice(0, -1)}`, { redirect: 'manual' });
    if (redirect) check(`${label} the path without a trailing slash redirects to it`, redirect.status === 301 && redirect.headers.get('location') === mount, `${redirect.status} ${redirect.headers.get('location')}`);
  } finally {
    server.close();
  }
}

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  const ok = new Set();
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
    else ok.add(new URL(r.url()).pathname);
  });
  return { page, problems, ok };
}
