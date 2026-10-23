// Shared bootstrap for the ranked browser suites: a real Cloudflare Worker runtime (workerd via `wrangler dev --local`) with a real
// local D1 database, the production build served by `vite preview`, and Chromium. Nothing about the backend is mocked.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const serverDir = path.join(root, 'server');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wranglerBin = path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' };

/** The Node build of the replay engine (what the server verifies with), for independent checks. */
export async function loadEngine() {
  return import(pathToFileURL(path.join(root, 'dist', 'node', 'index.js')).href);
}

export function makeChecker() {
  const state = { total: 0, failures: 0 };
  return {
    state,
    check(name, ok, detail = '') {
      state.total++;
      if (!ok) state.failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
      return ok;
    },
  };
}

export function findChrome() {
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

export async function waitFor(url, ok = (s) => s === 200) {
  for (let i = 0; i < 300; i++) {
    const status = await new Promise((resolve) => http.get(url, (res) => (res.resume(), resolve(res.statusCode))).on('error', () => resolve(0)));
    if (ok(status)) return;
    await sleep(150);
  }
  throw new Error(`${url} did not come up`);
}

export function requireBuild() {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html')) || !fs.existsSync(path.join(root, 'dist', 'node', 'index.js'))) {
    throw new Error('dist/ is missing; run `npm run build` first.');
  }
}

/** One Worker with its own empty D1 database. `vars` become Worker variables (e.g. RANKED_TIME_LIMIT_SECONDS). */
export class WorkerStack {
  /** `gamePort`: the port the game is served on; its origin is added to the Worker's ALLOWED_ORIGINS (browsers must be allowed to call it). */
  constructor({ port, gamePort, vars = {} }) {
    this.port = port;
    this.vars = gamePort ? { ALLOWED_ORIGINS: `http://127.0.0.1:${gamePort}`, ...vars } : vars;
    this.API = `http://127.0.0.1:${port}`;
    this.persist = fs.mkdtempSync(path.join(os.tmpdir(), 'asteroids-ranked-e2e-'));
    this.proc = null;
    this.log = '';
  }

  migrate() {
    const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'migrations', 'apply', 'asteroids-leaderboard', '--local', '--persist-to', this.persist], { cwd: serverDir, env, encoding: 'utf8' });
    return { ok: r.status === 0, output: (r.stdout + r.stderr).slice(-400) };
  }

  async start() {
    const args = [wranglerBin, 'dev', '--local', '--port', String(this.port), '--persist-to', this.persist, '--var', 'IP_HASH_SALT:ranked-e2e'];
    for (const [k, v] of Object.entries(this.vars)) args.push('--var', `${k}:${v}`);
    this.proc = spawn(process.execPath, args, { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => (this.log += d));
    this.proc.stderr.on('data', (d) => (this.log += d));
    await waitFor(`${this.API}/api/v1/health`);
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }

  /** Runs SQL from a file (any number of statements): for seeding test data directly. */
  exec(sqlText) {
    const file = path.join(this.persist, 'seed.sql');
    fs.writeFileSync(file, sqlText);
    const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', this.persist, '--file', file], { cwd: serverDir, env, encoding: 'utf8' });
    return r.status === 0;
  }

  /** Runs a read-only SQL query against the Worker's local D1 and returns the rows. */
  sql(query) {
    const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'asteroids-leaderboard', '--local', '--persist-to', this.persist, '--json', '--command', query], { cwd: serverDir, env, encoding: 'utf8' });
    try {
      return JSON.parse(r.stdout)[0].results;
    } catch {
      return null;
    }
  }

  cleanup() {
    this.stop();
    try {
      // On Windows the worker may still hold its files for a moment after it is killed; a leftover temp directory is harmless.
      fs.rmSync(this.persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* ignore */
    }
  }
}

/** The game build served at GAME, plus a Chromium. */
export async function startGameAndBrowser(gamePort) {
  const GAME = `http://127.0.0.1:${gamePort}/`;
  const preview = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(gamePort), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await waitFor(GAME);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  return {
    GAME,
    browser,
    async close() {
      await browser.close().catch(() => undefined);
      preview.kill();
    },
  };
}

// --- driving the game ------------------------------------------------------------------------------------------------------------

/** Opens the game, optionally pointed at a backend (`api`) and with extra query string, and waits for the title screen. */
export async function openTitle(context, GAME, { api, query = '' } = {}) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR|CORS|ERR_/.test(m.text()) && problems.push(m.text()));
  page.problems = problems;
  const q = new URLSearchParams(query.replace(/^\?/, ''));
  q.set('debug', '1');
  if (api) q.set('api', api);
  await page.goto(`${GAME}?${q}`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(500);
  return page;
}

const SCENES = { title: 'StartScene', result: 'GameScene', pause: 'GameScene' };

/** Items of whichever menu is open. */
export function menuItems(page, which = 'title') {
  return page.evaluate(
    ([which, scenes]) => {
      const scene = window.__game.scene.getScene(scenes[which]);
      if (which === 'title') return scene.menuSnapshot();
      if (which === 'result') return scene.resultMenuSnapshot();
      return scene.pauseMenuSnapshot();
    },
    [which, SCENES],
  );
}

/** Game-pixel centre of a menu item, as a CSS pixel position (the canvas may be scaled). */
export async function itemPoint(page, id, which = 'title') {
  const snap = await menuItems(page, which);
  const item = snap?.items.find((i) => i.id === id);
  if (!item) throw new Error(`no menu item "${id}" (menu has: ${snap?.items.map((i) => i.id).join(', ') ?? 'nothing'}; page ${snap?.page})`);
  return page.evaluate(
    ([x, y]) => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      return { x: c.left + (x * c.width) / 1280, y: c.top + (y * c.height) / 720 };
    },
    [item.x + item.w / 2, item.y + item.h / 2],
  );
}

export async function clickItem(page, id, which = 'title') {
  const p = await itemPoint(page, id, which);
  await page.mouse.click(p.x, p.y);
  await sleep(300);
}

/** Every visible Text of a scene (menus live in containers). */
export function sceneTexts(page, sceneKey) {
  return page.evaluate((key) => {
    const out = [];
    const walk = (list) =>
      list.forEach((o) => {
        if (o.type === 'Container') {
          if (o.visible) walk(o.list);
        } else if (o.type === 'Text' && o.visible && o.text !== '') out.push(o.text);
      });
    walk(window.__game.scene.getScene(key).children.list);
    return out;
  }, sceneKey);
}

export const rankedState = (page) => page.evaluate(() => window.__ASTEROIDS_RANKED__);

export function waitRanked(page, predicateSource, timeout = 45000) {
  return page.waitForFunction(`(${predicateSource})(window.__ASTEROIDS_RANKED__)`, null, { timeout, polling: 100 });
}
