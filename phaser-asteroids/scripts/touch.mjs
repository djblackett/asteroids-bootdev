// Touch-screen browser tests: drives the production build in a real (headless) Chrome with mobile emulation (touch, coarse pointer,
// device pixel ratio 2) and genuine MULTI-touch: several fingers at once through Chromium's Input.dispatchTouchEvent, not
// sequential taps. Covers the touch-only path from title screen to game over, steering + FIRE together, LASER / BOOST,
// pause / resume, rotation, focus loss, cancelled touches, the layout on several phone sizes, input-mode selection and the
// guarantee that the desktop game is unchanged.
//
//   npm run test:touch          (builds first)
//   node scripts/touch.mjs      (reuse an existing build in dist/)
//
// What this proves and what it does not: it proves the game's touch pipeline, layout and lifecycle in Chromium's touch emulation.
// It does NOT prove how it feels under a real thumb, on a real GPU, or in iOS Safari / Android Chrome (see docs/mobile-touch.md,
// "Manual testing"). Screenshots go to scripts/.smoke-output/touch-*.png (git-ignored) for visual inspection.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.TOUCH_PORT ?? 4405);
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

const VISIBLE_TEXTS = `(scene) => { const out = []; const walk = (list, visible) => { for (const c of list) { const v = visible && c.visible; if (c.type === 'Text' && v && c.text) out.push(c.text); if (c.list) walk(c.list, v); } }; walk(scene.children.list, true); return out; }`;
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
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

let browser;
try {
  await waitForServer();
  // Default autoplay policy on purpose: audio must start locked and be unlocked by a real touch.
  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await run(browser);
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed  (touch EMULATION in headless Chromium; no real phone, iOS Safari or GPU)`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

/** One mobile-emulated page with a multi-touch emulator and the usual helpers. */
async function mobilePage(width, height, { query = '?debug', mobile = true, touch = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: touch });
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => {
    requests.push({ url: r.url(), status: r.status() });
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const cdp = touch ? await context.newCDPSession(page) : null;

  const pts = new Map();
  const send = (type) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  const finger = {
    async down(id, x, y) {
      pts.set(id, { x, y });
      await send('touchStart');
    },
    async move(id, x, y) {
      pts.set(id, { x, y });
      await send('touchMove');
    },
    // In Chromium's CDP, touchEnd lists the points that are LIFTED (not the ones that remain), so a single finger can leave
    // while the others stay down; touchCancel takes no points and cancels them all.
    async up(id) {
      const p = pts.get(id);
      pts.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
    },
    async cancelAll() {
      pts.clear();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); // cancels every active touch
    },
    async tap(x, y, ms = 70) {
      const id = 900 + Math.floor(Math.random() * 90);
      await finger.down(id, x, y);
      await sleep(ms);
      await finger.up(id);
    },
    get count() {
      return pts.size;
    },
  };

  const api = {
    context,
    page,
    finger,
    problems,
    requests,
    width,
    height,
    shot: (name) => page.screenshot({ path: path.join(outDir, `touch-${name}.png`) }),
    /** Canvas game coordinates (1280x720) -> CSS pixels. */
    css: (x, y) =>
      page.evaluate(
        ([x, y]) => {
          const c = document.querySelector('canvas').getBoundingClientRect();
          return { x: c.left + (x * c.width) / 1280, y: c.top + (y * c.height) / 720 };
        },
        [x, y],
      ),
    tapGame: async (x, y) => {
      const p = await api.css(x, y);
      await finger.tap(p.x, p.y);
    },
    /** Centre of a DOM control, CSS pixels. */
    centre: (selector) =>
      page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector),
    rect: (selector) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: cs.display };
      }, selector),
    cmd: () => page.evaluate(`window.__game.registry.get('touchControls').command()`),
    scene: (name = 'GameScene') => `window.__game.scene.getScene('${name}')`,
    sim: () =>
      page.evaluate(`(() => { const sc = window.__game.scene.getScene('GameScene'), s = sc.sim, p = s.player; return {
        x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, score: p.score, phase: s.phase, shots: s.shots.length,
        laser: p.laser.shotsRemaining, boost: p.boost.active, boostCd: p.boost.cooldown, retry: s.retryDelay, paused: sc.paused, time: s.time }; })()`),
    quiet: () =>
      page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; s.shots.length = 0; s.startCooldown = 0; })()`),
    audio: () =>
      page.evaluate(`(() => { const g = window.__game, a = g.registry.get('audio'), m = a.musicSound;
        return { locked: g.sound.locked, ctx: g.sound.context ? g.sound.context.state : 'n/a', playing: !!m && m.isPlaying, paused: !!m && m.isPaused,
          instances: g.sound.sounds.filter((s) => s.key === 'music').length, vm: a.volume('music'), vs: a.volume('sfx'), muted: a.music.isMuted }; })()`),
    activeScene: () => page.evaluate(() => ['BootScene', 'StartScene', 'GameScene'].find((n) => window.__game.scene.isActive(n))),
    /** Every visible Text in a scene, including those inside containers (the pause / game-over overlays). */
    texts: (name = 'GameScene') => page.evaluate(`(${VISIBLE_TEXTS})(window.__game.scene.getScene('${name}'))`),
    bodyClasses: () => page.evaluate(() => [...document.body.classList]),
    scrollState: () =>
      page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight })),
    start: async () => {
      await page.goto(`${BASE}${query}`);
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      await sleep(250);
    },
    /** Taps TAP TO PLAY and waits for the run. */
    play: async () => {
      await api.tapGame(940, 190);
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
      await sleep(350);
    },
    overlayShown: async () => (await api.rect('.tc-root')).display !== 'none',
  };
  return api;
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function run() {
  // =====================================================================================================
  // 1. A phone in landscape: load, touch-only start, layout, HUD
  // =====================================================================================================
  const m = await mobilePage(844, 390);
  await m.start();
  check('loads on a landscape phone viewport (WebGL, 1280x720 logical)', await m.page.evaluate(() => window.__game.renderer.type === 2 && window.__game.scale.width === 1280));
  check('touch mode is selected automatically on a coarse-pointer device', (await m.bodyClasses()).includes('tc-active'));
  const titleTexts = await m.texts('StartScene');
  check('the title screen is the touch one (TAP TO PLAY, no keyboard instructions)', titleTexts.includes('TAP TO PLAY') && !titleTexts.some((t) => /SPACE|click to start/.test(t)), titleTexts.join(' | ').slice(0, 160));
  check('the title screen explains the controls briefly and offers volume and a CONTROLS switch', titleTexts.some((t) => t.startsWith('LEFT SIDE')) && titleTexts.some((t) => t.startsWith('FIRE')) && titleTexts.includes('MUSIC') && titleTexts.includes('SFX') && titleTexts.some((t) => t.startsWith('CONTROLS: TOUCH')));
  check('no touch controls are drawn on the title screen', !(await m.overlayShown()));
  const a0 = await m.audio();
  check('audio starts locked, music not yet playing', a0.locked === true && !a0.playing, JSON.stringify(a0));
  await m.shot('01-title-landscape');

  // Landscape recommended, portrait prompt is a DOM overlay: not visible here.
  check('the rotate prompt is not shown in landscape', (await m.rect('.tc-rotate')).display === 'none');

  await m.play();
  check('tapping TAP TO PLAY (a real touch) starts a one-player run', (await m.activeScene()) === 'GameScene' && (await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.players.length`)) === 1);
  const a1 = await m.audio();
  check('that touch unlocks audio and starts exactly one music instance', !a1.locked && a1.playing && a1.instances === 1, JSON.stringify(a1));
  check('the control overlay appears in landscape during play', await m.overlayShown());
  await m.quiet();
  await sleep(200);
  await m.shot('02-play-landscape');

  // --- layout: sizes, containment, spacing, scrolling ---
  const sel = { fire: '.tc-fire', laser: '.tc-laser', boost: '.tc-boost', pause: '.tc-pause', zone: '.tc-zone' };
  const R = {};
  for (const [k, s] of Object.entries(sel)) R[k] = await m.rect(s);
  const buttons = ['fire', 'laser', 'boost', 'pause'];
  check('every button is at least 44 CSS px across (FIRE much larger)', buttons.every((k) => R[k].width >= 44 && R[k].height >= 44) && R.fire.width >= 90, buttons.map((k) => `${k}=${Math.round(R[k].width)}x${Math.round(R[k].height)}`).join(' '));
  check('all controls are inside the viewport', buttons.every((k) => R[k].left >= 0 && R[k].top >= 0 && R[k].right <= 844 && R[k].bottom <= 390));
  const pairs = [['fire', 'laser'], ['fire', 'boost'], ['laser', 'boost'], ['fire', 'pause'], ['boost', 'pause'], ['laser', 'pause']];
  check('no two buttons overlap, and there is a gap of at least 8 px between the weapons', pairs.every(([a, b]) => !overlaps(R[a], R[b])) && R.fire.left - R.laser.right >= 8 && R.fire.top - R.boost.bottom >= 8, JSON.stringify({ gapL: R.fire.left - R.laser.right, gapB: R.fire.top - R.boost.bottom }));
  check('PAUSE is at the top, far from the weapon buttons', R.pause.top < 40 && R.boost.top - R.pause.bottom > 40);
  check('the steering zone is the left side and never reaches the buttons', R.zone.left === 0 && R.zone.right < R.laser.left);
  let sc = await m.scrollState();
  check('no page scroll or overflow', sc.sx === 0 && sc.sy === 0 && sc.sw <= sc.cw && sc.sh <= sc.ch, JSON.stringify(sc));
  const touchCss = await m.page.evaluate(() => ({ body: getComputedStyle(document.body).touchAction, zone: getComputedStyle(document.querySelector('.tc-zone')).touchAction, sel: getComputedStyle(document.body).userSelect }));
  check('touch-action / selection restrictions are on in touch mode', touchCss.body === 'none' && touchCss.zone === 'none' && touchCss.sel === 'none', JSON.stringify(touchCss));

  // --- HUD readable and uncovered ---
  const hud = await m.texts();
  check('the HUD (score, lives, laser, boost, clock) is on screen', ['P1: 0', 'Lives: 3'].every((t) => hud.includes(t)) && hud.some((t) => t.startsWith('LASER:')) && hud.some((t) => t.startsWith('BOOST:')) && hud.some((t) => /^\d\d:\d\d$/.test(t)), hud.join(' | '));
  const hudBoxes = await m.page.evaluate(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), k = c.width / 1280;
    return window.__game.scene.getScene('GameScene').children.list.filter((t) => t.type === 'Text' && t.visible && /^(P1|Lives|LASER|BOOST|\\d\\d:\\d\\d)/.test(t.text)).map((t) => { const b = t.getBounds(); return { text: t.text, left: c.left + b.x * k, top: c.top + b.y * k, right: c.left + (b.x + b.width) * k, bottom: c.top + (b.y + b.height) * k, px: parseFloat(t.style.fontSize) * k }; }); })()`);
  check('no HUD text is covered by a control', hudBoxes.every((h) => ![R.fire, R.laser, R.boost, R.pause, R.zone].some((r) => r !== R.zone && overlaps(h, r))), hudBoxes.length + ' texts');
  const minPx = Math.min(...hudBoxes.filter((h) => /^(P1|Lives|LASER|BOOST)/.test(h.text)).map((h) => h.px));
  check('HUD text is at least 12 CSS px tall on this phone', minPx >= 12, `smallest ${minPx.toFixed(1)}px`);
  const abil = await m.page.evaluate(() => ({ laser: document.querySelector('.tc-laser .tc-sub').textContent, boost: document.querySelector('.tc-boost .tc-sub').textContent }));
  check('the LASER and BOOST buttons show charges and state', abil.laser === '15' && abil.boost === 'READY', JSON.stringify(abil));

  // =====================================================================================================
  // 2. Genuine multi-touch: steer + FIRE + LASER + BOOST at once
  // =====================================================================================================
  await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 99`);
  const stick = { x: 150, y: 280 };
  const fire = await m.centre(sel.fire);
  const laser = await m.centre(sel.laser);
  const boost = await m.centre(sel.boost);
  let s0 = await m.sim();
  check('the ship starts centred and still, controls neutral', s0.rot === 0 && Math.round(s0.x) === 640 && (await m.cmd()).rotate === 0);

  await m.finger.down(1, stick.x, stick.y);
  await sleep(120);
  let c = await m.cmd();
  check('touching down on the steering zone is neutral wherever it lands (floating stick)', c.rotate === 0 && c.move === 0 && !c.shoot);
  const baseShown = await m.page.evaluate(() => getComputedStyle(document.querySelector('.tc-base')).display);
  check('the stick base appears under the thumb', baseShown === 'block');
  await m.finger.move(1, stick.x - 40, stick.y - 40);
  await sleep(120);
  c = await m.cmd();
  check('thumb up-left = rotate left and move forward at once (diagonal, proportional)', c.rotate < -0.4 && c.rotate > -1 && c.move > 0.4, JSON.stringify(c));
  await m.finger.down(2, fire.x, fire.y);
  await sleep(100);
  c = await m.cmd();
  check('FIRE can be held while steering (two fingers at once)', c.shoot === true && c.rotate < -0.4 && c.move > 0.4, JSON.stringify(c));
  await sleep(900);
  let s1 = await m.sim();
  check('the simulation turns, flies and shoots from that input; FIRE is continuous (no repeated taps)', s1.rot !== s0.rot && Math.hypot(s1.x - s0.x, s1.y - s0.y) > 20 && s1.shots >= 3, JSON.stringify({ rot: s1.rot.toFixed(0), shots: s1.shots }));
  await m.shot('03-steer-and-fire');

  await m.finger.down(3, laser.x, laser.y);
  await sleep(150);
  c = await m.cmd();
  check('LASER works with steering and FIRE still held (three fingers)', c.laser === true && c.shoot === true && c.rotate < 0, JSON.stringify(c));
  let s2 = await m.sim();
  check('one LASER charge is spent (once per press, even though the finger stays down)', s2.laser === 14, `laser=${s2.laser}`);
  await sleep(700);
  check('holding LASER does not keep firing it', (await m.sim()).laser === 14);
  await m.finger.up(3);
  await sleep(100);
  check('the LASER button shows the remaining charges', (await m.page.evaluate(() => document.querySelector('.tc-laser .tc-sub').textContent)) === '14');

  await m.finger.down(4, boost.x, boost.y);
  await sleep(150);
  check('BOOST activates with the other fingers down (four fingers)', (await m.sim()).boost === true && (await m.cmd()).boost === true);
  await m.finger.up(4);
  await sleep(100);
  check('the BOOST button counts down', /^\d+s$/.test(await m.page.evaluate(() => document.querySelector('.tc-boost .tc-sub').textContent)));

  // --- release: nothing stays stuck ---
  await m.finger.up(2);
  await sleep(80);
  c = await m.cmd();
  check('lifting FIRE stops shooting but keeps steering', c.shoot === false && c.rotate < 0);
  await m.finger.up(1);
  await sleep(80);
  c = await m.cmd();
  check('lifting the stick returns to neutral at once', c.rotate === 0 && c.move === 0 && !c.shoot && !c.laser && !c.boost, JSON.stringify(c));
  await m.quiet();
  const before = await m.sim();
  await sleep(500);
  const after = await m.sim();
  check('the ship stops turning and no more shots are fired', after.rot === before.rot && after.shots === 0, JSON.stringify({ r: [before.rot, after.rot], shots: after.shots }));
  check('every finger is released in the browser too', m.finger.count === 0 && (await m.page.evaluate(`window.__game.registry.get('touchControls').model.activePointers`)) === 0);

  // --- fingers that slide / release outside / get cancelled ---
  await m.finger.down(5, fire.x, fire.y);
  await m.finger.move(5, laser.x, laser.y);
  await sleep(120);
  c = await m.cmd();
  check('a finger that slides from FIRE over LASER keeps FIRE and does not fire the LASER', c.shoot === true && c.laser === false && (await m.sim()).laser === 14, JSON.stringify(c));
  await m.finger.move(5, 400, 40); // far away, over the playfield / HUD
  await sleep(100);
  check('a finger dragged far outside its button still holds it', (await m.cmd()).shoot === true);
  await m.finger.up(5);
  await sleep(80);
  check('releasing outside the button releases it', (await m.cmd()).shoot === false);

  await m.finger.down(6, stick.x, stick.y);
  await m.finger.move(6, stick.x + 50, stick.y);
  await m.finger.down(7, fire.x, fire.y);
  await sleep(100);
  check('(setup) steering right + FIRE held', (await m.cmd()).rotate > 0.4 && (await m.cmd()).shoot);
  await m.finger.cancelAll();
  await sleep(120);
  c = await m.cmd();
  check('a cancelled touch (system gesture) leaves no stuck steering or FIRE', c.rotate === 0 && c.move === 0 && !c.shoot, JSON.stringify(c));
  check('the model holds no pointers after the cancel', (await m.page.evaluate(`window.__game.registry.get('touchControls').model.activePointers`)) === 0);

  // =====================================================================================================
  // 3. Pause / resume, with fingers down, and no ghost taps
  // =====================================================================================================
  await m.finger.down(8, stick.x, stick.y);
  await m.finger.move(8, stick.x - 50, stick.y - 50);
  await m.finger.down(9, fire.x, fire.y);
  await sleep(100);
  const pauseAt = await m.centre(sel.pause);
  await m.finger.down(10, pauseAt.x, pauseAt.y);
  await sleep(60);
  check('touching PAUSE does not pause yet (it is a tap: it fires on release)', (await m.sim()).paused === false);
  await m.finger.up(10);
  await sleep(250);
  let st = await m.sim();
  check('tapping PAUSE (with steering and FIRE fingers down) pauses the game', st.paused === true);
  check('pausing released the held steering and FIRE', (await m.cmd()).rotate === 0 && !(await m.cmd()).shoot);
  check('the on-screen controls are hidden while paused', !(await m.overlayShown()));
  const pauseTexts = await m.texts();
  check('the pause screen is touch-operable (RESUME, MAIN MENU, volume)', pauseTexts.includes('RESUME') && pauseTexts.includes('MAIN MENU') && pauseTexts.includes('MUSIC') && pauseTexts.includes('SFX'), pauseTexts.join(' | ').slice(0, 200));
  check('no keyboard-only instructions on the touch pause screen', !pauseTexts.some((t) => /Press P|Press ESC|Press M/.test(t)));
  await m.finger.up(8);
  await m.finger.up(9);
  await sleep(600); // long enough for a synthesised mouse / click to arrive if the browser sent one
  st = await m.sim();
  check('no ghost tap: the game is still paused 600 ms after the PAUSE tap and the lifting of the other fingers', st.paused === true && (await m.activeScene()) === 'GameScene');
  await m.shot('04-pause');

  // volume by touch
  const v0 = await m.audio();
  await m.tapGame(940 + 240, 250); // music +
  await sleep(150);
  await m.tapGame(940 + 30, 250 + 104); // sfx -
  await sleep(150);
  const v1 = await m.audio();
  check('Music and SFX volume can be changed by touch (and are saved)', Math.abs(v1.vm - (v0.vm + 0.1)) < 1e-9 && Math.abs(v1.vs - (v0.vs - 0.1)) < 1e-9 && (await m.page.evaluate(() => localStorage.length)) > 0, JSON.stringify({ v0: [v0.vm, v0.vs], v1: [v1.vm, v1.vs] }));
  await m.tapGame(940, 250 + 2 * 104 - 6); // mute toggle
  await sleep(150);
  check('the music can be muted by touch, and unmuted again', (await m.audio()).muted === true && (await (async () => (await m.tapGame(940, 250 + 2 * 104 - 6), await sleep(150), (await m.audio()).muted === false))()));

  const instanceBefore = await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.time`);
  await m.tapGame(340, 300); // RESUME
  await sleep(300);
  st = await m.sim();
  check('RESUME resumes play and brings the controls back', st.paused === false && (await m.overlayShown()), JSON.stringify({ paused: st.paused }));
  check('nothing is held after resuming (no stuck steering, FIRE, LASER or BOOST)', JSON.stringify(await m.cmd()) === JSON.stringify({ rotate: 0, move: 0, shoot: false, laser: false, boost: false }));
  await sleep(300);
  check('the simulation clock runs again', (await m.sim()).time > instanceBefore);

  // =====================================================================================================
  // 4. Rotation to portrait and back, focus loss, visibility
  // =====================================================================================================
  await m.finger.down(11, stick.x, stick.y);
  await m.finger.move(11, stick.x + 50, stick.y);
  await m.finger.down(12, fire.x, fire.y);
  await sleep(100);
  const simObject = await m.page.evaluate(`window.__simId = Math.random(), window.__game.scene.getScene('GameScene').sim.__id = window.__simId`);
  void simObject;
  await m.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  const rot = await m.rect('.tc-rotate');
  check('portrait shows the "Rotate your phone to play." prompt', rot.display !== 'none' && (await m.page.evaluate(() => document.querySelector('.tc-rotate').innerText)).includes('Rotate your phone to play.'));
  await m.shot('05-portrait-prompt');
  check('the game paused itself and let go of every finger', (await m.sim()).paused === true && (await m.cmd()).rotate === 0 && !(await m.cmd()).shoot);
  check('the controls are hidden under the prompt', !(await m.overlayShown()));
  sc = await m.scrollState();
  check('no scroll or overflow in portrait', sc.sx === 0 && sc.sy === 0 && sc.sw <= sc.cw && sc.sh <= sc.ch, JSON.stringify(sc));
  await m.finger.cancelAll();
  await m.finger.tap(195, 400); // a tap on the prompt must not reach the game
  await sleep(200);
  check('tapping the prompt does nothing to the game', (await m.sim()).paused === true);
  await m.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  check('back in landscape the prompt is gone', (await m.rect('.tc-rotate')).display === 'none');
  st = await m.sim();
  check('the same run is still there, paused, not restarted, and no input is held', st.paused === true && st.phase === 'playing' && st.lives === 99 && (await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.__id === window.__simId`)));
  check('the pause screen is shown again after turning back (RESUME needs a tap)', (await m.texts()).includes('RESUME'));
  await m.tapGame(340, 300);
  await sleep(300);
  check('RESUME works after a rotation, and controls are neutral', (await m.sim()).paused === false && (await m.overlayShown()) && (await m.cmd()).rotate === 0);
  const rotAudio = await m.audio();
  check('rotating did not create a second music instance', rotAudio.instances === 1 && rotAudio.playing, JSON.stringify(rotAudio));

  // focus loss
  await m.finger.down(13, fire.x, fire.y);
  await sleep(100);
  await m.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(200);
  check('losing window focus pauses and releases FIRE', (await m.sim()).paused === true && !(await m.cmd()).shoot);
  await m.finger.up(13);
  await m.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(150);
  check('regaining focus leaves it paused with nothing held', (await m.sim()).paused === true && !(await m.cmd()).shoot);
  await m.tapGame(340, 300);
  await sleep(300);

  // =====================================================================================================
  // 5. Game over, retry, menu
  // =====================================================================================================
  await m.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
    s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
  await m.finger.down(14, fire.x, fire.y); // still firing as the ship is lost
  await m.page.waitForFunction(`window.__game.scene.getScene('GameScene').sim.phase === 'gameOver'`, null, { timeout: 5000 });
  await sleep(300);
  check('game over: the controls are removed and the held FIRE is released', !(await m.overlayShown()) && !(await m.cmd()).shoot);
  await m.finger.up(14);
  const overTexts = await m.texts();
  check('the game-over screen has touch RETRY and MAIN MENU buttons, and no keyboard instructions', overTexts.includes('GAME OVER') && overTexts.includes('RETRY') && overTexts.includes('MAIN MENU') && !overTexts.some((t) => /Press|click RETRY/.test(t)), overTexts.join(' | ').slice(0, 200));
  await m.shot('06-game-over');
  // Pin the delay (the real one is 1.5 s of sim time, which a slow screenshot could otherwise let run out before the tap).
  await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.retryDelay = 30`);
  await m.tapGame(430, 470);
  await sleep(250);
  check('RETRY is ignored during the short delay after the ship is lost', (await m.sim()).phase === 'gameOver');
  await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.retryDelay = 0`);
  await m.finger.down(15, fire.x, fire.y); // a thumb resting where FIRE will appear
  await m.tapGame(430, 470);
  await sleep(400);
  st = await m.sim();
  check('tapping RETRY starts a clean new run with the controls back', st.phase === 'playing' && st.lives === 3 && st.score === 0 && (await m.overlayShown()), JSON.stringify(st));
  check('a finger that was resting there does not fire the new run', (await m.cmd()).shoot === false && st.shots === 0);
  await m.finger.up(15);
  const restartAudio = await m.audio();
  check('still exactly one music instance after the restart', restartAudio.instances === 1 && restartAudio.playing);
  // second game over -> MAIN MENU by touch
  await m.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false;
    s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
  await m.page.waitForFunction(`window.__game.scene.getScene('GameScene').sim.phase === 'gameOver'`, null, { timeout: 5000 });
  await sleep(300);
  await m.tapGame(850, 470);
  await m.page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  check('MAIN MENU by touch returns to the touch title screen with no controls drawn', (await m.texts('StartScene')).includes('TAP TO PLAY') && !(await m.overlayShown()));
  const listeners = await m.page.evaluate(`({ touch: window.__game.registry.get('touchControls').listenerCount, blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  await m.play();
  const listeners2 = await m.page.evaluate(`({ touch: window.__game.registry.get('touchControls').listenerCount, blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  check('no listener build-up across game, menu and game again', listeners2.touch === listeners.touch + 2 && listeners2.blur === listeners.blur + 1, JSON.stringify({ listeners, listeners2 }));

  // =====================================================================================================
  // 6. Input-mode selection
  // =====================================================================================================
  // back to the title: pause -> MAIN MENU by touch
  const p2 = await m.centre(sel.pause);
  await m.finger.tap(p2.x, p2.y);
  await sleep(250);
  await m.tapGame(340, 460);
  await m.page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  await sleep(200);
  await m.tapGame(940, 640); // CONTROLS toggle -> keyboard
  await m.page.waitForFunction(() => window.__game.scene.getScene('StartScene').sys.isActive() && window.__game.scene.getScene('StartScene').children.list.some((c) => c.type === 'Text' && /Press SPACE/.test(c.text)), null, { timeout: 5000 });
  check('the CONTROLS switch on the title screen turns touch off: the keyboard / controller title screen appears', !(await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /Press SPACE/.test(t)));
  check('the choice is remembered for next time', (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === 'desktop');
  check('a touch-capable device in keyboard mode is still offered a way back', (await m.texts('StartScene')).some((t) => t.startsWith('TOUCH CONTROLS: OFF')));
  await m.shot('07-title-keyboard-mode');
  await m.page.keyboard.press('Space');
  await m.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(250);
  check('in keyboard mode no touch controls are shown and touches do nothing to the ship', !(await m.overlayShown()) && (await m.cmd()).shoot === false);
  await m.quiet();
  await m.page.keyboard.down('KeyD');
  await sleep(250);
  await m.page.keyboard.up('KeyD');
  check('the keyboard still drives the ship in that mode', (await m.sim()).rot > 20);
  const reload = await m.page.reload();
  void reload;
  await m.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('after a reload the remembered choice (keyboard) wins over the automatic guess', !(await m.bodyClasses()).includes('tc-active'));
  await m.tapGame(1280 - 120, 20); // "TOUCH CONTROLS: OFF (tap to turn on)"
  await sleep(500);
  check('tapping TOUCH CONTROLS brings the touch screen back', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).includes('TAP TO PLAY'));
  await m.context.close();

  // ?touch=0 on a phone: the URL decides for the visit
  const forced = await mobilePage(844, 390, { query: '?debug&touch=0' });
  await forced.start();
  check('?touch=0 forces the keyboard game on a phone', !(await forced.bodyClasses()).includes('tc-active') && (await forced.texts('StartScene')).some((t) => /Press SPACE/.test(t)));
  await forced.context.close();

  // =====================================================================================================
  // 7. Layout on other phone sizes, orientation prompt in portrait from the start
  // =====================================================================================================
  const SIZES = [
    [667, 375, 'iphone-se-landscape'],
    [932, 430, 'iphone-max-landscape'],
    [740, 360, 'android-small-landscape'],
    [915, 412, 'android-large-landscape'],
    [1024, 768, 'tablet-landscape'],
  ];
  for (const [w, h, name] of SIZES) {
    const p = await mobilePage(w, h);
    await p.start();
    await p.play();
    await p.quiet();
    await sleep(300);
    const rects = {};
    for (const [k, s] of Object.entries(sel)) rects[k] = await p.rect(s);
    const ok44 = buttons.every((k) => rects[k].width >= 44 && rects[k].height >= 44);
    const inside = buttons.every((k) => rects[k].left >= 0 && rects[k].top >= 0 && rects[k].right <= w && rects[k].bottom <= h);
    const clear = pairs.every(([a, b]) => !overlaps(rects[a], rects[b]));
    const scr = await p.scrollState();
    const fire2 = await p.centre(sel.fire);
    const st2 = await p.centre(sel.zone);
    await p.finger.down(1, 120, h - 90);
    await p.finger.move(1, 120, h - 90 - 40);
    await p.finger.down(2, fire2.x, fire2.y);
    await sleep(120);
    const c2 = await p.cmd();
    await p.finger.up(1);
    await p.finger.up(2);
    void st2;
    check(`[${name} ${w}x${h}] controls >= 44px, inside the screen, not overlapping; steer + FIRE together work; no overflow`, ok44 && inside && clear && c2.move > 0 && c2.shoot && scr.sw <= scr.cw && scr.sh <= scr.ch, JSON.stringify({ fire: Math.round(rects.fire.width), sec: Math.round(rects.laser.width), minGap: Math.round(Math.min(rects.fire.left - rects.laser.right, rects.fire.top - rects.boost.bottom)) }));
    await p.shot(`layout-${name}`);
    await p.context.close();
  }

  const portrait = await mobilePage(390, 844);
  await portrait.start();
  check('opening the page in portrait shows the rotate prompt straight away', (await portrait.rect('.tc-rotate')).display !== 'none');
  await portrait.tapGame(940, 190); // a tap where PLAY would be must not start a game
  await sleep(300);
  check('and a tap through the prompt does not start a game', (await portrait.activeScene()) === 'StartScene');
  await portrait.shot('08-portrait-start');
  await portrait.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  check('turning to landscape reveals the title screen, still not started', (await portrait.rect('.tc-rotate')).display === 'none' && (await portrait.activeScene()) === 'StartScene');
  await portrait.context.close();

  // =====================================================================================================
  // 8. Desktop is unchanged
  // =====================================================================================================
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dpage = await desktop.newPage();
  const dproblems = [];
  dpage.on('console', (msg) => msg.type() === 'error' && dproblems.push(msg.text()));
  dpage.on('pageerror', (e) => dproblems.push(String(e)));
  await dpage.goto(`${BASE}?debug`);
  await dpage.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  const dtexts = await dpage.evaluate(`(${VISIBLE_TEXTS})(window.__game.scene.getScene('StartScene'))`);
  check('desktop (fine pointer, no touch): the title screen is the keyboard one, with no touch switch', dtexts.includes('Press SPACE or click to start') && dtexts.includes('[1]  ONE PLAYER') && !dtexts.some((t) => /TOUCH/.test(t)), dtexts.slice(0, 6).join(' | '));
  const dstate = await dpage.evaluate(() => ({ cls: [...document.body.classList], overlay: getComputedStyle(document.querySelector('.tc-root')).display, rotate: getComputedStyle(document.querySelector('.tc-rotate')).display, touchAction: getComputedStyle(document.body).touchAction, canvas: document.querySelector('canvas').getBoundingClientRect().toJSON() }));
  check('desktop: no touch classes, the overlay and rotate prompt are display:none, no page-wide touch-action', dstate.cls.length === 0 && dstate.overlay === 'none' && dstate.rotate === 'none' && dstate.touchAction === 'auto', JSON.stringify(dstate));
  check('desktop: the canvas still fills the 1280x720 window exactly', Math.round(dstate.canvas.width) === 1280 && Math.round(dstate.canvas.height) === 720 && dstate.canvas.left === 0 && dstate.canvas.top === 0);
  await dpage.keyboard.press('Space');
  await dpage.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  const dhud = await dpage.evaluate(`window.__game.scene.getScene('GameScene').children.list.filter((c) => c.type === 'Text' && c.visible && c.text).map((t) => [t.text, t.style.fontSize])`);
  check('desktop: HUD text sizes are the original 20 px', dhud.some(([t, s]) => t === 'P1: 0' && s === '20px') && dhud.some(([t, s]) => t.startsWith('LASER:') && s === '20px'), JSON.stringify(dhud.slice(0, 4)));
  await dpage.keyboard.down('KeyD');
  await dpage.keyboard.down('Space');
  await sleep(300);
  await dpage.keyboard.up('KeyD');
  await dpage.keyboard.up('Space');
  const drot = await dpage.evaluate(`window.__game.scene.getScene('GameScene').sim.player.rotation`);
  check('desktop: keyboard steering and shooting work as before', drot > 20);
  await dpage.keyboard.press('KeyP');
  await sleep(150);
  const dpaused = await dpage.evaluate(`(${VISIBLE_TEXTS})(window.__game.scene.getScene('GameScene'))`);
  check('desktop: the pause screen is the original keyboard one', dpaused.includes('Press P to Resume') && dpaused.includes('Press ESC for Main Menu') && !dpaused.includes('RESUME'));
  check('desktop: no console errors', dproblems.length === 0, dproblems.join(' | '));
  await desktop.close();

  // a touch laptop (fine primary pointer + touch screen): keyboard game, but the switch is offered
  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const lpage = await laptopCtx.newPage();
  await lpage.goto(`${BASE}?debug`);
  await lpage.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  const ltexts = await lpage.evaluate(`(${VISIBLE_TEXTS})(window.__game.scene.getScene('StartScene'))`);
  const lmedia = await lpage.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, touchPoints: navigator.maxTouchPoints }));
  info(`touch laptop emulation: ${JSON.stringify(lmedia)}`);
  if (!lmedia.coarse) {
    check('touch laptop (mouse primary + touch screen): keyboard title screen plus an unobtrusive TOUCH CONTROLS switch', ltexts.includes('Press SPACE or click to start') && ltexts.some((t) => t.startsWith('TOUCH CONTROLS: OFF')));
  } else {
    info('this Chromium reports a coarse pointer for hasTouch, so the touch-laptop case cannot be emulated here (covered by unit tests of the policy)');
  }
  await laptopCtx.close();

  // =====================================================================================================
  // 9. Overall health
  // =====================================================================================================
  check('no console errors, page errors or failed requests on the phone pages', m.problems.length === 0, m.problems.join(' | '));
  check('the audio files were requested and loaded (no 4xx)', m.requests.some((r) => /\.ogg$/.test(r.url) && r.status === 200), m.requests.filter((r) => /\.ogg/.test(r.url)).length + ' ogg requests');
  const cssUrls = [...new Set(m.requests.filter((r) => /\.css$/.test(r.url)).map((r) => r.url))];
  check('the touch stylesheet is part of the build and loads (one file, from the same origin and base path)', cssUrls.length === 1 && m.requests.filter((r) => /\.css$/.test(r.url)).every((r) => r.status === 200), cssUrls.join(' '));
}
