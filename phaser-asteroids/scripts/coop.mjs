// Browser test for two-player co-op: drives the production build in a real (headless) Chrome with genuine key events for
// BOTH players on one keyboard, using the `?debug` hook only to place things that would take minutes to reach (a rock on
// a ship, a Revive on the field, a UFO next to a ship). Each check reads something a player could see: the pixels of the
// ships, the HUD texts, the simulation counters.
//
//   npm run test:coop          (builds first)
//   CHROME_PATH=/path/to/chrome node scripts/coop.mjs     (reuse an existing build in dist/)
//
// Screenshots go to scripts/.smoke-output/ (git-ignored). Software WebGL (SwiftShader) in headless Chrome only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.COOP_PORT ?? 4399);
const BASE = `http://127.0.0.1:${PORT}/`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((resolve) => {
      http.get(BASE, (res) => (res.resume(), resolve(res.statusCode === 200))).on('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error('preview server did not start');
}

/** Minimal PNG decoder (8-bit RGB / RGBA, non-interlaced), enough to count coloured pixels in a screenshot. */
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + x] = r & 255;
    }
  }
  return { width, height, bpp, data: out };
}
/** Pixels of `png` inside the box (centre cx, cy, half-size r) within `tol` of the colour `rgb`. */
function countColor(png, cx, cy, r, rgb, tol = 40) {
  let n = 0;
  for (let y = Math.max(0, cy - r); y < Math.min(png.height, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(png.width, cx + r); x++) {
      const i = (y * png.width + x) * png.bpp;
      if (Math.abs(png.data[i] - rgb[0]) <= tol && Math.abs(png.data[i + 1] - rgb[1]) <= tol && Math.abs(png.data[i + 2] - rgb[2]) <= tol) n++;
    }
  }
  return n;
}

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing; run `npm run build` first.');
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

let browser;
let browserVersion = '?';
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
  });
  browserVersion = browser.version();
  await run(browser);
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed  (Chromium ${browserVersion}, headless, software WebGL; no Firefox, Safari or GPU)`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // A new visitor's soundtrack is Random now; this suite counts music instances, so it starts on Original (the music suite covers the default).
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('asteroids.musicTrack') === null) localStorage.setItem('asteroids.musicTrack', 'original');
    } catch {
      // storage blocked: nothing to seed
    }
  });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  const S = `window.__game.scene.getScene('GameScene')`;
  const shot = (name) => page.screenshot({ path: path.join(outDir, `coop-${name}.png`) });
  const pixels = async () => decodePng(await page.screenshot());
  const evalSim = (body) => page.evaluate(`(() => { const s = ${S}.sim; ${body} })()`);
  const sim = () =>
    page.evaluate(`(() => { const s = ${S}.sim; const pl = (p) => p && ({ n: p.playerNumber, x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, score: p.score,
        shield: p.shieldActive, respawning: p.isRespawning, rapid: p.rapidFire.active, multi: p.multiShot.active, boost: p.boost.active, mega: p.megaPower.active,
        laser: p.laser.shotsRemaining, speed: p.speedMultiplier });
      return { time: s.time, phase: s.phase, over: s.isGameOver, reason: s.gameOverReason, count: s.players.length, p1: pl(s.player), p2: pl(s.player2),
        shots: s.shots.length, shotOwners: s.shots.map((x) => x.owner), ufoShots: s.ufoShots.map((x) => ({ x: x.position.x, y: x.position.y, vx: x.velocity.x, vy: x.velocity.y })),
        asteroids: s.asteroids.length, powerups: s.powerups.map((x) => x.type), lasers: s.lasers.length, ufos: s.ufos.length, particles: s.particles.activeCount,
        combo: s.combo.count, shared: s.sharedLives, total: s.totalScore, config: s.config, retry: s.retryDelay, paused: ${S}.paused, reviveEligible: s.reviveEligible, reviveOnField: s.reviveOnField }; })()`);
  // Overlay lines (pause / game over) live inside Containers: flatten them, honouring the container's visibility.
  const VISIBLE_TEXTS = `${S}.children.list.flatMap((c) => (c.type === 'Container' ? (c.visible ? c.list : []) : [c])).filter((c) => c.type === 'Text' && c.visible && c.text !== '')`;
  const texts = () => page.evaluate(`${VISIBLE_TEXTS}.map((t) => t.text)`);
  const textBoxes = () => page.evaluate(`${VISIBLE_TEXTS}.map((t) => ({ text: t.text, x: t.x, y: t.y, right: t.getBounds().right, left: t.getBounds().left }))`);
  const events = (type, pred = 'true') => page.evaluate(`window.__events.filter((e) => e.type === '${type}' && (${pred})).length`);
  const clearEvents = () => page.evaluate('window.__events.length = 0');
  const keyTap = async (key, ms = 60) => (await page.keyboard.down(key), await sleep(ms), await page.keyboard.up(key));
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  /** Starts a fresh page at the title screen and returns once it is shown. */
  const title = async () => {
    await page.goto(`${BASE}?debug`);
    await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await sleep(300);
  };
  /** From the title screen: pick options with real key presses, start with Space, and prepare a quiet, known field. */
  const begin = async (keys = []) => {
    for (const k of keys) { await page.keyboard.press(k); await sleep(60); }
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
    await sleep(400);
    await page.evaluate(`(() => { const a = window.__game.registry.get('audio'); const orig = a.sfx.handle.bind(a.sfx);
      window.__events = [];
      a.sfx.handle = (events) => { for (const e of events) window.__events.push(e); if (window.__events.length > 6000) window.__events.splice(0, 3000); orig(events); }; })()`);
    await quiet();
  };
  /** Stops asteroids and the UFO schedule, clears the field, and puts both ships at full health on their spawn points. */
  const quiet = () =>
    evalSim(`s.spawner.spawnTimer = -1e9; s.ufoSpawner.enabled = false; s.asteroids.length = 0; s.shots.length = 0; s.ufos.length = 0;
      s.ufoShots.length = 0; s.powerups.length = 0; s.lasers.length = 0; s.startCooldown = 0; s.combo.count = 0; s.combo.timer = 0; s.streakBanner = null;
      const full = s.config.livesMode === 'shared' ? 6 : 3; const spawns = [[320, 360], [960, 360]];
      s.players.forEach((p, i) => { p.lives = full; p.score = 0; p.shieldActive = false; p.isRespawning = false; p.rapidFire = { active: false, timer: 0 };
        p.multiShot = { active: false, timer: 0 }; p.megaPower = { active: false, timer: 0 }; p.boost = { active: false, timer: 0, cooldown: 0, keyHeld: false };
        p.laser.shotsRemaining = 15; p.laser.cooldown = 0; p.position.x = spawns[i][0]; p.position.y = spawns[i][1]; p.rotation = 0; p.velocity = { x: 0, y: 0 }; });`);
  const place = (n, x, y, rot = 0) => evalSim(`const p = s.players[${n - 1}]; p.position.x = ${x}; p.position.y = ${y}; p.rotation = ${rot}; p.velocity = { x: 0, y: 0 };`);
  const addRock = (x, y, radius = 20) =>
    page.evaluate(([x, y, radius]) => {
      window.__game.scene.getScene('GameScene').sim.asteroids.push({ position: { x, y }, velocity: { x: 0, y: 0 }, radius, archetype: 'standard',
        sizeCategory: radius >= 50 ? 'large' : radius >= 30 ? 'medium' : 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0,
        hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
    }, [x, y, radius]);
  const addShot = (owner, x, y, vx = 0, vy = 0) => evalSim(`s.shots.push({ position: { x: ${x}, y: ${y} }, velocity: { x: ${vx}, y: ${vy} }, radius: 5, owner: ${owner}, alive: true });`);
  const addPowerup = (type, x, y) =>
    evalSim(`s.powerups.push({ position: { x: ${x}, y: ${y} }, velocity: { x: 0, y: 0 }, radius: 15, type: '${type}', lifetime: 20, alive: true });`);
  const addUfo = (type, x, y, live = false) =>
    evalSim(`const u = s.spawnUfo('${type}', ${x}, ${y}); ${live ? '' : 'u.shootTimer = 1e9; u.movementTimer = -1e9; u.targetVelocity = { x: 0, y: 0 };'}`);
  /** Hits ship `n` with a rock until it is out of lives (removing protection each time). */
  const knockOut = async (n) => {
    for (let i = 0; i < 8; i++) {
      const st = await sim();
      const p = n === 1 ? st.p1 : st.p2;
      if (p.lives <= 0 || st.over) break;
      await evalSim(`const p = s.players[${n - 1}]; p.isRespawning = false; p.shieldActive = false;`);
      await addRock(n === 1 ? (await sim()).p1.x : (await sim()).p2.x, n === 1 ? (await sim()).p1.y : (await sim()).p2.y);
      await sleep(80);
    }
  };

  // =====================================================================================================================
  // Title screen: choosing the mode
  // =====================================================================================================================
  await title();
  // The title screen's pages are Phaser Texts inside a container: read every visible one, and ask the menu where its buttons are.
  const titleTexts = () =>
    page.evaluate(`(() => { const out = []; const walk = (list, visible) => { for (const c of list) { const v = visible && c.visible; if (c.type === 'Text' && v && c.text) out.push(c.text); if (c.list) walk(c.list, v); } }; walk(window.__game.scene.getScene('StartScene').children.list, true); return out; })()`);
  const menuItems = () => page.evaluate(`window.__game.scene.getScene('StartScene').menuSnapshot()`);
  const menuPage = async () => (await menuItems()).page;
  /** Moves the keyboard focus onto an item (Down, or Right along a row) and presses Enter, as a keyboard player would. */
  const openFromTitle = async (id) => {
    for (let i = 0; i < 16; i++) {
      const snap = await menuItems();
      const here = snap.items.find((x) => x.id === snap.focus);
      const there = snap.items.find((x) => x.id === id);
      if (here.id === id) break;
      const dy = there.y - here.y;
      await page.keyboard.press(Math.abs(dy) > 30 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : there.x > here.x ? 'ArrowRight' : 'ArrowLeft');
      await sleep(70);
    }
    await page.keyboard.press('Enter');
    await sleep(300);
  };
  let t = await titleTexts();
  let items = await menuItems();
  check('the title screen starts in one-player mode: how to play, the one-player legend, no co-op options', t.includes('HOW TO PLAY') && items.items.some((i) => i.label === 'PLAY') && !items.items.some((i) => i.label === 'CO-OP') && !t.some((x) => /FRIENDLY FIRE/.test(x)) && !t.includes('PLAYER 2') && !t.includes('REVIVE'), JSON.stringify({ t: t.slice(0, 8), items: items.items.map((i) => i.label) }));
  await page.keyboard.press('Digit2');
  await sleep(200);
  t = await titleTexts();
  items = await menuItems();
  check('pressing 2 shows the two-player title: both key sets, the lives and friendly-fire summary, a CO-OP button, Revive in the legend',
    t.includes('PLAYER 1') && t.includes('PLAYER 2') && t.some((x) => /OWN LIVES \(3 EACH\)\s+FRIENDLY FIRE ON/.test(x)) && t.includes('REVIVE') && items.items.some((i) => i.label === 'CO-OP') && t.includes('R-SHIFT'), JSON.stringify(t));
  await shot('menu-2p');
  await openFromTitle('coop');
  t = await titleTexts();
  check('the CO-OP page lists lives, friendly fire and both speeds', (await menuPage()) === 'coop' && ['LIVES  [L]', 'FRIENDLY FIRE  [F]', 'PLAYER 1 SPEED  [S]', 'PLAYER 2 SPEED  [D]'].every((x) => t.includes(x)) && t.includes('INDEPENDENT (3 EACH)'), JSON.stringify(t));
  await shot('menu-coop');
  await page.keyboard.press('Escape');
  await sleep(250);
  check('Escape returns to the title page with CO-OP still focused', (await menuPage()) === 'title' && (await menuItems()).focus === 'coop');
  await openFromTitle('controls');
  t = await titleTexts();
  check('the CONTROLS page offers Player 2\'s key layout in a two-player game', (await menuPage()) === 'controls' && t.includes('PLAYER 2 KEYS  [K]') && t.includes('ARROWS + ENTER') && t.includes('I J K L + ;'), JSON.stringify(t));
  await page.keyboard.press('Escape');
  await sleep(250);
  await page.keyboard.press('KeyL');
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyK');
  await page.keyboard.press('KeyS');
  await sleep(200);
  t = await titleTexts();
  check('L / F / K / S still change lives, friendly fire, Player 2 keys and the P1 speed from the title, and the screen shows it',
    t.some((x) => /^SHARED LIVES\s+FRIENDLY FIRE OFF\s+SPEED 125\/100%/.test(x)) && ['I', 'K', 'J', 'L', ';'].every((x) => t.includes(x)) && !t.includes('ENTER'), JSON.stringify(t.filter((x) => /LIVES|FIRE/.test(x))));
  await page.keyboard.press('Digit1');
  await sleep(150);
  t = await titleTexts();
  check('pressing 1 brings the one-player title back', t.includes('HOW TO PLAY') && !t.includes('PLAYER 2'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  let st = await sim();
  check('a one-player run started after choosing co-op options carries none of them (one ship, independent lives, no friendly fire)', st.count === 1 && !st.p2 && st.config.livesMode === 'independent' && st.config.friendlyFire === false && st.p1.lives === 3 && st.p1.speed === 1 && st.config.speed[0] === 1, JSON.stringify(st.config));
  let tx = await texts();
  check('one-player HUD is the classic one (P1, Lives, no P2 / OUT / SHARED)', tx.includes('P1: 0') && tx.includes('Lives: 3') && !tx.some((x) => /P2|OUT|SHARED/.test(x)), JSON.stringify(tx));

  // =====================================================================================================================
  // Two players, independent lives (the default two-player game)
  // =====================================================================================================================
  await title();
  await begin(['Digit2']);
  st = await sim();
  check('a two-player game starts: two ships on their spawn points, 3 lives each, independent lives, friendly fire on',
    st.count === 2 && near(st.p1.x, 320, 1) && near(st.p2.x, 960, 1) && st.p1.lives === 3 && st.p2.lives === 3 && st.config.livesMode === 'independent' && st.config.friendlyFire === true && st.shared === null, JSON.stringify({ p1: st.p1.x, p2: st.p2.x, config: st.config }));
  await sleep(300);
  let png = await pixels();
  const blue = [100, 200, 255], orange = [255, 200, 100];
  const c1 = { blue: countColor(png, 320, 360, 30, blue), orange: countColor(png, 320, 360, 30, orange) };
  const c2 = { blue: countColor(png, 960, 360, 30, blue), orange: countColor(png, 960, 360, 30, orange) };
  check('both ships render, each in its own colour (Player 1 blue, Player 2 orange)', c1.blue > 20 && c1.orange === 0 && c2.orange > 20 && c2.blue === 0, JSON.stringify({ c1, c2 }));
  tx = await textBoxes();
  const p1Text = tx.find((x) => x.text === 'P1: 0');
  const p2Text = tx.find((x) => x.text === 'P2: 0');
  check('the HUD shows each player in its own corner: P1 top left, P2 top right, a lives line for each', !!p1Text && !!p2Text && p1Text.x < 100 && p2Text.right > 1200 && tx.filter((x) => x.text === 'Lives: 3').length === 2, JSON.stringify(tx.map((x) => x.text)));
  await shot('game-2p');

  // --- independent movement with genuine keys --------------------------------------------------------------------------------
  const before = await sim();
  await page.keyboard.down('KeyW');
  await sleep(400);
  await page.keyboard.up('KeyW');
  let after = await sim();
  check('Player 1 (W) moves while Player 2 stays put', after.p1.y > before.p1.y + 60 && near(after.p2.y, before.p2.y, 0.5) && near(after.p2.x, before.p2.x, 0.5), JSON.stringify({ dy1: after.p1.y - before.p1.y, dy2: after.p2.y - before.p2.y }));
  await sleep(120); // let the last frame with the old key state finish before taking the reference
  const b2 = await sim();
  await page.keyboard.down('ArrowDown');
  await sleep(400);
  await page.keyboard.up('ArrowDown');
  after = await sim();
  check('Player 2 (arrow keys) moves while Player 1 stays put', after.p2.y < b2.p2.y - 60 && near(after.p1.y, b2.p1.y, 0.5), JSON.stringify({ dy2: after.p2.y - b2.p2.y }));
  await sleep(120);
  await quiet();
  const b3 = await sim();
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ArrowLeft');
  await sleep(300);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ArrowLeft');
  after = await sim();
  const turn1 = after.p1.rot - b3.p1.rot;
  const turn2 = ((after.p2.rot - b3.p2.rot + 540) % 360) - 180;
  check('both ships turn at once in opposite directions (D and Left)', turn1 > 60 && turn2 < -60, JSON.stringify({ turn1, turn2 }));

  // --- shooting: both, simultaneously, while moving -------------------------------------------------------------------------------
  await quiet();
  await clearEvents();
  await page.keyboard.down('Space');
  await page.keyboard.down('Enter');
  await sleep(120);
  st = await sim();
  check('both players can shoot at the same moment (Space + Enter): one shot each, owned correctly', st.shotOwners.includes(1) && st.shotOwners.includes(2), JSON.stringify(st.shotOwners));
  await sleep(1200);
  await page.keyboard.up('Space');
  await page.keyboard.up('Enter');
  const shots1 = await events('shot_fired', 'e.player === 1');
  const shots2 = await events('shot_fired', 'e.player === 2');
  check('holding the triggers keeps both firing on their own cooldowns (about 5 shots each in 1.3 s)', shots1 >= 4 && shots1 <= 6 && shots2 >= 4 && shots2 <= 6, JSON.stringify({ shots1, shots2 }));

  await quiet();
  await place(1, 150, 150, 0);
  await place(2, 1100, 560, 180);
  await clearEvents();
  const m1 = await sim();
  const sampler = page.evaluate(
    () =>
      new Promise((resolve) => {
        const sim = window.__game.scene.getScene('GameScene').sim;
        const last = sim.players.map((p) => ({ ...p.position }));
        const path = [0, 0];
        const start = performance.now();
        const tick = () => {
          sim.players.forEach((p, i) => { path[i] += Math.hypot(p.position.x - last[i].x, p.position.y - last[i].y); last[i] = { ...p.position }; });
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
          else resolve(path);
        };
        requestAnimationFrame(tick);
      }),
  );
  for (const k of ['KeyW', 'KeyD', 'Space', 'ArrowDown', 'ArrowLeft', 'Enter']) await page.keyboard.down(k);
  const [mv1, mv2] = await sampler;
  const m2 = await sim();
  for (const k of ['KeyW', 'KeyD', 'Space', 'ArrowDown', 'ArrowLeft', 'Enter']) await page.keyboard.up(k);
  const f1 = await events('shot_fired', 'e.player === 1');
  const f2 = await events('shot_fired', 'e.player === 2');
  // Holding forward and turn together makes a ship circle, so judge by the distance it travelled along the way, not net displacement
  // (turning itself is checked above; after a full second of turning the heading is back near where it started).
  check('both can turn, move and fire at once with 6 keys held (W+D+Space and Down+Left+Enter)', mv1 > 100 && mv2 > 100 && f1 >= 3 && f2 >= 3, JSON.stringify({ mv1: Math.round(mv1), mv2: Math.round(mv2), r1: Math.round(m2.p1.rot), r2: Math.round(m2.p2.rot), f1, f2 }));

  // --- Player 2's laser and boost keys, and the alternative layout is not active -------------------------------------------------
  await quiet();
  await clearEvents();
  await keyTap('ShiftRight');
  await keyTap('KeyE');
  await sleep(100);
  st = await sim();
  check('Right Shift fires Player 2\'s laser and E fires Player 1\'s; each spends only its own charge', st.p1.laser === 14 && st.p2.laser === 14 && (await events('laser_fired', 'e.player === 1')) === 1 && (await events('laser_fired', 'e.player === 2')) === 1, JSON.stringify({ l1: st.p1.laser, l2: st.p2.laser }));
  await sleep(1200);
  await keyTap('Period', 100);
  await sleep(100);
  st = await sim();
  check('"." boosts Player 2 only (Left Shift would boost Player 1)', st.p2.boost && !st.p1.boost);
  await sleep(3200);
  await keyTap('ShiftLeft', 100);
  await sleep(100);
  st = await sim();
  check('Left Shift boosts Player 1', st.p1.boost);
  await keyTap('KeyJ', 100);
  await keyTap('Semicolon', 100);
  st = await sim();
  check('the I J K L layout keys do nothing while the arrow layout is selected', st.p2.rot === 0 || near(st.p2.rot, 0, 0.001));

  // --- player-specific effects render ------------------------------------------------------------------------------------------
  await quiet();
  await evalSim(`s.players[1].shieldActive = true; s.players[0].rapidFire = { active: true, timer: 30 };`);
  await sleep(250);
  png = await pixels();
  const cyan = [0, 255, 255], yellow = [255, 255, 0];
  const shieldNearP2 = countColor(png, 960, 360, 45, cyan, 30);
  const shieldNearP1 = countColor(png, 320, 360, 45, cyan, 30);
  const yellowNearP1 = countColor(png, 320, 360, 30, yellow, 30);
  const yellowNearP2 = countColor(png, 960, 360, 30, yellow, 30);
  check('Player 2\'s shield ring is drawn around Player 2 only; Player 1\'s rapid-fire colour only on Player 1', shieldNearP2 > 20 && shieldNearP1 === 0 && yellowNearP1 > 15 && yellowNearP2 === 0, JSON.stringify({ shieldNearP2, shieldNearP1, yellowNearP1, yellowNearP2 }));
  tx = await textBoxes();
  const shieldRow = tx.find((x) => x.text === 'SHIELD: ACTIVE');
  const rapidRow = tx.find((x) => /^RAPID FIRE/.test(x.text));
  check('the HUD lists the power-ups under the right player (shield right, rapid fire left)', !!shieldRow && shieldRow.left > 900 && !!rapidRow && rapidRow.right < 400, JSON.stringify({ shield: shieldRow?.left, rapid: rapidRow?.right }));
  await shot('effects-2p');

  // --- scores and combos attributed --------------------------------------------------------------------------------------------
  await quiet();
  await addRock(150, 150);
  await addRock(300, 150);
  await addShot(2, 150, 150);
  await addShot(1, 300, 150);
  await sleep(150);
  st = await sim();
  tx = await texts();
  check('kills are paid to the shooter at the shared combo (first x1, second x1.5) and the HUD shows each score', st.p2.score === 50 && st.p1.score === 75 && tx.includes('P2: 50') && tx.includes('P1: 75'), JSON.stringify({ p1: st.p1.score, p2: st.p2.score }));
  check('the combo readout is at the bottom centre in two-player games', (await textBoxes()).some((x) => /2x COMBO/.test(x.text) && x.y > 560 && Math.abs(x.x - 640) < 10), JSON.stringify((await textBoxes()).filter((x) => /COMBO/.test(x.text))));

  // --- one player dies; the other plays on ---------------------------------------------------------------------------------------
  await quiet();
  await clearEvents();
  await knockOut(1);
  await sleep(150);
  st = await sim();
  tx = await texts();
  check('Player 1 loses all three lives: the run goes on, Player 1 is OUT in the HUD, a toast says so, Player 2 unaffected',
    st.p1.lives === 0 && !st.over && st.p2.lives === 3 && tx.includes('OUT') && tx.includes('PLAYER 1 IS OUT!') && (await events('player_eliminated', 'e.player === 1')) === 1, JSON.stringify({ lives: [st.p1.lives, st.p2.lives], over: st.over, tx }));
  check('an out player is not drawn and the HUD says what they need', (await texts()).includes('NEEDS A REVIVE'));
  png = await pixels();
  check('the eliminated ship is no longer on screen', countColor(png, st.p1.x, st.p1.y, 30, blue) === 0, '');
  await shot('p1-out');
  const y0 = (await sim()).p2.y;
  await page.keyboard.down('ArrowDown');
  await sleep(300);
  await page.keyboard.up('ArrowDown');
  check('the surviving player keeps full control', (await sim()).p2.y < y0 - 40);
  await clearEvents();
  const holdKeys = ['KeyW', 'Space', 'KeyE'];
  for (const k of holdKeys) await page.keyboard.down(k);
  await sleep(500);
  for (const k of holdKeys) await page.keyboard.up(k);
  check('the eliminated player\'s keys do nothing (no shots, no laser, no movement)', (await events('shot_fired', 'e.player === 1')) === 0 && (await events('laser_fired', 'e.player === 1')) === 0 && near((await sim()).p1.y, st.p1.y, 0.5));

  // --- Revive: it appears in real play, and collecting it brings the teammate back --------------------------------------------------
  await evalSim(`s.powerups.length = 0;`);
  let naturalRevive = false;
  for (let i = 0; i < 400 && !naturalRevive; i++) {
    await evalSim(`s.asteroids.push({ position: { x: 640, y: 120 }, velocity: { x: 0, y: 0 }, radius: 20, archetype: 'standard', sizeCategory: 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
      s.shots.push({ position: { x: 640, y: 120 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 2, alive: true });`);
    await sleep(40);
    naturalRevive = (await sim()).powerups.includes('revive');
  }
  st = await sim();
  tx = await texts();
  check('a Revive drops from ordinary asteroid kills while a player is out (found within 400 kills)', naturalRevive, '');
  check('...and the out player\'s HUD points at it', tx.includes('REVIVE ON FIELD!'), JSON.stringify(tx.filter((x) => /REVIVE/.test(x))));
  await evalSim(`s.powerups.length = 0; s.players[1].score = 250;`);
  await clearEvents();
  await addPowerup('revive', (await sim()).p2.x, (await sim()).p2.y);
  await sleep(200);
  st = await sim();
  tx = await texts();
  check('Player 2 collecting the Revive brings Player 1 back: 3 lives, own spawn point, protected, HUD updated, toast shown, nobody duplicated',
    st.p1.lives === 3 && near(st.p1.x, 320, 2) && st.p1.respawning && st.count === 2 && st.p2.score === 250 && tx.includes('Lives: 3') && tx.includes('PLAYER 1 IS BACK!') && !tx.includes('OUT') && (await events('player_revived', 'e.player === 1 && e.by === 2')) === 1 && st.powerups.length === 0, JSON.stringify({ p1: st.p1, tx: tx.filter((x) => /Lives|BACK|OUT/.test(x)) }));
  await sleep(100);
  png = await pixels();
  await shot('revived');
  check('the revived ship is back on screen', countColor(png, 320, 360, 30, [255, 255, 255], 40) + countColor(png, 320, 360, 30, [100, 100, 100], 40) + countColor(png, 320, 360, 30, blue) > 20);

  // --- friendly fire -------------------------------------------------------------------------------------------------------------
  await quiet();
  await addShot(1, 960, 360);
  await sleep(120);
  st = await sim();
  check('friendly fire (on by default): Player 1\'s shot costs Player 2 a life; no points, respawn at its own spawn', st.p2.lives === 2 && st.p1.lives === 3 && st.p1.score === 0, JSON.stringify({ l1: st.p1.lives, l2: st.p2.lives }));
  await quiet();
  await place(1, 200, 360, 270);
  await place(2, 800, 360, 90);
  await clearEvents();
  await keyTap('KeyE');
  await sleep(500);
  st = await sim();
  check('a Laser Beam across the screen hurts the other ship once and never its owner', st.p2.lives === 2 && st.p1.lives === 3 && (await events('player_hit', "e.source === 'friendly_laser'")) === 1, JSON.stringify({ l1: st.p1.lives, l2: st.p2.lives }));
  await quiet();
  await place(1, 200, 360, 270);
  await place(2, 800, 360, 90);
  await evalSim(`s.players[1].shieldActive = true;`);
  await clearEvents();
  await addShot(1, 800, 360);
  await sleep(120);
  st = await sim();
  check('a shield absorbs friendly fire: shield gone, no life lost', st.p2.lives === 3 && !st.p2.shield);

  // --- UFOs target the nearest eligible player ------------------------------------------------------------------------------------
  await quiet();
  const aim = async (ufoX, ufoY, setup = '') => {
    await quiet();
    if (setup) await evalSim(setup);
    await evalSim(`const u = s.spawnUfo('small', ${ufoX}, ${ufoY}); u.accuracy = 1; u.shootTimer = 0.05; u.movementTimer = -1e9; u.targetVelocity = { x: 0, y: 0 }; u.velocity = { x: 0, y: 0 };`);
    await sleep(160);
    const s2 = await sim();
    await evalSim(`s.ufos.length = 0; s.ufoShots.length = 0;`);
    return s2.ufoShots[0];
  };
  const toP1 = await aim(330, 100);
  const toP2 = await aim(950, 100);
  check('a UFO above Player 1 shoots at Player 1; one above Player 2 shoots at Player 2', !!toP1 && !!toP2 && Math.abs(toP1.vx) < 60 && toP1.vy > 300 && Math.abs(toP2.vx) < 60 && toP2.vy > 300, JSON.stringify({ toP1, toP2 }));
  const only2 = await aim(330, 100, `s.players[0].lives = 0;`);
  check('with Player 1 out, a UFO over their position shoots at the living Player 2 instead (aims right)', !!only2 && only2.vx > 150, JSON.stringify(only2));

  // --- pause and resume with both players ------------------------------------------------------------------------------------------
  await quiet();
  await clearEvents();
  for (const k of ['KeyW', 'ArrowDown']) await page.keyboard.down(k);
  await sleep(200);
  await page.keyboard.press('KeyP');
  await sleep(150);
  const p0 = await sim();
  await sleep(500);
  const p1s = await sim();
  check('paused: neither ship moves although both movement keys are held', p0.paused && p1s.paused && near(p0.p1.y, p1s.p1.y, 0.01) && near(p0.p2.y, p1s.p2.y, 0.01) && near(p0.time, p1s.time, 0.001));
  await page.keyboard.press('KeyP');
  await sleep(300);
  const p2s = await sim();
  for (const k of ['KeyW', 'ArrowDown']) await page.keyboard.up(k);
  check('resumed: both ships carry on moving with the held keys (no re-press needed)', !p2s.paused && p2s.p1.y > p1s.p1.y + 30 && p2s.p2.y < p1s.p2.y - 30, JSON.stringify({ d1: p2s.p1.y - p1s.p1.y, d2: p2s.p2.y - p1s.p2.y }));
  await quiet();
  await clearEvents();
  await page.keyboard.down('KeyE');
  await page.keyboard.down('ShiftRight');
  await sleep(150); // each fires once as it is pressed
  await page.keyboard.press('KeyP');
  await sleep(100);
  await page.keyboard.press('KeyP');
  await sleep(300);
  await page.keyboard.up('KeyE');
  await page.keyboard.up('ShiftRight');
  check('laser keys held down across pause / resume fire once each when pressed and never again on resume', (await events('laser_fired')) === 2, String(await events('laser_fired')));
  await quiet();
  await clearEvents();
  await page.keyboard.press('KeyP');
  await sleep(100);
  await page.keyboard.down('KeyE');
  await page.keyboard.down('ShiftRight');
  await sleep(100);
  await page.keyboard.press('KeyP');
  await sleep(300);
  check('laser keys pressed while paused do not fire when play resumes', (await events('laser_fired')) === 0, String(await events('laser_fired')));
  await page.keyboard.up('KeyE');
  await page.keyboard.up('ShiftRight');
  await clearEvents();
  for (const k of ['KeyW', 'ArrowUp']) await page.keyboard.down(k);
  await sleep(100);
  await page.evaluate(`window.dispatchEvent(new Event('blur'))`);
  await sleep(150);
  const bl = await page.evaluate(`({ held: [...window.__game.registry.get('heldKeys').snapshot()], paused: ${S}.paused })`);
  for (const k of ['KeyW', 'ArrowUp']) await page.keyboard.up(k);
  check('window blur clears both players\' keys and pauses', bl.held.length === 0 && bl.paused, JSON.stringify(bl));
  await page.keyboard.press('KeyP');

  // --- game over: both eliminated ---------------------------------------------------------------------------------------------------
  await quiet();
  await evalSim(`s.players[0].score = 120; s.players[1].score = 340;`);
  await knockOut(1);
  await knockOut(2);
  await sleep(300);
  st = await sim();
  tx = await texts();
  check('both players out: GAME OVER with each score, the team total and the reason', st.over && st.reason === 'all_eliminated' && tx.includes('GAME OVER') && tx.includes('Player 1: 120') && tx.includes('Player 2: 340') && tx.includes('TEAM TOTAL: 460') && tx.includes('BOTH PLAYERS ARE ELIMINATED'), JSON.stringify(tx));
  await shot('game-over-2p');
  await page.waitForFunction(`${S}.sim.retryDelay <= 0`, null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(300);
  check('Enter (Player 2\'s fire key) does not retry a two-player game', (await sim()).over);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => !window.__game.scene.getScene('GameScene').sim.isGameOver, null, { timeout: 3000 }).catch(() => {});
  await sleep(300);
  st = await sim();
  check('R restarts both players cleanly: 3 lives, zero scores, nothing left over from the last run', !st.over && st.count === 2 && st.p1.lives === 3 && st.p2.lives === 3 && st.p1.score === 0 && st.p2.score === 0 && st.shots === 0 && st.lasers === 0 && st.combo === 0 && st.ufoShots.length === 0, JSON.stringify({ shots: st.shots, over: st.over }));

  // =====================================================================================================================
  // Shared lives
  // =====================================================================================================================
  await title();
  await begin(['Digit2', 'KeyL']);
  st = await sim();
  tx = await texts();
  check('shared lives: one pool of 6 shown for the team, no per-player lives line', st.shared === 6 && tx.includes('SHARED LIVES: 6') && !tx.some((x) => /^Lives:/.test(x)), JSON.stringify(tx));
  await evalSim(`s.players[1].isRespawning = false;`);
  await addRock((await sim()).p2.x, (await sim()).p2.y);
  await sleep(150);
  st = await sim();
  check('Player 2 being hit costs the team a life: both ships show 5, the pool is 5', st.shared === 5 && st.p1.lives === 5 && st.p2.lives === 5 && (await texts()).includes('SHARED LIVES: 5'));
  await evalSim(`s.players[0].isRespawning = false; s.players[1].isRespawning = false; s.players[0].lives = 1; s.players[1].lives = 1;`);
  await addRock((await sim()).p1.x, (await sim()).p1.y);
  await sleep(200);
  st = await sim();
  tx = await texts();
  check('the pool running out ends the run for both, with the shared-lives reason', st.over && st.reason === 'shared_lives_exhausted' && tx.includes('THE SHARED LIVES ARE ALL USED UP'), JSON.stringify({ over: st.over, reason: st.reason }));
  await shot('game-over-shared');

  // =====================================================================================================================
  // Friendly fire off, handicap, alternative keys, and going back to one player through the menu
  // =====================================================================================================================
  await title();
  await begin(['Digit2', 'KeyF', 'KeyK', 'KeyD']);
  st = await sim();
  check('menu options reach the game: friendly fire off, Player 2 speed 125 %', st.config.friendlyFire === false && st.p2.speed === 1.25 && st.p1.speed === 1, JSON.stringify(st.config));
  await addShot(1, 960, 360);
  await sleep(120);
  check('friendly fire off: the other ship is not hurt and the shot flies on', (await sim()).p2.lives === 3);
  await quiet();
  await clearEvents();
  const k0 = await sim();
  await page.keyboard.down('KeyI');
  await page.keyboard.down('Semicolon');
  await sleep(300);
  await page.keyboard.up('KeyI');
  await page.keyboard.up('Semicolon');
  const kMid = await sim();
  await page.keyboard.down('KeyL');
  await sleep(250);
  await page.keyboard.up('KeyL');
  const k1 = await sim();
  check('with the I J K L layout, I moves / L turns / ; fires Player 2, and Player 1 is untouched', kMid.p2.y > k0.p2.y + 60 && k1.p2.rot > kMid.p2.rot + 30 && (await events('shot_fired', 'e.player === 2')) >= 1 && near(k1.p1.y, k0.p1.y, 0.5), JSON.stringify({ dy: kMid.p2.y - k0.p2.y, turn: k1.p2.rot - kMid.p2.rot }));
  const a0 = await sim();
  await page.keyboard.down('ArrowUp');
  await sleep(250);
  await page.keyboard.up('ArrowUp');
  const a1 = await sim();
  check('...the arrow keys do nothing for either ship', near(a1.p2.y, a0.p2.y, 0.5) && near(a1.p2.x, a0.p2.x, 0.5) && near(a1.p1.y, a0.p1.y, 0.5));
  // Speed handicap: the 125 % ship covers more ground than the 100 % ship in the same time.
  await quiet();
  await place(1, 300, 100, 0);
  await place(2, 900, 100, 0);
  await evalSim(`s.players[0].rotation = 0; s.players[1].rotation = 0;`);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyI');
  await sleep(150); // both keys are registered before measuring
  const [d1, d2] = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const sim = window.__game.scene.getScene('GameScene').sim;
        const last = sim.players.map((p) => ({ ...p.position }));
        const path = [0, 0];
        const start = performance.now();
        const tick = () => {
          sim.players.forEach((p, i) => { path[i] += Math.hypot(p.position.x - last[i].x, p.position.y - last[i].y); last[i] = { ...p.position }; });
          if (performance.now() - start < 300) requestAnimationFrame(tick);
          else resolve(path);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyI');
  check('the speed handicap is per player: the 125 % ship moves 25 % further than the 100 % one', d1 > 40 && Math.abs(d2 / d1 - 1.25) < 0.12, JSON.stringify({ d1: Math.round(d1), d2: Math.round(d2) }));

  // Back to one player through the menu: no co-op state survives.
  await page.keyboard.press('KeyP');
  await sleep(100);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  await sleep(300);
  await page.keyboard.press('Digit1');
  await sleep(100);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(400);
  st = await sim();
  tx = await texts();
  const probeY = st.p1.y;
  await page.keyboard.down('ArrowDown');
  await sleep(250);
  await page.keyboard.up('ArrowDown');
  const oneP = await sim();
  check('back to one player via the menu: one ship at the centre, 3 lives, classic HUD, arrow keys steer it again, combo HUD where it always was',
    st.count === 1 && !st.p2 && near(st.p1.x, 640, 1) && tx.includes('P1: 0') && tx.includes('Lives: 3') && !tx.some((x) => /P2|OUT|SHARED/.test(x)) && oneP.p1.y < probeY - 30 && st.config.friendlyFire === false && st.config.livesMode === 'independent' && st.p1.speed === 1, JSON.stringify({ count: st.count, tx }));
  await page.evaluate(`(() => { const s = ${S}.sim; s.player.lives = 1; s.player.isRespawning = false; s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 20, archetype: 'standard', sizeCategory: 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
  await page.waitForFunction(`${S}.sim.isGameOver && ${S}.sim.retryDelay <= 0`, null, { timeout: 8000 }).catch(() => {});
  tx = await texts();
  check('one-player game over is the classic screen: Player 1 score only, no team total', tx.includes('GAME OVER') && tx.some((x) => /^Player 1:/.test(x)) && !tx.some((x) => /Player 2|TEAM TOTAL|ELIMINATED/.test(x)), JSON.stringify(tx));
  await page.keyboard.press('Enter');
  await sleep(500);
  check('Enter still retries a one-player game', !(await sim()).over);

  // =====================================================================================================================
  // ?keydebug with two players
  // =====================================================================================================================
  await page.goto(`${BASE}?debug&keydebug`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await page.keyboard.press('Digit2');
  await sleep(100);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('Enter');
  await sleep(500);
  const panel = await page.evaluate(`document.querySelector('[data-keydebug] pre')?.textContent ?? ''`);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('Enter');
  check('?keydebug shows both players\' input and a clean verdict', /3 GameSim input P1: rotate=0 move=1/.test(panel) && /3 GameSim input P2: rotate=0 move=1 shoot=1/.test(panel) && /4 sim P2/.test(panel) && /verdict: OK/.test(panel), panel.split('\n').filter((l) => /^3|verdict/.test(l)).join(' | '));

  // =====================================================================================================================
  // Stress: prolonged two-player combat, bounded resources
  // =====================================================================================================================
  await title();
  await begin(['Digit2']);
  const base = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden'), children: ${S}.children.list.length, heap: performance.memory?.usedJSHeapSize ?? 0 })`);
  await evalSim(`s.spawner.spawnTimer = 0; s.asteroidSpawnRate = 0.12; s.ufoSpawner.enabled = true; s.ufoSpawner.nextSpawnTime = 0;
    for (const p of s.players) { p.rapidFire = { active: true, timer: 1e9 }; p.multiShot = { active: true, timer: 1e9 }; p.shieldActive = true; }
    s.players[1].lives = 0;`); // Player 2 starts out, to be revived mid-run
  await clearEvents();
  const stress = page.evaluate(
    () =>
      new Promise((resolve) => {
        const scene = window.__game.scene.getScene('GameScene');
        const sim = scene.sim;
        const times = [];
        const peak = { shots: 0, ufoShots: 0, lasers: 0, particles: 0, powerups: 0, ufos: 0, sounds: 0, asteroids: 0 };
        let revived = false;
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          for (const p of sim.players) if (p.lives > 0) { p.shieldActive = true; p.isRespawning = false; }
          peak.shots = Math.max(peak.shots, sim.shots.length);
          peak.ufoShots = Math.max(peak.ufoShots, sim.ufoShots.length);
          peak.lasers = Math.max(peak.lasers, sim.lasers.length);
          peak.particles = Math.max(peak.particles, sim.particles.activeCount);
          peak.powerups = Math.max(peak.powerups, sim.powerups.length);
          peak.ufos = Math.max(peak.ufos, sim.ufos.length);
          peak.asteroids = Math.max(peak.asteroids, sim.asteroids.length);
          peak.sounds = Math.max(peak.sounds, window.__game.sound.sounds.length);
          if (!revived && now - start > 4000) { sim.powerups.push({ position: { ...sim.player.position }, velocity: { x: 0, y: 0 }, radius: 15, type: 'revive', lifetime: 20, alive: true }); revived = true; }
          if (now - start < 9000) requestAnimationFrame(tick);
          else resolve({ times, peak, revived });
        };
        requestAnimationFrame(tick);
      }),
  );
  // Both players hold everything down: movement, fire, and tap the laser / boost keys over and over.
  const hold = ['KeyD', 'Space', 'ArrowLeft', 'Enter'];
  for (const k of hold) await page.keyboard.down(k);
  const tapper = (async () => {
    for (let i = 0; i < 16; i++) {
      await keyTap(['KeyE', 'ShiftRight', 'ShiftLeft', 'Period'][i % 4], 40);
      await sleep(450);
    }
  })();
  const result = await stress;
  await tapper;
  for (const k of hold) await page.keyboard.up(k);
  const sorted = [...result.times].sort((x, y) => x - y);
  const avg = result.times.reduce((x, y) => x + y, 0) / result.times.length;
  console.log(`INFO  two-player stress, 9 s: avg frame ${avg.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms; peaks ${JSON.stringify(result.peak)}`);
  check('two-player stress (rapid + multi-shot, shields, two UFOs, lasers, boost, fast asteroids) stays smooth', avg < 25, `avg=${avg.toFixed(1)}`);
  check('shots, enemy shots, lasers, pickups, UFOs, particles and sound objects stay bounded', result.peak.shots < 120 && result.peak.ufoShots < 40 && result.peak.lasers < 10 && result.peak.powerups < 30 && result.peak.ufos <= 2 && result.peak.particles <= 500 && result.peak.sounds < 40, JSON.stringify(result.peak));
  st = await sim();
  const revivesDuringStress = await events('player_revived', 'e.player === 2 && e.by === 1');
  check('the downed player was revived during the stress run (and nobody was duplicated)', revivesDuringStress >= 1 && st.count === 2, JSON.stringify({ revives: revivesDuringStress, l2: st.p2.lives }));
  const heapAfter = await page.evaluate(`performance.memory?.usedJSHeapSize ?? 0`);
  console.log(`INFO  JS heap ${(base.heap / 1e6).toFixed(1)} MB before, ${(heapAfter / 1e6).toFixed(1)} MB after the stress run (GC timing makes this indicative only)`);

  // Three game-over -> restart cycles with both players' effects live: nothing accumulates.
  for (let round = 1; round <= 3; round++) {
    await evalSim(`s.ufoSpawner.enabled = false; s.powerups.length = 0; s.asteroids.length = 0; for (const p of s.players) { p.shieldActive = false; p.isRespawning = false; p.boost.active = false; p.megaPower = { active: false, timer: 0 }; p.lives = 1; p.position.x = p === s.player ? 320 : 960; p.position.y = 360; }
      s.lasers.push({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, direction: 0, owner: 1, timer: 0, lifetime: 0.3, hit: new Set() });
      s.asteroids.push(...s.players.map((p) => ({ position: { x: p.position.x, y: p.position.y }, velocity: { x: 0, y: 0 }, radius: 20, archetype: 'standard', sizeCategory: 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true })));`);
    await page.waitForFunction(`${S}.sim.isGameOver`, null, { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(`${S}.sim.retryDelay <= 0`, null, { timeout: 8000 }).catch(() => {}); // simulated time: slower than the wall clock under load
    await page.keyboard.press('KeyR');
    await sleep(500);
    st = await sim();
    check(`restart #${round}: both players fresh, no shots / lasers / UFOs / pickups / combo carried over`, !st.over && st.count === 2 && st.p1.lives === 3 && st.p2.lives === 3 && st.shots === 0 && st.lasers === 0 && st.ufos === 0 && st.powerups.length === 0 && st.combo === 0 && st.ufoShots.length === 0 && !st.p1.shield && !st.p1.rapid, JSON.stringify({ over: st.over, count: st.count, p1: st.p1, p2: st.p2, shots: st.shots, lasers: st.lasers, ufos: st.ufos, powerups: st.powerups, combo: st.combo, ufoShots: st.ufoShots.length, time: st.time }));
  }
  const end = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden'), children: ${S}.children.list.length, music: window.__game.sound.sounds.filter((s) => s.key.startsWith('music')).length })`);
  check('no listener or display-object build-up after the restarts, and still one music instance', end.blur === base.blur && end.hidden === base.hidden && end.children === base.children && end.music === 1, JSON.stringify({ base, end }));

  check('no console errors, page errors or failed requests', problems.length === 0, problems.slice(0, 3).join(' | '));
}
