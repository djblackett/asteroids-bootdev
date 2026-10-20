// Browser test for gamepad support: drives the production build in a real (headless) Chrome with genuine key events for the
// keyboard player and a SIMULATED Gamepad API for the controller (an init script replaces navigator.getGamepads with a
// provider the test controls). The game cannot tell it from a real controller, but this is NOT a real-hardware test: it proves
// the wiring (detection, assignment, hot-plug, focus, pause, restart, both players at once), not the feel of a physical pad.
//
//   npm run test:gamepad          (builds first)
//   CHROME_PATH=/path/to/chrome node scripts/gamepad.mjs     (reuse an existing build in dist/)
//
// Screenshots go to scripts/.smoke-output/ (git-ignored). Software WebGL (SwiftShader) in headless Chrome only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.GAMEPAD_PORT ?? 4400);
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

/** Standard-mapping button indices. */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const XBOX = 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)';
const PS = '054c-09cc-Wireless Controller';

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
console.log(`\n${total - failures}/${total} checks passed  (Chromium ${browserVersion}, headless, SIMULATED gamepad provider, software WebGL; no real controller, Firefox or Safari)`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  // The simulated Gamepad API: navigator.getGamepads() returns fresh snapshot objects of whatever the test has put in a slot,
  // exactly the shape a browser returns (index, id, mapping, connected, axes[], buttons[{pressed, touched, value}]).
  await page.addInitScript(() => {
    const slots = [null, null, null, null];
    window.__pads = {
      slots,
      put(index, spec = {}) {
        const mapping = spec.mapping ?? 'standard';
        const axes = Array.from({ length: spec.axisCount ?? (mapping === 'standard' ? 4 : 6) }, (_, i) => spec.axes?.[i] ?? 0);
        const buttons = Array.from({ length: 17 }, (_, i) => spec.buttons?.[i] ?? 0);
        slots[index] = { index, id: spec.id ?? 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping, axes, buttons };
      },
      remove(index) {
        slots[index] = null;
      },
    };
    navigator.getGamepads = () =>
      slots.map((p) =>
        p
          ? {
              index: p.index,
              id: p.id,
              mapping: p.mapping,
              connected: true,
              timestamp: performance.now(),
              axes: [...p.axes],
              buttons: p.buttons.map((v) => ({ pressed: v >= 0.5, touched: v > 0, value: v })),
            }
          : null,
      );
  });

  const S = `window.__game.scene.getScene('GameScene')`;
  const T = `window.__game.scene.getScene('StartScene')`;
  const HUB = `window.__game.registry.get('gamepadHub')`;
  const shot = (name) => page.screenshot({ path: path.join(outDir, `gamepad-${name}.png`) });
  const evalSim = (body) => page.evaluate(`(() => { const s = ${S}.sim; ${body} })()`);
  const sim = () =>
    page.evaluate(`(() => { const s = ${S}.sim; const pl = (p) => p && ({ n: p.playerNumber, x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, score: p.score,
        boost: p.boost.active, laser: p.laser.shotsRemaining, shield: p.shieldActive, respawning: p.isRespawning });
      return { time: s.time, over: s.isGameOver, count: s.players.length, p1: pl(s.player), p2: pl(s.player2), shots: s.shots.length,
        shotOwners: s.shots.map((x) => x.owner), asteroids: s.asteroids.length, retry: s.retryDelay, paused: ${S}.paused, config: s.config }; })()`);
  const VISIBLE = (scene) => `${scene}.children.list.flatMap((c) => (c.type === 'Container' ? (c.visible ? c.list : []) : [c])).filter((c) => c.type === 'Text' && c.visible && c.text !== '')`;
  const texts = (scene = S) => page.evaluate(`${VISIBLE(scene)}.map((t) => t.text)`);
  const events = (type, pred = 'true') => page.evaluate(`window.__events.filter((e) => e.type === '${type}' && (${pred})).length`);
  const clearEvents = () => page.evaluate('window.__events.length = 0');
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const padPut = (index, spec = {}) => page.evaluate(([i, s]) => window.__pads.put(i, s), [index, spec]);
  const padRemove = (index) => page.evaluate((i) => window.__pads.remove(i), index);
  const padEvent = (type) => page.evaluate((t) => window.dispatchEvent(new Event(t)), type);
  /** A genuine press: the button goes down for `ms` and up again, as a thumb would do it. */
  const padTap = async (index, button, ms = 140, base = {}) => {
    await padPut(index, { ...base, buttons: { ...(base.buttons ?? {}), [button]: 1 } });
    await sleep(ms);
    await padPut(index, base);
    await sleep(100);
  };
  const hub = () =>
    page.evaluate(`(() => { const h = ${HUB}; return { pads: h.pads().map((p) => ({ index: p.index, name: p.name, layout: p.layout, armed: p.armed })),
      p1: h.padFor(0, 2)?.index ?? null, p2: h.padFor(1, 2)?.index ?? null, solo: h.padFor(0, 1)?.index ?? null, listeners: h.listenerCount, log: [...h.eventLog()] }; })()`);

  /** Fresh page at the title screen. */
  const title = async (query = '') => {
    await page.evaluate(() => window.__pads?.slots.fill(null)).catch(() => {});
    await page.goto(`${BASE}?debug${query}`);
    await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await sleep(300);
  };
  /** From the title screen: start with Space and prepare a quiet, known field with both ships on their spawn points. */
  const begin = async (via = 'Space') => {
    if (via === 'Space') await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
    await sleep(400);
    await page.evaluate(`(() => { const a = window.__game.registry.get('audio'); const orig = a.sfx.handle.bind(a.sfx);
      window.__events = [];
      a.sfx.handle = (events) => { for (const e of events) window.__events.push(e); if (window.__events.length > 6000) window.__events.splice(0, 3000); orig(events); }; })()`);
    await quiet();
  };
  const quiet = () =>
    evalSim(`s.spawner.spawnTimer = -1e9; s.ufoSpawner.enabled = false; s.asteroids.length = 0; s.shots.length = 0; s.ufos.length = 0;
      s.ufoShots.length = 0; s.powerups.length = 0; s.lasers.length = 0; s.startCooldown = 0; s.combo.count = 0; s.combo.timer = 0; s.streakBanner = null;
      const full = s.config.livesMode === 'shared' ? 6 : 3; const spawns = s.players.length === 1 ? [[640, 360]] : [[320, 360], [960, 360]];
      s.players.forEach((p, i) => { p.lives = full; p.score = 0; p.shieldActive = false; p.isRespawning = false; p.rapidFire = { active: false, timer: 0 };
        p.multiShot = { active: false, timer: 0 }; p.megaPower = { active: false, timer: 0 }; p.boost = { active: false, timer: 0, cooldown: 0, keyHeld: false };
        p.laser.shotsRemaining = 15; p.laser.cooldown = 0; p.position.x = spawns[i][0]; p.position.y = spawns[i][1]; p.rotation = 0; p.velocity = { x: 0, y: 0 }; });`);
  const addRock = (x, y, radius = 20) =>
    page.evaluate(([x, y, radius]) => {
      window.__game.scene.getScene('GameScene').sim.asteroids.push({ position: { x, y }, velocity: { x: 0, y: 0 }, radius, archetype: 'standard',
        sizeCategory: radius >= 50 ? 'large' : radius >= 30 ? 'medium' : 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0,
        hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
    }, [x, y, radius]);
  const knockOut = async (n) => {
    for (let i = 0; i < 8; i++) {
      const st = await sim();
      const p = n === 1 ? st.p1 : st.p2;
      if (p.lives <= 0 || st.over) break;
      await evalSim(`const p = s.players[${n - 1}]; p.isRespawning = false; p.shieldActive = false;`);
      await addRock(p.x, p.y);
      await sleep(80);
    }
  };

  // =====================================================================================================================
  // 1. Keyboard-only: no controller, nothing changes
  // =====================================================================================================================
  await title();
  let t = await texts(T);
  check('with no controller the title screen says so, and offers the layout screen', t.some((x) => /No controller detected/.test(x)) && t.some((x) => /C: controller layout/.test(x)), JSON.stringify(t.filter((x) => /ontroller/.test(x))));
  check('the start prompt is the keyboard one when no controller is assigned', t.includes('Press SPACE or click to start'));
  await shot('title-no-pad');
  await page.keyboard.press('Digit2');
  await begin();
  let st = await sim();
  check('a keyboard-only two-player game starts normally (no controller involved)', st.count === 2 && st.p1.lives === 3 && st.p2.lives === 3);
  let b0 = await sim();
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowDown');
  await sleep(400);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowDown');
  st = await sim();
  check('keyboard-only co-op still moves both ships from the two key sets', st.p1.y > b0.p1.y + 60 && st.p2.y < b0.p2.y - 60, JSON.stringify({ d1: st.p1.y - b0.p1.y, d2: st.p2.y - b0.p2.y }));
  await clearEvents();
  await page.keyboard.down('Space');
  await page.keyboard.down('Enter');
  await sleep(700);
  await page.keyboard.up('Space');
  await page.keyboard.up('Enter');
  check('keyboard-only co-op still shoots for both players', (await events('shot_fired', 'e.player === 1')) >= 2 && (await events('shot_fired', 'e.player === 2')) >= 2);
  let h = await hub();
  check('no controller means no controller state: no pads, hub listener only for the running scene', h.pads.length === 0 && h.listeners === 1, JSON.stringify(h));

  // =====================================================================================================================
  // 2. Title screen: detection, assignment, the layout screen
  // =====================================================================================================================
  await title();
  // A controller that was already plugged in when the page loaded is only reported after a button press (browser rule): the wake-up press is still down.
  await padPut(0, { buttons: { [BTN.A]: 1 } });
  await padEvent('gamepadconnected');
  await sleep(250);
  t = await texts(T);
  check('a simulated controller is detected and listed as not assigned', t.some((x) => /Controller 1: Xbox 360 Controller -> not assigned/.test(x)), JSON.stringify(t.filter((x) => /ontroller/.test(x))));
  await padPut(0, {});
  await sleep(150);
  await padTap(0, BTN.RT); // not a join button
  t = await texts(T);
  check('only A / START join: other buttons (RT) leave it unassigned', t.some((x) => /not assigned/.test(x)));
  await padTap(0, BTN.A);
  t = await texts(T);
  check('A on an unassigned pad assigns it (one-player: Player 1) and the prompt mentions A', t.some((x) => /Controller 1: .* -> PLAYER 1/.test(x)) && t.includes('Press SPACE, click or A to start'), JSON.stringify(t.filter((x) => /ontroller|Press/.test(x))));
  await page.keyboard.press('Digit2');
  await sleep(200);
  t = await texts(T);
  check('choosing two players moves a pad that joined automatically to Player 2 (keyboard stays Player 1)', t.some((x) => /-> PLAYER 2/.test(x)), JSON.stringify(t.filter((x) => /ontroller/.test(x))));
  check('the two-player page marks which player has the controller (PLAYER 2 + CONTROLLER; Player 1 stays keyboard-only)', t.includes('PLAYER 2  + CONTROLLER') && t.includes('PLAYER 1'), JSON.stringify(t.filter((x) => /^PLAYER/.test(x))));
  await shot('title-pad-p2');
  await padTap(0, BTN.LB);
  t = await texts(T);
  check('LB gives the pad to Player 1', t.some((x) => /-> PLAYER 1/.test(x)) && (await hub()).p1 === 0);
  await padTap(0, BTN.RB);
  t = await texts(T);
  check('RB gives it to Player 2', t.some((x) => /-> PLAYER 2/.test(x)) && (await hub()).p2 === 0);
  await page.keyboard.press('KeyG');
  await sleep(150);
  t = await texts(T);
  check('G cycles the controller (Player 2 -> Player 1 -> none) from the keyboard', t.some((x) => /-> PLAYER 1/.test(x)));
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyG');
  await sleep(150);
  t = await texts(T);
  check('...and round to Player 2 again', t.some((x) => /-> PLAYER 2/.test(x)));
  await page.keyboard.press('KeyC');
  await sleep(200);
  t = await texts(T);
  check('C shows the controller layout: sticks, triggers, X laser, B boost, START pause', t.includes('CONTROLLER LAYOUT') && t.some((x) => /RT or A/.test(x)) && t.some((x) => /X  -  Laser Beam/.test(x)) && t.some((x) => /START/.test(x)), JSON.stringify(t.slice(0, 12)));
  await shot('layout');
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Esc closes the layout screen', !(await texts(T)).includes('CONTROLLER LAYOUT'));
  await padTap(0, BTN.Y);
  check('Y on the controller opens it too', (await texts(T)).includes('CONTROLLER LAYOUT'));
  await padTap(0, BTN.B);
  check('and B closes it', !(await texts(T)).includes('CONTROLLER LAYOUT'));

  // =====================================================================================================================
  // 3. Keyboard Player 1 + controller Player 2, playing together
  // =====================================================================================================================
  await title();
  await padPut(0, {});
  await page.keyboard.press('Digit2');
  await sleep(300);
  await padTap(0, BTN.A); // joins -> Player 2 in a two-player game
  check('in a two-player game the first A joins the controller as Player 2', (await hub()).p2 === 0 && (await hub()).p1 === null);
  await begin();
  st = await sim();
  check('Keyboard (P1) + gamepad (P2) game starts with two ships', st.count === 2);

  b0 = await sim();
  await padPut(0, { axes: { 1: -1 } });
  await sleep(450);
  await padPut(0, {});
  st = await sim();
  check('the controller stick (up) moves Player 2 while Player 1 stays put', near(st.p1.y, b0.p1.y, 0.5) && Math.abs(st.p2.y - b0.p2.y) > 50, JSON.stringify({ d1: st.p1.y - b0.p1.y, d2: st.p2.y - b0.p2.y }));
  await sleep(150);
  await quiet();
  b0 = await sim();
  await page.keyboard.down('KeyW');
  await sleep(450);
  await page.keyboard.up('KeyW');
  st = await sim();
  check('the keyboard (W) moves Player 1 while Player 2 stays put', Math.abs(st.p1.y - b0.p1.y) > 50 && near(st.p2.y, b0.p2.y, 0.5), JSON.stringify({ d1: st.p1.y - b0.p1.y, d2: st.p2.y - b0.p2.y }));

  // --- simultaneous movement, rotation and fire ---------------------------------------------------------------------------
  await sleep(150);
  await quiet();
  await clearEvents();
  b0 = await sim();
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await padPut(0, { axes: { 0: -1, 1: -1 }, buttons: { [BTN.RT]: 1 } });
  await sleep(350);
  const mid = await sim();
  await sleep(550);
  await padPut(0, {});
  for (const k of ['KeyD', 'KeyW', 'Space']) await page.keyboard.up(k);
  const turn1 = mid.p1.rot - b0.p1.rot;
  const turn2m = (((mid.p2.rot - b0.p2.rot + 540) % 360) - 180);
  check('both turn in opposite directions at once (keyboard D, stick left)', turn1 > 60 && turn2m < -60, JSON.stringify({ t1: turn1, t2: turn2m }));
  const f1 = await events('shot_fired', 'e.player === 1');
  const f2 = await events('shot_fired', 'e.player === 2');
  check('both keep firing while moving: Space for Player 1, the right trigger for Player 2', f1 >= 2 && f2 >= 2, JSON.stringify({ f1, f2 }));
  check('every shot is owned by the player whose device fired it', (await page.evaluate(`window.__events.filter((e) => e.type === 'shot_fired').every((e) => e.player === 1 || e.player === 2)`)));

  // --- trigger semantics: hold = continuous fire, light pull = nothing, A also shoots -------------------------------------------
  await sleep(150);
  await quiet();
  await clearEvents();
  await padPut(0, { buttons: { [BTN.RT]: 0.3 } });
  await sleep(500);
  check('a light trigger pull (0.3) does not shoot', (await events('shot_fired', 'e.player === 2')) === 0);
  await padPut(0, { buttons: { [BTN.RT]: 0.8 } });
  await sleep(1300);
  await padPut(0, {});
  const held = await events('shot_fired', 'e.player === 2');
  check('holding the trigger at 0.8 fires continuously on the normal cadence (about 5 shots in 1.3 s)', held >= 3 && held <= 6, String(held));
  await sleep(100);
  await clearEvents();
  await padPut(0, { buttons: { [BTN.A]: 1 } });
  await sleep(500);
  await padPut(0, {});
  check('the A button shoots as well (as in Python)', (await events('shot_fired', 'e.player === 2')) >= 1);
  await sleep(150);

  // --- stick drift: a released stick with small noise never moves or turns the ship --------------------------------------------
  await quiet();
  b0 = await sim();
  await padPut(0, { axes: { 0: 0.12, 1: -0.14 } });
  await sleep(600);
  st = await sim();
  check('stick drift inside the 0.15 dead zone does nothing', near(st.p2.x, b0.p2.x, 0.01) && near(st.p2.y, b0.p2.y, 0.01) && near(st.p2.rot, b0.p2.rot, 0.01));
  await padPut(0, { axes: { 0: 0.5 } });
  await sleep(500);
  const half = (await sim()).p2.rot - b0.p2.rot;
  await padPut(0, {});
  await quiet();
  b0 = await sim();
  await padPut(0, { axes: { 0: 1 } });
  await sleep(500);
  const full = (await sim()).p2.rot - b0.p2.rot;
  await padPut(0, {});
  check('half deflection turns about half as fast as full (analogue, like Python)', full > 40 && half > 10 && half / full > 0.3 && half / full < 0.7, JSON.stringify({ half: Math.round(half), full: Math.round(full) }));

  // --- laser and boost -------------------------------------------------------------------------------------------------------------
  await sleep(150);
  await quiet();
  await clearEvents();
  await padPut(0, { buttons: { [BTN.X]: 1 } });
  await sleep(500);
  st = await sim();
  check('X fires Player 2\'s laser exactly once while held (not every frame), Player 1\'s charges untouched', (await events('laser_fired', 'e.player === 2')) === 1 && st.p2.laser === 14 && st.p1.laser === 15, JSON.stringify({ l1: st.p1.laser, l2: st.p2.laser }));
  await padPut(0, {});
  await sleep(1300);
  await padTap(0, BTN.X);
  check('releasing and pressing X again fires it again', (await events('laser_fired', 'e.player === 2')) === 2);
  await sleep(150);
  await quiet();
  await clearEvents();
  await padPut(0, { buttons: { [BTN.B]: 1 }, axes: { 1: -1 } });
  await sleep(500);
  st = await sim();
  check('B boosts Player 2 only, once', st.p2.boost && !st.p1.boost && (await events('boost_started', 'e.player === 2')) === 1 && (await events('boost_started', 'e.player === 1')) === 0);
  await padPut(0, {});
  await sleep(150);

  // --- pause with START, resume with START, nothing sticks ---------------------------------------------------------------------------
  await quiet();
  await clearEvents();
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1 } });
  await sleep(250);
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1, [BTN.START]: 1 } });
  await sleep(150);
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1 } });
  await sleep(150);
  const ps0 = await sim();
  await sleep(400);
  const ps1 = await sim();
  let tx = await texts();
  check('START pauses (even with stick and X held): the ship stops, the overlay offers START to resume', ps0.paused && ps1.paused && near(ps0.p2.y, ps1.p2.y, 0.01) && tx.includes('PAUSED') && tx.includes('Press P or START to Resume'), JSON.stringify(tx.filter((x) => /ress/.test(x))));
  await shot('paused-pad');
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1, [BTN.START]: 1 } });
  await sleep(150);
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1 } });
  await sleep(400);
  const ps2 = await sim();
  check('START again resumes; the held stick keeps flying the ship', !ps2.paused && Math.abs(ps2.p2.y - ps1.p2.y) > 20, JSON.stringify({ paused: ps2.paused, dy: ps2.p2.y - ps1.p2.y }));
  check('X held through pause / resume fired once and not again on resume', (await events('laser_fired', 'e.player === 2')) === 1, String(await events('laser_fired', 'e.player === 2')));
  await padPut(0, {});
  await sleep(100);

  // =====================================================================================================================
  // 4. Disconnect, reconnect, focus
  // =====================================================================================================================
  await quiet();
  await clearEvents();
  await padPut(0, { axes: { 0: 1, 1: -1 }, buttons: { [BTN.RT]: 1 } });
  await sleep(350);
  await padRemove(0);
  await padEvent('gamepaddisconnected');
  await sleep(200);
  st = await sim();
  tx = await texts();
  check('unplugging mid-action pauses the game and says which player lost their controller', st.paused && tx.some((x) => /PLAYER 2'S CONTROLLER DISCONNECTED/.test(x)), JSON.stringify(tx.filter((x) => /CONTROLLER|ress/.test(x))));
  await shot('disconnected');
  const dc0 = await sim();
  await sleep(500);
  const dc1 = await sim();
  check('...and the ship does not keep thrusting, turning or firing', near(dc0.p2.x, dc1.p2.x, 0.01) && near(dc0.p2.y, dc1.p2.y, 0.01) && near(dc0.p2.rot, dc1.p2.rot, 0.01));
  h = await hub();
  check('the hub no longer lists the controller or claims it for Player 2', h.pads.length === 0 && h.p2 === null, JSON.stringify(h));
  await page.keyboard.press('KeyP');
  await sleep(200);
  await clearEvents();
  b0 = await sim();
  await sleep(500);
  st = await sim();
  check('after resuming without the controller Player 2 stays idle (no stuck input) and nothing was fired', near(st.p2.y, b0.p2.y, 0.01) && (await events('shot_fired', 'e.player === 2')) === 0);
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  check('...while the keyboard player is unaffected', (await sim()).p1.y > st.p1.y + 30);

  // reconnect with the trigger still down (the thumb is still on it)
  await padPut(0, { buttons: { [BTN.RT]: 1 } });
  await padEvent('gamepadconnected');
  await sleep(300);
  h = await hub();
  check('reconnecting the same controller gives Player 2 back automatically', h.p2 === 0, JSON.stringify(h));
  await clearEvents();
  await sleep(500);
  check('...but a trigger still held at reconnect does not fire until it is released and pulled again', (await events('shot_fired', 'e.player === 2')) === 0);
  await padPut(0, {});
  await sleep(200);
  await padPut(0, { buttons: { [BTN.RT]: 1 } });
  await sleep(500);
  await padPut(0, {});
  check('then the trigger works', (await events('shot_fired', 'e.player === 2')) >= 1);

  // disconnect while paused, reconnect while paused
  await sleep(100);
  await padTap(0, BTN.START);
  check('(paused again with START)', (await sim()).paused);
  await padRemove(0);
  await sleep(250);
  check('a disconnect during pause leaves the game paused with the note', (await sim()).paused && (await texts()).some((x) => /DISCONNECTED/.test(x)));
  await padPut(0, {});
  await sleep(300);
  h = await hub();
  check('reconnecting during pause restores the assignment and stays paused', h.p2 === 0 && (await sim()).paused);
  await padTap(0, BTN.START);
  check('START resumes', !(await sim()).paused);

  // window focus
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.RT]: 1 } });
  await sleep(250);
  await page.evaluate(`window.dispatchEvent(new Event('blur'))`);
  await sleep(200);
  const bl0 = await sim();
  h = await hub();
  check('window blur pauses the game and makes the controller neutral (not armed) while its buttons are still down', bl0.paused && h.pads[0]?.armed === false, JSON.stringify({ paused: bl0.paused, pads: h.pads }));
  await page.evaluate(`window.dispatchEvent(new Event('focus'))`);
  await sleep(100);
  await page.keyboard.press('KeyP');
  await clearEvents();
  b0 = await sim();
  await sleep(500);
  st = await sim();
  check('after refocusing and resuming, a stick and trigger that stayed down are NOT trusted (no movement, no shots)', near(st.p2.y, b0.p2.y, 0.01) && (await events('shot_fired', 'e.player === 2')) === 0, JSON.stringify({ dy: st.p2.y - b0.p2.y }));
  await padPut(0, {});
  await sleep(200);
  await padPut(0, { axes: { 1: -1 } });
  await sleep(400);
  check('...once released, the controller works again', (await sim()).p2.y > st.p2.y + 20 || (await sim()).p2.y < st.p2.y - 20);
  await padPut(0, {});

  // =====================================================================================================================
  // 5. Death, Revive, game over, retry, restart
  // =====================================================================================================================
  await sleep(150);
  await quiet();
  await knockOut(2);
  await sleep(150);
  st = await sim();
  check('Player 2 (controller) loses all lives and is out; Player 1 plays on', st.p2.lives === 0 && st.p1.lives === 3 && !st.over);
  await clearEvents();
  b0 = await sim();
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.RT]: 1, [BTN.X]: 1 } });
  await sleep(500);
  await padPut(0, {});
  st = await sim();
  check('an eliminated controller player cannot move, shoot or fire the laser', near(st.p2.y, b0.p2.y, 0.01) && (await events('shot_fired', 'e.player === 2')) === 0 && (await events('laser_fired', 'e.player === 2')) === 0);
  await evalSim(`s.powerups.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 15, type: 'revive', lifetime: 20, alive: true });`);
  await sleep(250);
  st = await sim();
  check('Player 1 (keyboard) collects a Revive: Player 2 is back with 3 lives', st.p2.lives === 3 && (await events('player_revived', 'e.player === 2')) === 1, JSON.stringify(st.p2));
  await sleep(150);
  b0 = await sim();
  await padPut(0, { axes: { 1: -1 } });
  await sleep(450);
  await padPut(0, {});
  check('the revived ship answers the controller again', Math.abs((await sim()).p2.y - b0.p2.y) > 40);

  // pad player scores and shoots a rock
  await quiet();
  await addRock(960, 200);
  await evalSim(`s.players[1].rotation = 180; s.players[1].position.x = 960; s.players[1].position.y = 360;`);
  await padPut(0, { buttons: { [BTN.RT]: 1 } });
  await page.waitForFunction(`${S}.sim.players[1].score > 0`, null, { timeout: 4000 }).catch(() => {});
  await padPut(0, {});
  st = await sim();
  check('a rock shot by the controller player scores for Player 2 only', st.p2.score > 0 && st.p1.score === 0, JSON.stringify({ s1: st.p1.score, s2: st.p2.score }));

  // game over -> retry with A
  await quiet();
  await knockOut(1);
  await knockOut(2);
  await sleep(300);
  st = await sim();
  tx = await texts();
  check('both out: GAME OVER with BACK / A hints for the controller', st.over && tx.includes('GAME OVER') && tx.some((x) => /Press ESC or BACK/.test(x)), JSON.stringify(tx.filter((x) => /ress|Wait/.test(x))));
  await padPut(0, { buttons: { [BTN.A]: 1 } });
  await sleep(300);
  check('A held during the retry delay does not retry early', (await sim()).over);
  await padPut(0, {});
  await page.waitForFunction(`${S}.sim.retryDelay <= 0`, null, { timeout: 8000 }).catch(() => {});
  await sleep(200);
  check('the held A from before the delay ended does not count as a press: still on the game-over screen', (await sim()).over);
  await padPut(0, { buttons: { [BTN.A]: 1 } }); // a deliberate fresh press
  await sleep(200);
  await clearEvents();
  await sleep(500);
  st = await sim();
  check('a fresh A press retries: a new run, 3 lives each, scores zero', !st.over && st.p1.lives === 3 && st.p2.lives === 3 && st.p1.score === 0 && st.p2.score === 0);
  check('A is still held after the retry but does NOT shoot in the new run (controller is neutral until released)', (await events('shot_fired', 'e.player === 2')) === 0 && st.shots === 0, JSON.stringify({ shots: st.shots }));
  await padPut(0, {});
  await sleep(200);
  await padPut(0, { buttons: { [BTN.A]: 1 } });
  await sleep(450);
  await padPut(0, {});
  check('after releasing, A shoots again', (await events('shot_fired', 'e.player === 2')) >= 1);

  // restart with R several times: listeners must not pile up
  const before = (await hub()).listeners;
  for (let i = 0; i < 4; i++) {
    await quiet();
    await knockOut(1);
    await knockOut(2);
    await page.waitForFunction(`${S}.sim.isGameOver && ${S}.sim.retryDelay <= 0`, null, { timeout: 9000 }).catch(() => {});
    await page.keyboard.press('KeyR');
    await sleep(350);
  }
  h = await hub();
  check('restarting the scene 4 times leaves exactly one controller listener (no stale ones)', before === 1 && h.listeners === 1 && h.p2 === 0, JSON.stringify({ before, after: h.listeners }));
  // held controls at restart
  await quiet();
  await knockOut(1);
  await knockOut(2);
  await page.waitForFunction(`${S}.sim.isGameOver && ${S}.sim.retryDelay <= 0`, null, { timeout: 9000 }).catch(() => {});
  // Hold stick + B + X on the game-over screen, then restart with R while they are still down.
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.B]: 1, [BTN.X]: 1 } });
  await sleep(150);
  await clearEvents();
  await page.keyboard.press('KeyR');
  await sleep(600);
  st = await sim();
  check('B, X and the stick held across a restart do nothing in the new run until released', !st.over && (await events('boost_started')) === 0 && (await events('laser_fired')) === 0 && near(st.p2.y, 360, 0.5), JSON.stringify({ over: st.over, y: st.p2.y, boosts: await events('boost_started'), lasers: await events('laser_fired'), hub: await hub() }));
  await padPut(0, {});

  // =====================================================================================================================
  // 6. Menu round trip, one-player controller, BACK
  // =====================================================================================================================
  await padTap(0, BTN.START);
  await padTap(0, BTN.BACK);
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 4000 }).catch(() => {});
  h = await hub();
  check('START then BACK returns to the title screen; the pad keeps its assignment and no game listener is left behind', await page.evaluate(() => window.__game.scene.isActive('StartScene')) && h.p2 === 0 && h.listeners === 0, JSON.stringify(h));
  await page.keyboard.press('Digit1');
  await sleep(250);
  t = await texts(T);
  check('one-player mode: the Player 2 pad now drives the single ship and is listed as Player 1', t.some((x) => /-> PLAYER 1/.test(x)), JSON.stringify(t.filter((x) => /ontroller/.test(x))));
  await padTap(0, BTN.A);
  await begin('pad');
  st = await sim();
  check('A on the assigned controller starts a one-player game', st.count === 1);
  await padPut(0, {});
  await sleep(250);
  b0 = await sim();
  await clearEvents();
  await padPut(0, { axes: { 0: 1, 1: -1 }, buttons: { [BTN.RT]: 1 } });
  await sleep(700);
  await padPut(0, {});
  st = await sim();
  check('a single player flies and fires with only the controller', st.p1.rot - b0.p1.rot > 30 && Math.hypot(st.p1.x - b0.p1.x, st.p1.y - b0.p1.y) > 30 && (await events('shot_fired', 'e.player === 1')) >= 1, JSON.stringify({ rot: st.p1.rot - b0.p1.rot }));
  await page.keyboard.down('KeyW');
  await padPut(0, { axes: { 1: 1 } });
  b0 = await sim();
  await sleep(400);
  st = await sim();
  await page.keyboard.up('KeyW');
  await padPut(0, {});
  check('keyboard and controller on the same ship: the keyboard wins the axis it is pushing (W forward beats stick back)', Math.hypot(st.p1.x - b0.p1.x, st.p1.y - b0.p1.y) > 30);

  // =====================================================================================================================
  // 7. Two controllers
  // =====================================================================================================================
  await title();
  await page.keyboard.press('Digit2');
  await padPut(0, {});
  await padPut(1, { id: PS });
  await sleep(300);
  await padTap(0, BTN.A);
  await padTap(1, BTN.A, 140, { id: PS });
  h = await hub();
  t = await texts(T);
  check('two controllers: the first joins Player 2, the second Player 1, listed separately', h.p2 === 0 && h.p1 === 1 && t.some((x) => /Controller 1: .* -> PLAYER 2/.test(x)) && t.some((x) => /Controller 2: .* -> PLAYER 1/.test(x)), JSON.stringify({ h: [h.p1, h.p2], t: t.filter((x) => /ontroller/.test(x)) }));
  await shot('title-two-pads');
  await begin();
  await padPut(1, { id: PS });
  await sleep(200);
  await quiet();
  b0 = await sim();
  await clearEvents();
  await padPut(0, { axes: { 1: -1 }, buttons: { [BTN.X]: 1 } });
  await sleep(500);
  st = await sim();
  check('controller 1 drives only Player 2 (Player 1 and the keyboard untouched)', Math.abs(st.p2.y - b0.p2.y) > 30 && near(st.p1.y, b0.p1.y, 0.01) && (await events('laser_fired', 'e.player === 2')) === 1 && (await events('laser_fired', 'e.player === 1')) === 0);
  await padPut(0, {});
  await sleep(150);
  await quiet();
  b0 = await sim();
  await clearEvents();
  await padPut(1, { id: PS, axes: { 1: -1 }, buttons: { [BTN.B]: 1 } });
  await sleep(500);
  st = await sim();
  check('controller 2 drives only Player 1', Math.abs(st.p1.y - b0.p1.y) > 30 && near(st.p2.y, b0.p2.y, 0.01) && st.p1.boost && !st.p2.boost);
  await padPut(1, { id: PS });
  await sleep(150);
  await quiet();
  b0 = await sim();
  await padPut(0, { axes: { 0: 1 } });
  await padPut(1, { id: PS, axes: { 0: -1 } });
  await sleep(400);
  await padPut(0, {});
  await padPut(1, { id: PS });
  st = await sim();
  check('both controllers at once turn their own ships in opposite directions', st.p2.rot - b0.p2.rot > 50 && (((st.p1.rot - b0.p1.rot + 540) % 360) - 180) < -50);
  await padRemove(1);
  await sleep(250);
  st = await sim();
  tx = await texts();
  check('unplugging only controller 2 pauses and names Player 1; controller 1 stays assigned to Player 2', st.paused && tx.some((x) => /PLAYER 1'S CONTROLLER DISCONNECTED/.test(x)) && (await hub()).p2 === 0);

  // =====================================================================================================================
  // 8. A non-standard device (read conservatively with Python's raw indices)
  // =====================================================================================================================
  await title();
  await padPut(0, { mapping: '', id: '1234-5678-Generic USB Joystick', axisCount: 6 });
  await sleep(300);
  await padTap(0, BTN.A, 140, { mapping: '', id: '1234-5678-Generic USB Joystick', axisCount: 6 });
  t = await texts(T);
  check('a pad without the standard mapping is flagged on the title screen', t.some((x) => /non-standard layout/.test(x)), JSON.stringify(t.filter((x) => /ontroller/.test(x))));
  await padTap(0, BTN.A, 140, { mapping: '', id: '1234-5678-Generic USB Joystick', axisCount: 6 });
  await begin('pad');
  await sleep(100);
  b0 = await sim();
  await clearEvents();
  const gen = { mapping: '', id: '1234-5678-Generic USB Joystick', axisCount: 6 };
  await padPut(0, { ...gen, axes: { 0: 1, 1: -1, 5: 0.9 } });
  await sleep(600);
  await padPut(0, gen);
  st = await sim();
  check('...and still steers, thrusts and shoots through axes 0 / 1 and the trigger axis 5', st.p1.rot - b0.p1.rot > 30 && Math.hypot(st.p1.x - b0.p1.x, st.p1.y - b0.p1.y) > 20 && (await events('shot_fired', 'e.player === 1')) >= 1);

  // =====================================================================================================================
  // 8b. No Gamepad API at all (Chrome hides it on plain http): say so, and keyboard play still works
  // =====================================================================================================================
  await title();
  await page.evaluate(() => { navigator.getGamepads = undefined; });
  await sleep(300);
  t = await texts(T);
  check('where the Gamepad API does not exist the title says so instead of "no controller detected"', t.some((x) => /unavailable/.test(x)) && !t.some((x) => /No controller detected/.test(x)), JSON.stringify(t.filter((x) => /ontroller|amepad/.test(x))));
  await begin();
  await page.keyboard.down('KeyW');
  b0 = await sim();
  await sleep(400);
  await page.keyboard.up('KeyW');
  check('...and the keyboard game runs normally without it', (await sim()).p1.y !== b0.p1.y);

  // =====================================================================================================================
  // 9. ?keydebug shows the controller section
  // =====================================================================================================================
  await title('&keydebug');
  await padPut(0, {});
  await page.keyboard.press('Digit2');
  await sleep(200);
  await padTap(0, BTN.A);
  await begin();
  await padPut(0, { axes: { 0: 0.6 }, buttons: { [BTN.RT]: 1 } });
  await sleep(400);
  const panel = await page.evaluate(() => document.querySelector('[data-keydebug] pre')?.textContent ?? '');
  await padPut(0, {});
  check('?keydebug lists the controller, its mapping, raw axes / buttons, the normalised command and the receiving player',
    /gamepads: 1 connected/.test(panel) && /mapping="standard"/.test(panel) && /raw axes 0:0\.60/.test(panel) && /7\(1\.00\)/.test(panel) && /rotate=0\.60/.test(panel) && /goes to PLAYER 2/.test(panel), panel.split('\n').filter((l) => /gamepad|raw|normalised|goes/.test(l)).join(' | '));
  check('...and no controller panel exists without ?keydebug', await (async () => {
    await title();
    return (await page.evaluate(() => document.querySelector('[data-keydebug]'))) === null;
  })());

  check('no console errors, page errors or failed requests', problems.length === 0, problems.slice(0, 3).join(' | '));
}
