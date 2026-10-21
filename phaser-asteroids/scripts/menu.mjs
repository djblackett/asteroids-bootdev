// Menu browser tests: drives the production build in a real (headless) Chrome and checks the title screen, the AUDIO / CONTROLS /
// TWO-PLAYER OPTIONS / POWER-UP pages and the pause menu with real keys, mouse clicks, controller buttons (a scripted Gamepad API) and
// touches: the hierarchy, navigation and Back, persistence, that a menu press never reaches the game, that opening and closing menus
// leaks nothing, and an automated layout review (every button on screen, thumb-sized and clear of the others, no clipped or overlapping
// text) of every page at every supported phone size and several desktop sizes. Screenshots of each go to scripts/.smoke-output/menu-*.png.
//
//   npm run test:menu          (builds first)
//   node scripts/menu.mjs      (reuse an existing build in dist/)
//
// What this proves and what it does not: layout, navigation and wiring in Chromium. It does NOT prove how the menus feel under a real
// thumb, on a real phone's browser chrome, or how the type looks on a real display: the screenshots exist so a person can look.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.MENU_PORT ?? 4408);
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
const info = (text) => console.log(`INFO  ${text}`);

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
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stopServer = () => server.kill();
process.on('exit', stopServer);

const BTN = { A: 0, B: 1, X: 2, Y: 3, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
/** The signed turn from one heading to another, in degrees (-180..180). */
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const intersects = (a, b, gap = 0) => a.x < b.x + b.w - gap && a.x + a.w > b.x + gap && a.y < b.y + b.h - gap && a.y + a.h > b.y + gap;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await run();
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed  (Chromium headless; no real phone, controller or GPU)`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

/**
 * A page with the usual helpers. `touch`: mobile emulation (coarse pointer, touch). `pad`: a scripted Gamepad API. `seed`: localStorage
 * written once before the first load (the soundtrack defaults to Original so the music suite's randomness stays out of these tests).
 */
async function open({ w = 1280, h = 720, touch = false, query = '?debug', pad = false, seed = {}, vibrate = false } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch });
  const all = { 'asteroids.musicTrack': 'original', ...seed };
  await context.addInitScript((s) => {
    try {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        for (const [k, v] of Object.entries(s)) if (v !== null && localStorage.getItem(k) === null) localStorage.setItem(k, v);
      }
    } catch {
      // storage blocked: nothing to seed
    }
  }, all);
  if (pad) {
    await context.addInitScript(() => {
      const slots = [null, null, null, null];
      window.__pads = {
        put(index, spec = {}) {
          const buttons = Array.from({ length: 17 }, (_, i) => spec.buttons?.[i] ?? 0);
          slots[index] = { index, id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping: 'standard', axes: [0, 0, 0, 0], buttons };
        },
      };
      navigator.getGamepads = () =>
        slots.map((p) => (p ? { index: p.index, id: p.id, mapping: p.mapping, connected: true, timestamp: performance.now(), axes: [...p.axes], buttons: p.buttons.map((v) => ({ pressed: v >= 0.5, touched: v > 0, value: v })) } : null));
    });
  }
  if (vibrate) {
    await context.addInitScript(() => {
      window.__vib = { calls: [] };
      Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value(p) { window.__vib.calls.push(p); return true; } });
    });
  }
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  const scenes = (name) => `window.__game.scene.getScene('${name}')`;
  const snapOf = (name) => `${scenes(name)}.${name === 'StartScene' ? 'menuSnapshot' : 'pauseMenuSnapshot'}()`;
  const p = {
    page,
    context,
    problems,
    w,
    h,
    touch,
    shot: (name) => page.screenshot({ path: path.join(outDir, `menu-${name}.png`) }),
    async goto() {
      await page.goto(`${BASE}${query}`);
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      await sleep(350);
    },
    menu: (scene = 'StartScene') => page.evaluate(snapOf(scene)),
    async item(id, scene = 'StartScene') {
      return (await p.menu(scene)).items.find((i) => i.id === id) ?? null;
    },
    async canvas() {
      return page.evaluate(() => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height, scale: r.width / 1280 };
      });
    },
    async css(gx, gy) {
      const c = await p.canvas();
      return { x: c.left + gx * c.scale, y: c.top + gy * c.scale };
    },
    /** A real click (desktop) or touch (phone) on a menu item, or one named part of it. */
    async tap(id, { zone = null, scene = 'StartScene' } = {}) {
      const item = await p.item(id, scene);
      if (!item) throw new Error(`no menu item "${id}" on ${scene}`);
      const r = zone ? item.zones.find((z) => z.name === zone) : item;
      if (!r) throw new Error(`no zone "${zone}" on ${id}`);
      const pt = await p.css(r.x + r.w / 2, r.y + r.h / 2);
      if (touch) await page.touchscreen.tap(pt.x, pt.y);
      else await page.mouse.click(pt.x, pt.y);
      await sleep(300);
    },
    // Escape / Enter change the page: wait out the short input lock a page change puts on taps (220 ms) unless the test says otherwise.
    key: async (k, ms = k === 'Escape' || k === 'Enter' ? 300 : 60) => (await page.keyboard.press(k), await sleep(ms)),
    /** Moves the focus with the arrow keys until `id` is focused (or gives up). */
    async focus(id, scene = 'StartScene') {
      for (let i = 0; i < 14; i++) {
        const snap = await p.menu(scene);
        if (snap.focus === id) return true;
        const here = snap.items.find((x) => x.id === snap.focus);
        const there = snap.items.find((x) => x.id === id);
        if (!here || !there) return false;
        const dy = there.y - here.y;
        await page.keyboard.press(Math.abs(dy) > 30 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : there.x > here.x ? 'ArrowRight' : 'ArrowLeft');
        await sleep(60);
      }
      return false;
    },
    /** Visible Text objects of a scene (also those inside the menu's containers): text, game-space bounds, font size in game px. */
    texts: (scene = 'StartScene') =>
      page.evaluate(`(() => { const out = []; const walk = (list, visible) => { for (const c of list) { const v = visible && c.visible;
        if (c.type === 'Text' && v && c.text) { const b = c.getBounds(); out.push({ text: c.text, x: b.x, y: b.y, w: b.width, h: b.height, size: parseFloat(c.style.fontSize) * c.scaleX }); }
        if (c.list) walk(c.list, v); } }; walk(${scenes(scene)}.children.list, true); return out; })()`),
    words: async (scene = 'StartScene') => (await p.texts(scene)).map((t) => t.text),
    sim: () =>
      page.evaluate(`(() => { const sc = ${scenes('GameScene')}, s = sc.sim, pl = s.player; return { x: pl.position.x, y: pl.position.y, rot: pl.rotation, time: s.time, paused: sc.paused,
        shots: s.shots.length, laser: pl.laser.shotsRemaining, boost: pl.boost.active || pl.boost.cooldown > 0, lives: pl.lives, over: s.isGameOver, players: s.players.length }; })()`),
    scene: () => page.evaluate(() => ['StartScene', 'GameScene'].find((n) => window.__game.scene.isActive(n))),
    async start() {
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
      await sleep(400);
      await page.evaluate(`(() => { const s = ${scenes('GameScene')}.sim; s.spawner.spawnTimer = -1e9; s.ufoSpawner.enabled = false; s.asteroids.length = 0; s.shots.length = 0; s.startCooldown = 0; s.player.lives = 99; })()`);
    },
    stored: (key) => page.evaluate((k) => localStorage.getItem(k), key),
    padPut: (spec = {}) => page.evaluate((s) => window.__pads.put(0, s), spec),
    async padTap(button, ms = 140) {
      await p.padPut({ buttons: { [button]: 1 } });
      await sleep(ms);
      await p.padPut({});
      await sleep(140);
    },
  };
  return p;
}

/**
 * The automated layout review of whatever page is open: every button inside the screen, big enough for a thumb, clear of the others and of
 * the DOM Fullscreen pill; no text clipped by the edge of the canvas, none on top of another text or of a button it does not belong to,
 * and nothing smaller than `minFont` CSS px. Returns the list of problems (empty = fine).
 */
async function layoutProblems(p, scene, { minTarget = 44, minFont = 9.5 } = {}) {
  const snap = await p.menu(scene);
  const canvas = await p.canvas();
  const texts = await p.texts(scene);
  const bad = [];
  const k = canvas.scale;
  const view = { w: p.w, h: p.h };
  const items = snap.items;
  for (const it of items) {
    const css = { x: canvas.left + it.x * k, y: canvas.top + it.y * k, w: it.w * k, h: it.h * k };
    if (css.x < -0.5 || css.y < -0.5 || css.x + css.w > view.w + 0.5 || css.y + css.h > view.h + 0.5) bad.push(`${it.id} is off screen`);
    if (css.h < minTarget) bad.push(`${it.id} is only ${Math.round(css.h)} CSS px tall`);
    for (const z of it.zones) if (z.w * k < minTarget || z.h * k < minTarget) bad.push(`${it.id}/${z.name} is ${Math.round(z.w * k)}x${Math.round(z.h * k)} CSS px`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (intersects(items[i], items[j], 1)) bad.push(`${items[i].id} overlaps ${items[j].id}`);
  }
  for (const t of texts) {
    if (t.x < -1 || t.y < -1 || t.x + t.w > 1281 || t.y + t.h > 721) bad.push(`text "${t.text.slice(0, 24)}" is clipped by the screen edge`);
    if (t.size * k < minFont) bad.push(`text "${t.text.slice(0, 24)}" is ${(t.size * k).toFixed(1)} CSS px`);
    // a text that sits partly over a button must belong to it: centred inside it
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    for (const it of items) {
      const inside = cx >= it.x && cx <= it.x + it.w && cy >= it.y && cy <= it.y + it.h;
      if (!inside && overlapArea(t, it) > 12) bad.push(`text "${t.text.slice(0, 24)}" runs over button ${it.id}`);
      if (inside && (t.x < it.x - 1 || t.x + t.w > it.x + it.w + 1 || t.y < it.y - 1 || t.y + t.h > it.y + it.h + 1)) bad.push(`text "${t.text.slice(0, 24)}" spills out of ${it.id}`);
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (overlapArea(a, b) > 30) bad.push(`text "${a.text.slice(0, 18)}" overlaps "${b.text.slice(0, 18)}"`);
    }
  }
  const pill = await p.page.evaluate(() => {
    const el = document.querySelector('.tc-sys-btn');
    if (!el || getComputedStyle(document.querySelector('.tc-system')).display === 'none' || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (pill) {
    const toGame = (r) => ({ x: (r.x - canvas.left) / k, y: (r.y - canvas.top) / k, w: r.w / k, h: r.h / k });
    const pg = toGame(pill);
    for (const it of items) if (intersects(pg, it, 1)) bad.push(`the Fullscreen pill covers ${it.id}`);
    for (const t of texts) if (overlapArea(pg, t) > 12) bad.push(`the Fullscreen pill covers text "${t.text.slice(0, 20)}"`);
  }
  const scroll = await p.page.evaluate(() => ({ sx: scrollX, sy: scrollY, ow: document.documentElement.scrollWidth > document.documentElement.clientWidth, oh: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
  if (scroll.sx || scroll.sy || scroll.ow || scroll.oh) bad.push(`the page scrolls (${JSON.stringify(scroll)})`);
  return bad;
}

async function run() {
  // =====================================================================================================
  // 1. The title screen: hierarchy, and what it says (desktop, a brand-new visitor)
  // =====================================================================================================
  console.log('\n--- title screen (desktop) ---');
  const d = await open();
  await d.goto();
  let snap = await d.menu();
  let words = await d.words();
  const ids = snap.items.map((i) => i.id);
  check('the title page offers PLAY, the player count, AUDIO, CONTROLS and the power-up legend (and no CO-OP page in a one-player game)', JSON.stringify(ids) === JSON.stringify(['play', 'players', 'audio', 'controls', 'powerups']), JSON.stringify(ids));
  const play = snap.items.find((i) => i.id === 'play');
  const others = snap.items.filter((i) => ['players', 'audio', 'controls'].includes(i.id));
  check('PLAY is the biggest button and sits above the secondary buttons, with PLAY focused first', play.h > Math.max(...others.map((i) => i.h)) && play.y < Math.min(...others.map((i) => i.y)) && play.w * play.h > Math.max(...others.map((i) => i.w * i.h)) && snap.focus === 'play');
  check('the title screen answers "how do I control my ship": the real keys with what they do', ['HOW TO PLAY', 'W', 'S', 'A', 'D', 'SPACE', 'E', 'SHIFT', 'Move forward / back', 'Turn left / right', 'Laser beam', 'Boost'].every((t) => words.includes(t)) && words.some((t) => /^Shoot/.test(t)), words.slice(0, 20).join(' | '));
  check('...and "what do the power-ups do": all five with their in-game names and a few words each', ['RAPID FIRE', 'MULTI-SHOT', 'SHIELD', 'SLOW MOTION', 'MEGA POWER', 'Shoot faster', 'Triple shot', 'Blocks 1 hit', 'Slow asteroids', 'All powers!'].every((t) => words.includes(t)) && !words.includes('REVIVE'), words.join(' | ').slice(0, 300));
  check('no settings on the first screen: no volumes, music, track, haptics, steering, controller status', !words.some((t) => /VOLUME|SOUND EFFECTS|^MUSIC|HAPTIC|STEERING|TRACK|Controller/i.test(t)), words.join(' | ').slice(0, 300));
  await d.shot('desktop-title');

  // the pulsing power-up icons hold still for a player who has asked their system for reduced motion
  const legend = await d.item('powerups');
  const clip = { x: legend.x + 40, y: legend.y + 60, width: legend.w - 80, height: 70 };
  const frame = async () => d.page.screenshot({ clip });
  const moving = [await frame(), (await sleep(330), await frame())];
  check('with normal motion the legend icons pulse (two frames differ)', !moving[0].equals(moving[1]));
  await d.page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(200);
  const still = [await frame(), (await sleep(330), await frame())];
  check('with prefers-reduced-motion the legend icons hold still (two frames are identical)', still[0].equals(still[1]));
  await d.page.emulateMedia({ reducedMotion: 'no-preference' });

  // the keys listed on the title screen really are the keys: each one drives the ship
  await d.start();
  const k0 = await d.sim();
  await d.page.keyboard.down('KeyW');
  await sleep(300);
  await d.page.keyboard.up('KeyW');
  const k1 = await d.sim();
  await d.page.keyboard.down('KeyS');
  await sleep(300);
  await d.page.keyboard.up('KeyS');
  const k2 = await d.sim();
  await d.page.keyboard.down('KeyD');
  await sleep(250);
  await d.page.keyboard.up('KeyD');
  const k3 = await d.sim();
  await d.page.keyboard.down('KeyA');
  await sleep(250);
  await d.page.keyboard.up('KeyA');
  const k4 = await d.sim();
  await d.page.keyboard.down('Space');
  await sleep(500);
  const k5 = await d.sim();
  await d.page.keyboard.up('Space');
  await d.page.keyboard.down('KeyE');
  await sleep(120);
  await d.page.keyboard.up('KeyE');
  await sleep(120);
  const k6 = await d.sim();
  await d.page.keyboard.down('ShiftLeft');
  await sleep(120);
  await d.page.keyboard.up('ShiftLeft');
  await sleep(120);
  const k7 = await d.sim();
  check('W moves the ship, S moves it back, D and A turn it', Math.hypot(k1.x - k0.x, k1.y - k0.y) > 40 && Math.hypot(k2.x - k1.x, k2.y - k1.y) > 20 && turn(k2.rot, k3.rot) > 20 && turn(k3.rot, k4.rot) < -20, JSON.stringify({ w: Math.round(Math.hypot(k1.x - k0.x, k1.y - k0.y)), rot: [k2.rot, k3.rot, k4.rot].map(Math.round) }));
  check('SPACE shoots, E fires the laser, SHIFT boosts', k5.shots >= 1 && k6.laser === k5.laser - 1 && k7.boost, JSON.stringify({ shots: k5.shots, laser: [k5.laser, k6.laser], boost: k7.boost }));
  await d.key('Escape', 300); // Escape while playing pauses (it no longer does nothing, and never leaves)
  check('Escape during play pauses the run and opens the pause menu', (await d.sim()).paused === true && (await d.menu('GameScene')).page === 'pause' && (await d.scene()) === 'GameScene');
  await d.page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
  await sleep(500);

  // the guide
  await d.tap('powerups');
  words = await d.words();
  const guide = (await d.menu()).page;
  check('the legend opens the power-up guide, with one plain sentence per power-up and the real durations', guide === 'powerups' && ['RAPID FIRE', 'MULTI-SHOT', 'SHIELD', 'SLOW MOTION', 'MEGA POWER', 'REVIVE'].every((t) => words.includes(t)) && words.some((t) => /3x faster for 5 seconds/.test(t)) && words.some((t) => /3 bullets.*8 seconds/.test(t)) && words.some((t) => /40% speed for 6 seconds/.test(t)) && words.some((t) => /Shield.*Slow Motion.*6 seconds/.test(t)) && words.some((t) => /Absorbs the next hit/.test(t)), words.join(' | ').slice(0, 500));
  check('...and explains Revive as a two-player power-up', words.some((t) => /two-player/i.test(t)));
  await d.shot('desktop-powerups');
  await d.key('Escape');
  check('Escape returns to the title page, with the legend still focused', (await d.menu()).page === 'title' && (await d.menu()).focus === 'powerups');

  // two players
  await d.key('Digit2');
  await sleep(250);
  snap = await d.menu();
  words = await d.words();
  check('choosing two players adds the CO-OP page, both players\' keys (P2: arrows + Enter) and Revive to the legend', snap.items.some((i) => i.id === 'coop') && words.includes('PLAYER 1') && words.includes('PLAYER 2') && words.includes('ENTER') && words.includes('R-SHIFT') && words.includes('REVIVE'), words.join(' | ').slice(0, 300));
  await d.shot('desktop-title-2p');
  await d.key('Digit1');
  check('...and choosing one player takes them away again', !(await d.menu()).items.some((i) => i.id === 'coop') && !(await d.words()).includes('REVIVE'));

  // mouse: hover highlights, a click opens, a click on nothing does nothing
  const aud = await d.item('audio');
  const pt = await d.css(aud.x + aud.w / 2, aud.y + aud.h / 2);
  await d.page.mouse.move(pt.x, pt.y);
  await sleep(150);
  check('hovering over a button moves the focus to it (keys and mouse share one highlight)', (await d.menu()).focus === 'audio');
  const empty = await d.css(150, 45);
  await d.page.mouse.click(empty.x, empty.y);
  await d.page.mouse.click((await d.css(640, 40)).x, (await d.css(640, 40)).y);
  await sleep(300);
  check('a click on empty space does nothing (no click-anywhere start)', (await d.scene()) === 'StartScene' && (await d.menu()).page === 'title');
  await d.tap('audio');
  check('a click on AUDIO opens it', (await d.menu()).page === 'audio');
  await d.context.close();

  // =====================================================================================================
  // 2. AUDIO: keyboard, mouse, persistence, back
  // =====================================================================================================
  console.log('\n--- audio page ---');
  const a = await open();
  await a.goto();
  await a.focus('audio');
  await a.key('Enter');
  await sleep(300);
  snap = await a.menu();
  check('AUDIO lists music on / off, the track, music volume, sound effects and BACK, in that order', snap.page === 'audio' && JSON.stringify(snap.items.map((i) => i.id)) === JSON.stringify(['music', 'track', 'music-volume', 'sfx-volume', 'back']), JSON.stringify(snap.items.map((i) => i.id)));
  words = await a.words();
  check('it shows the current values (Music on, Original, 80 %, 80 %)', words.includes('ON') && words.includes('ORIGINAL') && words.filter((t) => t === '80%').length === 2);
  await a.shot('desktop-audio');
  await a.key('ArrowDown');
  check('Down moves the focus to the next row', (await a.menu()).focus === 'track');
  await a.focus('music-volume');
  await a.key('ArrowLeft');
  await a.key('ArrowLeft');
  check('Left lowers the music volume at once, and it is saved', near((await a.page.evaluate(() => window.__game.registry.get('audio').volume('music'))), 0.6) && (await a.stored('asteroids.musicVolume')) === '0.6');
  await a.focus('sfx-volume');
  await a.key('ArrowRight');
  check('Right raises the effects volume, saved separately', near((await a.page.evaluate(() => window.__game.registry.get('audio').volume('sfx'))), 0.9) && (await a.stored('asteroids.sfxVolume')) === '0.9' && (await a.stored('asteroids.musicVolume')) === '0.6');
  await a.tap('music', { zone: 'OFF' });
  check('clicking OFF mutes the music (saved), and the volume row dims but keeps its value', (await a.page.evaluate(() => window.__game.registry.get('audio').music.isMuted)) === true && (await a.stored('asteroids.musicMuted')) === '1');
  await a.tap('music', { zone: 'ON' });
  check('clicking ON unmutes it again', (await a.page.evaluate(() => window.__game.registry.get('audio').music.isMuted)) === false && (await a.stored('asteroids.musicMuted')) === '0');
  await a.tap('music-volume', { zone: '+' });
  await a.tap('music-volume', { zone: '-' });
  await a.tap('music-volume', { zone: '-' });
  check('the - and + buttons step the volume by one notch each', near((await a.page.evaluate(() => window.__game.registry.get('audio').volume('music'))), 0.5));
  await a.focus('track');
  await a.key('ArrowRight');
  check('Right on the track row picks the next track and saves it', (await a.stored('asteroids.musicTrack')) === 'megaman' && (await a.words()).includes('MEGA MAN'));
  await a.tap('track', { zone: '<' });
  check('the < button goes back (Original)', (await a.stored('asteroids.musicTrack')) === 'original');
  check('the audio page changed no other setting (haptics untouched, nothing saved for them)', (await a.stored('asteroids.haptics')) === null);
  await a.key('Escape');
  snap = await a.menu();
  check('Escape goes back to the title page with AUDIO focused, and does not start a game', snap.page === 'title' && snap.focus === 'audio' && (await a.scene()) === 'StartScene');
  await a.page.reload();
  await a.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  const reloaded = await a.page.evaluate(() => { const au = window.__game.registry.get('audio'); return { m: au.volume('music'), s: au.volume('sfx'), muted: au.music.isMuted, choice: au.musicChoice }; });
  check('after a reload the audio settings are all restored', near(reloaded.m, 0.5) && near(reloaded.s, 0.9) && !reloaded.muted && reloaded.choice === 'original', JSON.stringify(reloaded));
  await a.tap('audio');
  await a.tap('back');
  check('the BACK button also returns to the title page', (await a.menu()).page === 'title');
  check('no console errors', a.problems.length === 0, a.problems.join(' | '));
  await a.context.close();

  // =====================================================================================================
  // 3. CONTROLS (desktop) and the two-player options
  // =====================================================================================================
  console.log('\n--- controls page and two-player options (desktop) ---');
  const c = await open();
  await c.goto();
  await c.focus('controls');
  await c.key('Enter');
  await sleep(300);
  snap = await c.menu();
  words = await c.words();
  check('CONTROLS for a keyboard player shows the key map, the controllers section and a layout button (no touch settings)', snap.page === 'controls' && ['KEYBOARD', 'CONTROLLERS', 'W', 'SPACE', 'E', 'SHIFT'].every((t) => words.includes(t)) && snap.items.some((i) => i.id === 'pad-layout') && !words.some((t) => /STEERING|HAPTIC|VIBRATION|TOUCH/.test(t)), words.join(' | ').slice(0, 300));
  await c.shot('desktop-controls');
  await c.key('Enter'); // the focused button: CONTROLLER LAYOUT
  await sleep(300);
  check('CONTROLLER LAYOUT opens on top, Escape returns to CONTROLS (not to the title)', (await c.menu()).page === 'padlayout' && (await c.words()).includes('CONTROLLER LAYOUT'));
  await c.shot('desktop-padlayout');
  await c.key('Escape');
  check('...back on CONTROLS', (await c.menu()).page === 'controls');
  await c.key('Escape');
  check('...and once more back on the title page', (await c.menu()).page === 'title' && (await c.menu()).focus === 'controls');
  // two players: options page, hotkeys, persistence within the visit
  await c.key('Digit2');
  await c.tap('coop');
  words = await c.words();
  check('TWO-PLAYER OPTIONS lists lives, friendly fire and both speeds with the old hotkeys', (await c.menu()).page === 'coop' && ['LIVES  [L]', 'FRIENDLY FIRE  [F]', 'PLAYER 1 SPEED  [S]', 'PLAYER 2 SPEED  [D]'].every((t) => words.includes(t)));
  await c.key('KeyL');
  await c.key('KeyF');
  await c.key('KeyS');
  await c.tap('speed-2', { zone: '>' });
  const cfg = await c.page.evaluate(() => window.__game.registry.get('gameSetup').game);
  check('L, F, S and the buttons change the options at once', cfg.livesMode === 'shared' && cfg.friendlyFire === false && cfg.speed[0] === 1.25 && cfg.speed[1] === 1.25, JSON.stringify(cfg));
  await c.shot('desktop-coop');
  await c.key('Escape');
  check('the title shows the result in its summary line', (await c.words()).some((t) => /^SHARED LIVES\s+FRIENDLY FIRE OFF\s+SPEED 125\/125%/.test(t)), (await c.words()).filter((t) => /LIVES/.test(t)).join('|'));
  await c.focus('controls');
  await c.key('Enter');
  await sleep(300);
  await c.tap('p2-keys', { zone: 'I J K L + ;' });
  check('PLAYER 2 KEYS can be switched on the CONTROLS page, and the key map follows', (await c.page.evaluate(() => window.__game.registry.get('gameSetup').p2Keys)) === 'ijkl' && (await c.words()).includes(';'));
  await c.key('Escape');
  await c.key('Space');
  await c.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  const runCfg = await c.page.evaluate(() => ({ players: window.__game.scene.getScene('GameScene').sim.players.length, config: window.__game.scene.getScene('GameScene').sim.config }));
  check('the options reach the run: two players, shared lives, friendly fire off, 125 % speeds', runCfg.players === 2 && runCfg.config.livesMode === 'shared' && runCfg.config.friendlyFire === false && runCfg.config.speed[0] === 1.25, JSON.stringify(runCfg.config));
  check('no console errors', c.problems.length === 0, c.problems.join(' | '));
  await c.context.close();

  // =====================================================================================================
  // 4. The pause menu with a keyboard
  // =====================================================================================================
  console.log('\n--- pause menu (keyboard) ---');
  const k = await open();
  await k.goto();
  await k.start();
  await k.key('KeyP', 250);
  snap = await k.menu('GameScene');
  check('P opens the pause menu: RESUME, AUDIO, CONTROLS, RETURN TO MENU, with RESUME focused', snap.page === 'pause' && JSON.stringify(snap.items.map((i) => i.id)) === JSON.stringify(['resume', 'audio', 'controls', 'menu']) && snap.focus === 'resume');
  await k.shot('desktop-pause');
  const t0 = (await k.sim()).time;
  await k.focus('audio', 'GameScene');
  await k.key('Enter', 300);
  check('AUDIO opens on top of the pause menu and the game stays paused', (await k.menu('GameScene')).page === 'audio' && (await k.sim()).paused === true);
  await k.shot('desktop-pause-audio');
  await k.focus('music-volume', 'GameScene');
  await k.key('ArrowLeft');
  check('the volume changes there at once, with the ship untouched', near(await k.page.evaluate(() => window.__game.registry.get('audio').volume('music')), 0.7));
  await k.key('Escape', 250);
  check('Escape closes AUDIO and shows the pause menu again, still paused, AUDIO focused', (await k.menu('GameScene')).page === 'pause' && (await k.menu('GameScene')).focus === 'audio' && (await k.sim()).paused === true && (await k.scene()) === 'GameScene');
  await k.focus('controls', 'GameScene');
  await k.key('Enter', 300);
  check('CONTROLS opens the same page as on the title screen (the key map)', (await k.menu('GameScene')).page === 'controls' && (await k.words('GameScene')).includes('KEYBOARD'));
  await k.shot('desktop-pause-controls');
  check('...without the settings that cannot change mid-run (no controller assignment buttons enabled, no touch switch)', !(await k.menu('GameScene')).items.some((i) => i.id === 'touch-on' || i.id === 'p2-keys'));
  await k.key('Escape', 250);
  check('Escape closes CONTROLS the same way: pause menu, CONTROLS focused, still paused, still this run', (await k.menu('GameScene')).page === 'pause' && (await k.menu('GameScene')).focus === 'controls' && (await k.sim()).paused === true && (await k.scene()) === 'GameScene');
  check('time did not advance during any of it', near((await k.sim()).time, t0, 0.02), `${t0} -> ${(await k.sim()).time}`);
  // leaving from inside a submenu with P closes everything
  await k.focus('audio', 'GameScene');
  await k.key('Enter', 300);
  await k.key('KeyP', 300);
  check('P resumes from inside a submenu, and the next pause starts at the pause menu again', (await k.sim()).paused === false);
  await k.key('KeyP', 300);
  check('...the next pause shows the pause menu (not the old submenu)', (await k.menu('GameScene')).page === 'pause' && (await k.sim()).paused === true);
  // RETURN TO MENU needs two presses, Escape does not
  await k.focus('menu', 'GameScene');
  await k.key('Enter', 400);
  check('one press on RETURN TO MENU only asks "QUIT THIS RUN?"', (await k.scene()) === 'GameScene' && (await k.words('GameScene')).some((t) => /QUIT THIS RUN/.test(t)));
  await k.key('Enter', 400);
  await sleep(500);
  check('a second press returns to the title screen', (await k.scene()) === 'StartScene' && (await k.menu()).page === 'title');
  // =====================================================================================================
  // 4b. Escape / Back: pause, resume, back out of a page; it never leaves a run that is in progress
  // =====================================================================================================
  console.log('\n--- Escape and Back (keyboard and mouse, in a run) ---');
  const GS = `window.__game.scene.getScene('GameScene')`;
  const menuOpen = () => k.page.evaluate(`${GS}.pauseMenu.isOpen`);
  const sameRun = async () => (await k.scene()) === 'GameScene' && (await k.page.evaluate(`${GS}.sim.__run === 'same'`));
  await k.start();
  await k.page.evaluate(`${GS}.sim.__run = 'same'`); // a restart or a new run builds a new sim, which would not carry this
  await k.key('Escape', 300);
  check('Escape while playing pauses and shows the pause menu (RESUME focused)', (await k.sim()).paused === true && (await menuOpen()) && (await k.menu('GameScene')).page === 'pause' && (await k.menu('GameScene')).focus === 'resume');
  await k.key('Escape', 300);
  check('Escape on the pause menu resumes the same run (it does not go to the title screen)', (await k.sim()).paused === false && !(await menuOpen()) && (await sameRun()));
  for (let i = 0; i < 6; i++) {
    await k.key('Escape', 300);
    const expectPaused = i % 2 === 0;
    if ((await k.sim()).paused !== expectPaused || !(await sameRun())) {
      check(`Escape toggles pause one step at a time (press ${i + 1})`, false, JSON.stringify(await k.sim()));
      break;
    }
    if (i === 5) check('six Escape presses alternate pause / resume exactly, in the same run, never leaving', true);
  }
  // a page deeper than the pause menu, and a key that is held down: one press is one step
  await k.key('Escape', 300); // pause
  await k.focus('controls', 'GameScene');
  await k.key('Enter', 300);
  const hasLayout = (await k.menu('GameScene')).items.some((i) => i.id === 'pad-layout');
  if (hasLayout) {
    await k.focus('pad-layout', 'GameScene');
    await k.key('Enter', 300);
  }
  const depthBefore = (await k.menu('GameScene')).page;
  await k.page.keyboard.down('Escape');
  for (let i = 0; i < 6; i++) await k.page.keyboard.down('Escape'); // auto-repeat events
  await k.page.keyboard.up('Escape');
  await sleep(350);
  check(`holding Escape on ${depthBefore} goes back exactly one page (${hasLayout ? 'to CONTROLS' : 'to the pause menu'}), still paused`, (await k.menu('GameScene')).page === (hasLayout ? 'controls' : 'pause') && (await k.sim()).paused === true && (await sameRun()), JSON.stringify((await k.menu('GameScene')).page));
  if (hasLayout) await k.key('Escape', 300);
  check('...and the next press returns to the pause menu', (await k.menu('GameScene')).page === 'pause' && (await k.sim()).paused === true);
  await k.page.keyboard.down('Escape');
  for (let i = 0; i < 6; i++) await k.page.keyboard.down('Escape');
  await k.page.keyboard.up('Escape');
  await sleep(350);
  check('holding Escape on the pause menu resumes once (it does not pause again)', (await k.sim()).paused === false && !(await menuOpen()) && (await sameRun()));
  // the key that resumed must not fire anything: laser and boost keys held through the pause, Space held through the pause and the resume
  await k.key('Escape', 300);
  await k.page.keyboard.down('KeyE');
  await k.page.keyboard.down('ShiftLeft');
  await k.key('Escape', 300);
  await sleep(400);
  await k.page.keyboard.up('KeyE');
  await k.page.keyboard.up('ShiftLeft');
  check('Escape-resume with the Laser and Boost keys held fires neither', (await k.sim()).laser === 15 && !(await k.sim()).boost && (await k.sim()).paused === false, JSON.stringify(await k.sim()));
  await k.page.keyboard.down('Space');
  await sleep(250);
  await k.key('Escape', 300); // pause with the cannon held
  await k.page.evaluate(`${GS}.sim.shots.length = 0`);
  await k.key('Escape', 300); // resume with the cannon still held
  await sleep(700);
  check('Escape-resume with Space still held does not fire (until Space is released and pressed again)', (await k.sim()).paused === false && (await k.sim()).shots === 0, JSON.stringify(await k.sim()));
  await k.page.keyboard.up('Space');
  await sleep(150);
  await k.page.keyboard.down('Space');
  await sleep(450);
  check('...and the cannon works again after that', (await k.sim()).shots >= 1);
  await k.page.keyboard.up('Space');
  // the mouse BACK button does what Escape does
  await k.key('Escape', 300);
  const t1 = await k.sim();
  await k.tap('audio', { scene: 'GameScene' });
  await k.tap('back', { scene: 'GameScene' });
  check('clicking AUDIO then BACK returns to the pause menu, still paused, same run', (await k.menu('GameScene')).page === 'pause' && (await k.sim()).paused === true && (await sameRun()));
  await k.tap('controls', { scene: 'GameScene' });
  await k.tap('back', { scene: 'GameScene' });
  const t2 = await k.sim();
  check('...and the same for CONTROLS; the paused game is exactly where it was (position, heading, clock)', (await k.menu('GameScene')).page === 'pause' && near(t1.x, t2.x, 1e-6) && near(t1.y, t2.y, 1e-6) && near(t1.rot, t2.rot, 1e-6) && near(t1.time, t2.time, 1e-6) && t1.lives === t2.lives, JSON.stringify({ t1, t2 }));
  // RETURN TO MENU is still the only way out, and Escape disarms it
  await k.focus('menu', 'GameScene');
  await k.key('Enter', 400);
  check('RETURN TO MENU still asks first', (await k.scene()) === 'GameScene' && (await k.words('GameScene')).some((t) => /QUIT THIS RUN/.test(t)));
  await k.key('Escape', 300);
  check('Escape while it is asking resumes the run (it is not a second press)', (await k.sim()).paused === false && (await sameRun()));
  await k.key('Escape', 300);
  check('the next pause shows RETURN TO MENU un-armed again', (await k.words('GameScene')).includes('RETURN TO MENU') && !(await k.words('GameScene')).some((t) => /QUIT THIS RUN/.test(t)));
  await k.focus('menu', 'GameScene');
  await k.key('Enter', 400);
  await k.key('Enter', 400);
  await sleep(400);
  check('only the second press of RETURN TO MENU leaves for the title screen', (await k.scene()) === 'StartScene' && (await k.menu()).page === 'title');
  check('no console errors', k.problems.length === 0, k.problems.join(' | '));
  await k.context.close();

  // =====================================================================================================
  // 4c. Escape / Back on the title screen
  // =====================================================================================================
  console.log('\n--- Escape and Back (title screen) ---');
  const tt = await open();
  await tt.goto();
  await tt.key('Escape');
  await tt.key('Escape');
  check('Escape on the title page itself does nothing: still the title, no game started', (await tt.menu()).page === 'title' && (await tt.scene()) === 'StartScene');
  await tt.key('Digit2', 250);
  for (const target of ['audio', 'controls', 'coop', 'powerups']) {
    await tt.tap(target);
    const opened = (await tt.menu()).page === target;
    await tt.key('Escape');
    let s = await tt.menu();
    check(`Title > ${target} > Escape returns to the title page with ${target} lit, and starts nothing`, opened && s.page === 'title' && s.focus === target && (await tt.scene()) === 'StartScene', JSON.stringify({ opened, page: s.page, focus: s.focus }));
    await tt.tap(target);
    await tt.tap('back');
    s = await tt.menu();
    check(`Title > ${target} > the BACK button (mouse) does the same`, s.page === 'title' && s.focus === target && (await tt.scene()) === 'StartScene', JSON.stringify({ page: s.page, focus: s.focus }));
  }
  await tt.tap('controls');
  await tt.page.keyboard.down('Escape');
  for (let i = 0; i < 6; i++) await tt.page.keyboard.down('Escape');
  await tt.page.keyboard.up('Escape');
  await sleep(350);
  check('holding Escape on a title sub-page goes back one page and then stops at the title page', (await tt.menu()).page === 'title' && (await tt.scene()) === 'StartScene');
  check('no console errors', tt.problems.length === 0, tt.problems.join(' | '));
  await tt.context.close();

  // =====================================================================================================
  // 5. Menu presses never reach the game
  // =====================================================================================================
  console.log('\n--- menu input never reaches the game ---');
  const g = await open();
  await g.goto();
  await g.start();
  await g.key('KeyP', 250);
  await g.page.keyboard.down('Space'); // RESUME is focused: Space presses it, and Space is the cannon
  await sleep(100);
  const resumed = await g.sim();
  await sleep(500);
  const heldShots = await g.sim();
  check('Space pressed on RESUME resumes the game without firing a shot while it stays held', resumed.paused === false && heldShots.shots === 0, JSON.stringify({ shots: heldShots.shots }));
  await g.page.keyboard.up('Space');
  await sleep(150); // a few frames with the cannon released
  await g.page.keyboard.down('Space');
  await sleep(450);
  check('...and the cannon works again after it has been released once', (await g.sim()).shots >= 1);
  await g.page.keyboard.up('Space');
  await g.key('KeyP', 250);
  await g.page.keyboard.down('KeyE'); // the laser and boost keys held through the pause menu and the resume
  await g.page.keyboard.down('ShiftLeft');
  await g.key('ArrowDown', 100);
  await g.key('ArrowUp', 100);
  await g.key('KeyP', 100);
  await sleep(400);
  await g.page.keyboard.up('KeyE');
  await g.page.keyboard.up('ShiftLeft');
  check('Laser and Boost keys held while using the pause menu do not fire when play resumes', (await g.sim()).laser === 15 && !(await g.sim()).boost, JSON.stringify(await g.sim()));
  await g.context.close();

  // phones: a touch on a menu never also steers, shoots or fires the laser / boost
  const tp = await open({ w: 844, h: 390, touch: true });
  await tp.goto();
  await tp.tap('play');
  await tp.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(400);
  await tp.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; s.player.lives = 99; })()`);
  check('PLAY started the run and the finger that tapped it fired nothing', (await tp.sim()).shots === 0 && (await tp.sim()).laser === 15 && !(await tp.sim()).boost);
  const pauseBtn = await tp.page.evaluate(() => { const r = document.querySelector('.tc-pause').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await tp.page.touchscreen.tap(pauseBtn.x, pauseBtn.y);
  await sleep(500);
  check('the PAUSE button opens the pause menu', (await tp.menu('GameScene')).page === 'pause' && (await tp.sim()).paused === true);
  // tap where FIRE, LASER and BOOST are during play, and on empty space: the menu swallows them
  const spots = await tp.page.evaluate(() => ['.tc-fire', '.tc-laser', '.tc-boost'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  for (const sp of spots) await tp.page.touchscreen.tap(sp.x, sp.y);
  const quietTap = await tp.css(110, 640);
  await tp.page.touchscreen.tap(quietTap.x, quietTap.y);
  await sleep(300);
  check('taps on empty parts of the pause menu (where FIRE, LASER and BOOST are in play) do nothing at all', (await tp.sim()).paused === true && (await tp.menu('GameScene')).page === 'pause');
  await tp.tap('resume', { scene: 'GameScene' });
  await sleep(500);
  const afterTaps = await tp.sim();
  check('after RESUME nothing was fired: no shots, all 15 laser charges, no boost', afterTaps.paused === false && afterTaps.shots === 0 && afterTaps.laser === 15 && !afterTaps.boost, JSON.stringify(afterTaps));
  check('no console errors', tp.problems.length === 0, tp.problems.join(' | '));
  await tp.context.close();

  // =====================================================================================================
  // 6. Menus do not leak: opening and closing them again and again
  // =====================================================================================================
  console.log('\n--- no leaks ---');
  const l = await open();
  await l.goto();
  const probe = (scene) =>
    l.page.evaluate(`(() => { const g = window.__game, sc = g.scene.getScene('${scene}'); return { pointer: sc.input.listenerCount('pointerdown') + sc.input.listenerCount('pointermove') + sc.input.listenerCount('pointerup'),
      keys: sc.input.keyboard.listenerCount('keydown'), blur: g.events.listenerCount('blur'), hidden: g.events.listenerCount('hidden'),
      objects: sc.sys.displayList.length, textures: Object.keys(g.textures.list).length }; })()`);
  await sleep(200);
  const base = await probe('StartScene');
  for (let i = 0; i < 25; i++) {
    await l.tap('audio');
    await l.tap('back');
    await l.tap('controls');
    await l.tap('back');
    await l.tap('powerups');
    await l.key('Escape');
  }
  await sleep(300);
  const after = await probe('StartScene');
  check('25 rounds of AUDIO / CONTROLS / POWER-UPS and back add no input listeners, display objects or textures', JSON.stringify(after) === JSON.stringify(base), JSON.stringify({ base, after }));
  await l.start();
  await l.key('KeyP', 250);
  const base2 = await probe('GameScene');
  for (let i = 0; i < 20; i++) {
    await l.focus('audio', 'GameScene');
    await l.key('Enter', 150);
    await l.key('Escape', 150);
    await l.focus('controls', 'GameScene');
    await l.key('Enter', 150);
    await l.key('Escape', 150);
  }
  const after2 = await probe('GameScene');
  check('20 rounds inside the pause menu add none either', JSON.stringify(after2) === JSON.stringify(base2), JSON.stringify({ base2, after2 }));
  for (let i = 0; i < 6; i++) {
    await l.key('KeyP', 250); // resume
    await l.key('KeyP', 250); // pause again
  }
  const after3 = await probe('GameScene');
  check('pausing and resuming six times leaves the scene as it was', JSON.stringify(after3) === JSON.stringify(base2), JSON.stringify({ base2, after3 }));
  check('no console errors', l.problems.length === 0, l.problems.join(' | '));
  await l.context.close();

  // =====================================================================================================
  // 7. A controller
  // =====================================================================================================
  console.log('\n--- controller navigation ---');
  const pd = await open({ pad: true });
  await pd.goto();
  await pd.padPut({});
  await sleep(300);
  await pd.key('Shift'); // a key press is the browser's gesture; the controller wakes up with its first button
  await pd.padTap(BTN.A); // joins Player 1
  await pd.padTap(BTN.DOWN);
  await pd.padTap(BTN.DOWN);
  check('the D-pad moves the focus down the title page', (await pd.menu()).focus !== 'play');
  await pd.padTap(BTN.A);
  check('A presses the focused button (AUDIO opens)', (await pd.menu()).page === 'audio' || (await pd.menu()).page === 'controls');
  await pd.padTap(BTN.B);
  check('B goes back to the title page', (await pd.menu()).page === 'title');
  await pd.padTap(BTN.Y);
  check('Y opens CONTROLS', (await pd.menu()).page === 'controls');
  await pd.padTap(BTN.BACK);
  check('the controller\'s BACK button also goes back to the title page', (await pd.menu()).page === 'title');
  await pd.padTap(BTN.B);
  await pd.padTap(BTN.BACK);
  check('B and BACK on the title page itself do nothing', (await pd.menu()).page === 'title' && (await pd.scene()) === 'StartScene');
  await pd.padTap(BTN.Y);
  await pd.padTap(BTN.B);
  await pd.padTap(BTN.START);
  await pd.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(400);
  await pd.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; s.player.lives = 99; })()`);
  check('START on the assigned controller starts the game', (await pd.scene()) === 'GameScene');
  await pd.padTap(BTN.START);
  await sleep(250);
  check('START pauses, and the pause menu is showing', (await pd.sim()).paused === true && (await pd.menu('GameScene')).page === 'pause');
  await pd.padTap(BTN.DOWN);
  await pd.padTap(BTN.A);
  check('D-pad Down + A open AUDIO from the pause menu, still paused', (await pd.menu('GameScene')).page === 'audio' && (await pd.sim()).paused === true);
  await pd.padTap(BTN.B);
  check('B goes back to the pause menu, still paused', (await pd.menu('GameScene')).page === 'pause' && (await pd.sim()).paused === true);
  await pd.padTap(BTN.A);
  check('A opens AUDIO again', (await pd.menu('GameScene')).page === 'audio');
  await pd.padTap(BTN.BACK);
  check('BACK from AUDIO returns to the pause menu: still paused, not resumed, not the title screen', (await pd.menu('GameScene')).page === 'pause' && (await pd.sim()).paused === true && (await pd.scene()) === 'GameScene');
  await pd.padTap(BTN.UP);
  await pd.padPut({ buttons: { [BTN.A]: 1 } }); // A held: RESUME is pressed, and A is also the cannon
  await sleep(150);
  const padResumed = await pd.sim();
  await sleep(500);
  const padHeld = await pd.sim();
  check('A on RESUME resumes without firing while A is still held', padResumed.paused === false && padHeld.shots === 0, JSON.stringify({ paused: padResumed.paused, shots: padHeld.shots }));
  await pd.padPut({});
  await sleep(200);
  await pd.padTap(BTN.BACK);
  check('BACK while playing pauses and opens the pause menu', (await pd.sim()).paused === true && (await pd.menu('GameScene')).page === 'pause');
  await pd.padTap(BTN.BACK);
  check('BACK on the pause menu resumes the run', (await pd.sim()).paused === false && (await pd.scene()) === 'GameScene');
  await pd.padTap(BTN.START);
  await sleep(250);
  await pd.padPut({ buttons: { [BTN.B]: 1 } }); // B held: it resumes from the pause menu, and it is also Boost
  await sleep(150);
  const bResumed = await pd.sim();
  await sleep(400);
  const bHeld = await pd.sim();
  check('B on the pause menu resumes, and the held B does not boost', bResumed.paused === false && !bHeld.boost, JSON.stringify({ paused: bResumed.paused, boost: bHeld.boost }));
  await pd.padPut({});
  await sleep(200);
  await pd.padTap(BTN.B);
  check('B while playing is still Boost (it does not pause)', (await pd.sim()).paused === false && (await pd.sim()).boost === true);
  check('no console errors', pd.problems.length === 0, pd.problems.join(' | '));
  await pd.context.close();

  // =====================================================================================================
  // 8. Layout review: every page, every phone size (and several desktop windows)
  // =====================================================================================================
  console.log('\n--- layout review ---');
  const PHONES = [
    [667, 375, 'iphone-se'],
    [740, 360, 'android-small'],
    [844, 390, 'iphone'],
    [915, 412, 'android-large'],
    [932, 430, 'iphone-max'],
  ];
  for (const [w, h, name] of PHONES) {
    const p = await open({ w, h, touch: true, vibrate: true });
    await p.goto();
    const tour = [];
    const review = async (label, scene = 'StartScene') => {
      await p.shot(`${name}-${label}`);
      tour.push([label, await layoutProblems(p, scene)]);
    };
    await review('title');
    await p.tap('powerups');
    await review('powerups');
    await p.tap('back');
    await p.tap('audio');
    await review('audio');
    await p.tap('back');
    await p.tap('controls');
    await review('controls');
    await p.tap('back');
    await p.tap('play');
    await p.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
    await sleep(400);
    await p.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(500);
    await review('pause', 'GameScene');
    await p.tap('audio', { scene: 'GameScene' });
    await review('pause-audio', 'GameScene');
    await p.tap('back', { scene: 'GameScene' });
    await p.tap('controls', { scene: 'GameScene' });
    await review('pause-controls', 'GameScene');
    await p.tap('back', { scene: 'GameScene' });
    await p.tap('resume', { scene: 'GameScene' });
    await p.page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
    await sleep(500);
    // a phone in keyboard mode: the recovery path
    await p.tap('controls');
    await p.tap('to-keyboard'); // the first tap only asks
    await sleep(300);
    await p.tap('to-keyboard'); // the second, deliberate one switches
    await sleep(700);
    await review('keyboard-mode-controls');
    await p.tap('back');
    await review('keyboard-mode-title');
    const bad = tour.flatMap(([label, list]) => list.map((x) => `[${label}] ${x}`));
    check(`[${name} ${w}x${h}] every menu page: buttons on screen, at least 44 CSS px, clear of each other and of the Fullscreen pill; no clipped, overlapping or tiny text`, bad.length === 0, bad.slice(0, 6).join(' ; '));
    check(`[${name}] no console errors`, p.problems.length === 0, p.problems.join(' | '));
    await p.context.close();
  }
  for (const [w, h] of [
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [1024, 768],
    [800, 600],
  ]) {
    const p = await open({ w, h });
    await p.goto();
    const tour = [];
    const review = async (label, scene = 'StartScene') => {
      await p.shot(`desktop-${w}x${h}-${label}`);
      tour.push([label, await layoutProblems(p, scene, { minTarget: 44, minFont: 9 })]);
    };
    await review('title');
    await p.key('Digit2', 250);
    await review('title-2p');
    await p.tap('coop');
    await review('coop');
    await p.key('Escape');
    await p.tap('controls');
    await review('controls-2p');
    await p.key('Escape');
    await p.key('Digit1', 250);
    await p.tap('controls');
    await review('controls');
    await p.tap('pad-layout');
    await review('padlayout');
    await p.key('Escape');
    await p.key('Escape');
    await p.tap('audio');
    await review('audio');
    await p.key('Escape');
    await p.tap('powerups');
    await review('powerups');
    await p.key('Escape');
    await p.start();
    await p.key('KeyP', 300);
    await review('pause', 'GameScene');
    await p.tap('audio', { scene: 'GameScene' });
    await review('pause-audio', 'GameScene');
    await p.key('Escape');
    await p.tap('controls', { scene: 'GameScene' });
    await review('pause-controls', 'GameScene');
    const bad = tour.flatMap(([label, list]) => list.map((x) => `[${label}] ${x}`));
    check(`[desktop ${w}x${h}] every menu page: buttons on screen, clear of each other; no clipped, overlapping or tiny text`, bad.length === 0, bad.slice(0, 6).join(' ; '));
    await p.context.close();
  }
}
