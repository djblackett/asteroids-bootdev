// Real-browser keyboard tests: drives the production build in headless Chrome with genuine keydown / keyup events
// (Playwright sends them through the browser's own input pipeline) and checks what the simulation does with them.
//
//   npm run test:input            (builds first)
//   CHROME_PATH=/path/to/chrome node scripts/keyboard.mjs     (reuse an existing build in dist/)
//
// LIMITATION: synthetic events cannot reproduce a physical keyboard's rollover / ghosting limits. Every key
// Playwright presses is delivered, whatever the combination. This suite proves the *software* path loses nothing; if a
// real keyboard cannot report a combination, the browser never receives it (open the game with ?keydebug to see that).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.INPUT_TEST_PORT ?? 4398);
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

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing; run `npm run build` first.');
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await run(browser);
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed`);
console.log('Note: synthetic keys cannot show physical-keyboard rollover limits; see the header of scripts/keyboard.mjs.');
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));

  // Count window listeners net of removals, to prove nothing accumulates across restarts.
  await page.addInitScript(() => {
    const counts = {};
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.__listenerCounts = counts;
    window.addEventListener = (type, listener, options) => ((counts[type] = (counts[type] ?? 0) + 1), add(type, listener, options));
    window.removeEventListener = (type, listener, options) => ((counts[type] = (counts[type] ?? 0) - 1), remove(type, listener, options));
  });

  const scene = `window.__game.scene.getScene('GameScene')`;
  const sim = () =>
    page.evaluate(`(() => { const s = ${scene}.sim, p = s.player; return {
      x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, phase: s.phase, time: s.time,
      shots: s.shots.length, lasers: s.lasers.length, charges: p.laser.shotsRemaining, boost: p.boost.active, retry: s.retryDelay };})()`);
  const paused = () => page.evaluate(`${scene}.paused`);
  const heldKeys = () => page.evaluate(() => [...window.__game.registry.get('heldKeys').snapshot()].sort());
  const listeners = () => page.evaluate(() => ({ keydown: window.__listenerCounts.keydown, keyup: window.__listenerCounts.keyup, blur: window.__listenerCounts.blur }));
  /** A paused run -> the title screen, the deliberate way: RETURN TO MENU (3 x Down from RESUME), asked once, confirmed by a second Enter. Escape no longer does this. */
  const quitToTitle = async (pg = page) => {
    for (let i = 0; i < 3; i++) {
      await pg.keyboard.press('ArrowDown');
      await sleep(40);
    }
    await pg.keyboard.press('Enter');
    await sleep(450);
    await pg.keyboard.press('Enter');
  };
  const tap = async (key, ms = 60) => (await page.keyboard.down(key), await sleep(ms), await page.keyboard.up(key));
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const reset = () =>
    page.evaluate(`(() => { const s = ${scene}.sim, p = s.player; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; s.shots.length = 0; s.lasers.length = 0;
      s.startCooldown = 0; p.position.x = 640; p.position.y = 360; p.rotation = 0; p.velocity = { x: 0, y: 0 }; p.boost.active = false; p.boost.cooldown = 0; p.boost.keyHeld = false;
      p.laser.cooldown = 0; p.laser.keyHeld = false; p.laser.shotsRemaining = 15; p.shootTimer = 0; })()`);
  /** Holds `keys` for `ms`, returning the state before, during (sampled just before release) and after. */
  const hold = async (keys, ms) => {
    await reset();
    await sleep(60);
    const before = await sim();
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    const during = await sim();
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    return { before, during };
  };
  const startGame = async () => {
    await page.goto(`${BASE}?debug`);
    await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
    await sleep(300);
  };

  await startGame();

  // --- 1. every simultaneous combination from the bug report --------------------------------------------------------
  const rotDelta = (a, b) => ((b.rot - a.rot + 540) % 360) - 180;
  /**
   * True when the ship turned in `dir` (+1 right, -1 left) at about 300 deg/s of *simulated* time. The keys go down one
   * round trip at a time and a sleep can overrun, so allow the last key to start late, but never turning the wrong way.
   */
  const turnedBy = (a, b, dir) => {
    const elapsed = b.time - a.time;
    const full = 300 * elapsed;
    const turned = dir > 0 ? (((b.rot - a.rot) % 360) + 360) % 360 : (((a.rot - b.rot) % 360) + 360) % 360;
    if (full >= 340) return elapsed > 0.2; // a delayed sample: more than ~one turn, direction no longer readable
    return elapsed > 0.2 && turned >= full * 0.6 - 5 && turned <= full + 15;
  };
  for (const [move, label] of [['KeyW', 'forward'], ['KeyS', 'backward']]) {
    for (const [turn, tl] of [['KeyA', 'left'], ['KeyD', 'right']]) {
      const { before, during } = await hold([move, turn], 400);
      const turned = rotDelta(before, during);
      const dir = tl === 'left' ? -1 : 1;
      check(`${label} + ${tl}: ship turns and moves`, turnedBy(before, during, dir) && dist(before, during) > 60, `turned=${turned.toFixed(0)} moved=${dist(before, during).toFixed(0)}`);
      const r = await hold([move, turn, 'Space'], 450);
      const t2 = rotDelta(r.before, r.during);
      check(`${label} + ${tl} + Space: turns, moves and fires`, turnedBy(r.before, r.during, dir) && dist(r.before, r.during) > 100 && r.during.shots >= 2, `turned=${t2.toFixed(0)} moved=${dist(r.before, r.during).toFixed(0)} shots=${r.during.shots}`);
    }
  }
  {
    const { before, during } = await hold(['KeyW', 'KeyD', 'Space'], 2500);
    check('forward + turn + Space keeps firing for 2.5 s', during.shots >= 5 || during.time - before.time > 2, `shots alive=${during.shots}`);
  }
  {
    const { before, during } = await hold(['ArrowUp', 'ArrowLeft', 'Space'], 500);
    check('arrow keys also work together with Space', dist(before, during) > 50 && turnedBy(before, during, -1) && during.shots >= 1);
  }

  // --- 2. abilities together with movement ----------------------------------------------------------------------------
  {
    const { before, during } = await hold(['KeyW', 'KeyD', 'KeyE'], 200);
    check('movement + laser: beam fired while turning and moving', during.charges === before.charges - 1 && turnedBy(before, during, 1) && dist(before, during) > 20, `charges ${before.charges}->${during.charges} lasers=${during.lasers}`);
  }
  {
    const plain = await hold(['KeyW', 'KeyD'], 400);
    const boosted = await hold(['KeyW', 'KeyD', 'ShiftLeft'], 400);
    check('movement + boost: boost active, still turning, clearly faster', boosted.during.boost && turnedBy(boosted.before, boosted.during, 1) && dist(boosted.before, boosted.during) > dist(plain.before, plain.during) * 1.3, `plain=${dist(plain.before, plain.during).toFixed(0)} boosted=${dist(boosted.before, boosted.during).toFixed(0)}`);
    await sleep(200);
  }
  {
    // Python rule: no cannon while boosting. Not a lost key.
    await reset();
    await page.evaluate(`${scene}.sim.player.boost.cooldown = 0`);
    await page.keyboard.down('ShiftLeft');
    await sleep(100);
    await page.keyboard.up('ShiftLeft');
    await page.evaluate(`${scene}.sim.shots.length = 0`);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await sleep(500);
    const s = await sim();
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    check('while boosting, Space fires nothing (original game rule) but movement continues', s.boost && s.shots === 0 && s.y > 400, JSON.stringify({ boost: s.boost, shots: s.shots, y: Math.round(s.y) }));
    await page.evaluate(`${scene}.sim.player.boost.active = false`);
  }

  // --- 3. release one key, the rest keep working ------------------------------------------------------------------------
  {
    await reset();
    await sleep(60);
    for (const k of ['KeyW', 'KeyD', 'Space']) await page.keyboard.down(k);
    await sleep(250);
    await page.keyboard.up('KeyD');
    await sleep(60);
    const a = await sim();
    await sleep(350);
    const b = await sim();
    await page.keyboard.up('Space');
    await sleep(60);
    await page.evaluate(`${scene}.sim.shots.length = 0`);
    const c = await sim();
    await sleep(300);
    const d = await sim();
    await page.keyboard.up('KeyW');
    check('after releasing D: turning stops, moving and firing continue', Math.abs(rotDelta(a, b)) < 2 && dist(a, b) > 60 && b.shots > 0, `rot=${rotDelta(a, b).toFixed(1)} moved=${dist(a, b).toFixed(0)}`);
    check('after releasing Space too: W alone still moves, no new shots', dist(c, d) > 40 && d.shots === 0, `moved=${dist(c, d).toFixed(0)} shots=${d.shots}`);
  }

  // --- 4. repeated keydown events (OS auto-repeat) ------------------------------------------------------------------------
  {
    await reset();
    for (let i = 0; i < 12; i++) await page.keyboard.down('KeyD'); // one real press + 11 auto-repeats
    await sleep(80);
    check('repeated keydowns register as one held key', JSON.stringify(await heldKeys()) === '["KeyD"]');
    await page.keyboard.up('KeyD');
    await sleep(80);
    const a = await sim();
    await sleep(200);
    check('a single keyup after many repeats stops the turn', Math.abs(rotDelta(a, await sim())) < 1 && (await heldKeys()).length === 0);
  }

  // --- 5. pause while keys are held -------------------------------------------------------------------------------------------
  {
    await reset();
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await sleep(150);
    await tap('KeyP'); // pause
    await sleep(100);
    const p1 = await sim();
    check('pause stops the simulation but not the held-key record', (await paused()) && JSON.stringify(await heldKeys()) === '["KeyD","KeyW"]');
    await tap('KeyP'); // resume, W and D never released
    await sleep(350);
    const p2 = await sim();
    check('after unpausing, keys that stayed down keep moving AND turning the ship (no re-press needed)', !(await paused()) && dist(p1, p2) > 60 && turnedBy(p1, p2, 1), `moved=${dist(p1, p2).toFixed(0)} turned=${rotDelta(p1, p2).toFixed(0)}`);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
  }
  {
    await reset();
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await sleep(120);
    await tap('KeyP');
    await page.keyboard.up('KeyD'); // released while paused
    await sleep(100);
    await tap('KeyP');
    const a = await sim();
    await sleep(300);
    const b = await sim();
    await page.keyboard.up('KeyW');
    check('a key released during the pause stays released; the other keeps working', Math.abs(rotDelta(a, b)) < 1 && dist(a, b) > 50, `turned=${rotDelta(a, b).toFixed(1)} moved=${dist(a, b).toFixed(0)}`);
  }
  {
    // Laser pressed while paused and still held at resume must not count as a fresh press.
    await reset();
    await tap('KeyP');
    await page.keyboard.down('KeyE');
    await tap('KeyP');
    await sleep(200);
    const s = await sim();
    await page.keyboard.up('KeyE');
    check('E held across resume does not fire a surprise laser', s.charges === 15, `charges=${s.charges}`);
  }

  // --- 6. focus loss and recovery ---------------------------------------------------------------------------------------------------
  {
    await reset();
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await sleep(100);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(150);
    check('window blur pauses the game and forgets held keys (no stuck keys)', (await paused()) && (await heldKeys()).length === 0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await tap('KeyP'); // resume
    await sleep(100);
    const a = await sim();
    await sleep(250);
    check('after blur, nothing moves on its own (keys were released while unfocused)', dist(a, await sim()) < 1);
    const beforeRepeat = await sim();
    await page.keyboard.down('KeyW'); // OS auto-repeat of a key that is still held
    await page.keyboard.down('KeyD');
    await sleep(300);
    const b = await sim();
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    check('keys still held after refocus work again as soon as the browser reports them', dist(beforeRepeat, b) > 40 && turnedBy(beforeRepeat, b, 1));
  }
  {
    await reset();
    await page.keyboard.down('KeyD');
    await sleep(60);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(100);
    const emptied = (await heldKeys()).length === 0 && (await paused());
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.keyboard.up('KeyD');
    await tap('KeyP');
    check('hiding the tab pauses and clears held keys', emptied);
  }

  // --- 7. restart, menu round trip, listener cleanup ---------------------------------------------------------------------------------
  const baseline = await listeners();
  for (let round = 0; round < 3; round++) {
    await page.evaluate(`(() => { const s = ${scene}.sim, p = s.player; s.spawner.spawnTimer = -1e9; p.lives = 1; p.shieldActive = false; p.isRespawning = false; p.boost.active = false;
      s.asteroids.push({ position: { x: p.position.x, y: p.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
    await page.waitForFunction(`${scene}.sim.phase === 'gameOver'`, null, { timeout: 5000 });
    await page.waitForFunction(`${scene}.sim.retryDelay === 0`, null, { timeout: 8000 });
    await page.keyboard.down('KeyW'); // held through the retry
    await page.keyboard.down('KeyD');
    await tap('KeyR');
    await sleep(150);
    const a = await sim();
    await sleep(300);
    const b = await sim();
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    check(`retry #${round + 1}: keys held through the restart still steer the new ship`, a.phase === 'playing' && a.lives === 3 && dist(a, b) > 40 && turnedBy(a, b, 1), `moved=${dist(a, b).toFixed(0)}`);
    await page.evaluate(`${scene}.sim.spawner.spawnTimer = -1e9`);
  }
  await tap('KeyP');
  await sleep(150);
  await quitToTitle();
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 3000 });
  await page.keyboard.down('KeyW'); // hold a movement key on the title screen, then start with Space
  await tap('Space', 80);
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 3000 });
  await reset();
  const s0 = await sim();
  await sleep(300);
  const s1 = await sim();
  await page.keyboard.up('KeyW');
  check('a movement key held on the title screen works as soon as the game starts', dist(s0, s1) > 40, `moved=${dist(s0, s1).toFixed(0)}`);
  const after = await listeners();
  check('no key listeners accumulate across 3 retries and a menu round trip', JSON.stringify(after) === JSON.stringify(baseline), JSON.stringify({ baseline, after }));

  // --- 8. one-shot keys still fire exactly once ------------------------------------------------------------------------------------------
  {
    await reset();
    await page.keyboard.down('KeyW');
    const was = await paused();
    await page.keyboard.down('KeyP');
    for (let i = 0; i < 5; i++) await page.keyboard.down('KeyP');
    await page.keyboard.up('KeyP');
    await sleep(150);
    check('P pressed (and auto-repeating) while W is held toggles pause exactly once', (await paused()) === !was);
    await tap('KeyP');
    await page.keyboard.up('KeyW');
    // Escape pauses a run and resumes from the pause menu; it never leaves. P then Escape lands either in one frame (the menu does not
    // exist yet, so the Escape is ignored: paused) or in two (it resumes): whichever, the run is still there, in one coherent state.
    let failures8 = 0;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.down('KeyW');
      await page.keyboard.press('KeyP');
      await page.keyboard.press('Escape');
      await sleep(250);
      const st = await page.evaluate(`({ active: window.__game.scene.isActive('GameScene'), paused: ${scene}.paused, menu: ${scene}.pauseMenu.isOpen, page: ${scene}.pauseMenuSnapshot().page })`);
      if (!st.active || st.paused !== st.menu || (st.paused && st.page !== 'pause')) failures8++;
      await page.keyboard.up('KeyW');
      if (st.paused) await page.keyboard.press('KeyP');
      await sleep(150);
    }
    check('P then Escape with a movement key held never leaves the run and ends in one coherent state (8 tries)', failures8 === 0, `failures=${failures8}`);
  }

  // --- 9. diagnostics: opt-in only ------------------------------------------------------------------------------------------------------------
  check('no diagnostics overlay in ordinary play', (await page.evaluate(() => document.querySelector('[data-keydebug]'))) === null);
  await page.close(); // the first game page would keep rendering in the background and skew the frame-time check below
  const diagContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const diag = await diagContext.newPage();
  diag.on('pageerror', (e) => problems.push(String(e)));
  await diag.goto(`${BASE}?debug&keydebug`);
  await diag.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await diag.keyboard.press('Space');
  await diag.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  await diag.keyboard.press('KeyJ'); // an old event, to prove the history window drops it later
  await sleep(300);
  await diag.keyboard.down('KeyW');
  await diag.keyboard.down('KeyA');
  await diag.keyboard.down('Space');
  await sleep(300);
  const overlay = await diag.evaluate(() => document.querySelector('[data-keydebug]')?.textContent ?? null);
  check('?keydebug shows raw events, held sets, GameSim input and a verdict', !!overlay && overlay.includes('1 raw browser held : KeyA KeyW Space') && overlay.includes('rotate=-1 move=1 shoot=1') && overlay.includes('verdict: OK'), overlay ? overlay.split('\n').slice(1, 8).join(' | ') : 'no overlay');
  // --- freeze / copy / clear ---
  const panelText = () => diag.evaluate(() => document.querySelector('[data-keydebug] pre')?.textContent ?? '');
  const statusText = () => diag.evaluate(() => document.querySelector('[data-keydebug] div:nth-child(2)')?.textContent ?? '');
  const button = (label) => diag.locator('[data-keydebug] button', { hasText: label });
  check('panel offers Freeze Capture, Copy Diagnostic Report and Clear Capture buttons',
    (await button('Freeze Capture').count()) === 1 && (await button('Copy Diagnostic Report').count()) === 1 && (await button('Clear Capture').count()) === 1);
  check('live panel says LIVE', (await statusText()).startsWith('LIVE'), await statusText());

  await button('Freeze Capture').click(); // keys W + A + Space are still physically down
  await sleep(150);
  const activeTag = await diag.evaluate(() => document.activeElement?.tagName);
  check('clicking a panel button does not take keyboard focus (Space cannot press it)', activeTag === 'BODY', activeTag);
  const frozenAtClick = await panelText();
  check('Freeze Capture preserves the held keys, input and verdict', (await statusText()).startsWith('FROZEN') && frozenAtClick.includes('1 raw browser held : KeyA KeyW Space') && frozenAtClick.includes('rotate=-1 move=1 shoot=1') && frozenAtClick.includes('verdict: OK'));
  check('the frozen report has a timeline with timestamps, raw events and INPUT states', /-\d+\.\d{3}s\s+v keydown KeyW/.test(frozenAtClick) && /-\d+\.\d{3}s\s+INPUT\s+rotate=-1 move=1 shoot=1/.test(frozenAtClick) && /v keydown Space/.test(frozenAtClick), frozenAtClick.split('\n').slice(-6).join(' | '));

  // Let go of everything, mash a screenshot-style shortcut, lose and regain focus.
  await diag.keyboard.up('Space');
  await diag.keyboard.up('KeyA');
  await diag.keyboard.up('KeyW');
  await diag.keyboard.down('MetaLeft');
  await diag.keyboard.down('ShiftLeft');
  await diag.keyboard.press('KeyS');
  await diag.keyboard.up('ShiftLeft');
  await diag.keyboard.up('MetaLeft');
  await diag.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await sleep(500);
  const frozenLater = await panelText();
  check('after releasing keys, a screenshot shortcut and a blur, the frozen report is unchanged', frozenLater === frozenAtClick && !frozenLater.includes('MetaLeft'));
  check('while frozen the game itself still reads the real keys (diagnostics are passive)', (await diag.evaluate(() => window.__game.registry.get('heldKeys').snapshot().size)) === 0);

  await button('Copy Diagnostic Report').click();
  await sleep(300);
  const clip = await diag.evaluate(() => navigator.clipboard.readText());
  check('Copy Diagnostic Report puts the frozen report on the clipboard', clip.replaceAll(String.fromCharCode(13), '') === frozenAtClick && clip.startsWith('KEY DIAGNOSTIC REPORT') && clip.includes('browser: '), `${clip.length} chars`);

  await button('Clear Capture').click();
  await sleep(300);
  const cleared = await panelText();
  check('Clear Capture resumes live recording and drops the old events', (await statusText()).startsWith('LIVE') && !/KeyW/.test((await statusText())) && cleared.includes('1 raw browser held : -'));
  await diag.keyboard.down('KeyD');
  await sleep(250);
  check('after clearing, new key events show up live again', (await panelText()).includes('1 raw browser held : KeyD'));
  await diag.keyboard.up('KeyD');

  // The rolling window drops events older than ~10 s and the history stays small.
  await diag.keyboard.press('KeyJ');
  await sleep(10600);
  await diag.keyboard.press('KeyK');
  await sleep(200);
  await button('Freeze Capture').click();
  const windowed = await panelText();
  check('history keeps ~10 s: the 10.6 s old tap is gone, the recent one is kept', !/keydown KeyJ/.test(windowed) && /keydown KeyK/.test(windowed), windowed.split('\n').find((l) => l.startsWith('history:')));
  const entries = Number((windowed.match(/\((\d+) entries/) ?? [])[1]);
  check('history stays bounded (<= 1500 entries)', entries > 0 && entries <= 1500, `entries=${entries}`);
  await button('Clear Capture').click();

  if (await diag.evaluate(`window.__game.scene.getScene('GameScene').paused`)) await diag.keyboard.press('KeyP'); // the blur above auto-paused
  await diag.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.player.lives = 99; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; })()`);
  // Cost: frame time with the panel on, keys held, versus the 25 ms bar used by the smoke test.
  await diag.keyboard.down('KeyW');
  await diag.keyboard.down('KeyD');
  await diag.keyboard.down('Space');
  const avg = await diag.evaluate(() => new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    const t0 = last;
    const tick = (now) => { times.push(now - last); last = now; if (now - t0 < 3000) requestAnimationFrame(tick); else resolve(times.reduce((x, y) => x + y, 0) / times.length); };
    requestAnimationFrame(tick);
  }));
  await diag.keyboard.up('KeyW');
  await diag.keyboard.up('KeyD');
  await diag.keyboard.up('Space');
  check('panel on, 3 keys held, 3 s: average frame < 25 ms', avg < 25, `avg=${avg.toFixed(1)} ms`);

  await diag.keyboard.press('KeyP');
  await sleep(150);
  await quitToTitle(diag);
  await diag.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 3000 });
  check('the overlay is removed when the game scene shuts down', (await diag.evaluate(() => document.querySelector('[data-keydebug]'))) === null);
  await diag.close();
  await diagContext.close();

  check('no console errors or page errors', problems.length === 0, problems.join(' | '));
}
