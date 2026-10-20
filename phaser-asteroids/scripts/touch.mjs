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

// ---------------------------------------------------------------------------------------------------------
// D-pad: layout, direction maths on a real thumb, multi-touch with the buttons, lifecycle, mode switching and persistence
// ---------------------------------------------------------------------------------------------------------

const EIGHT = [
  [0, 0, 1],
  [45, 1, 1],
  [90, 1, 0],
  [135, 1, -1],
  [180, 0, -1],
  [225, -1, -1],
  [270, -1, 0],
  [315, -1, 1],
];
const NEUTRAL_CMD = JSON.stringify({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });

/** A point on (or beyond) the pad, as a compass angle (0 = up, 90 = right) and a distance in pad radii. */
function padPoint(rect, angle, dist = 0.7) {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const r = rect.width / 2;
  const a = (angle * Math.PI) / 180;
  return { x: cx + Math.sin(a) * dist * r, y: cy - Math.cos(a) * dist * r };
}

/** Game (1280x720) rectangle -> CSS rectangle, using the canvas's current size. */
async function gameRectCss(p, x0, y0, x1, y1) {
  const a = await p.css(x0, y0);
  const b = await p.css(x1, y1);
  return { left: a.x, top: a.y, right: b.x, bottom: b.y, width: b.x - a.x, height: b.y - a.y };
}

const steeringOf = (p) => p.page.evaluate(`window.__game.registry.get('touchSteering').mode`);

/**
 * Waits for the forced game over the tests set up (one life, an asteroid on the ship). If it never comes, prints what the run looked
 * like and saves a screenshot before failing, so an intermittent timeout here can be explained (one was seen once in ~15 runs and did
 * not reproduce: see docs/mobile-touch.md, "Known test flakiness").
 */
async function waitGameOver(p, label) {
  try {
    await p.page.waitForFunction(`window.__game.scene.getScene('GameScene').sim.phase === 'gameOver'`, null, { timeout: 5000 });
  } catch (error) {
    const state = await p.page.evaluate(`(() => { const sc = window.__game.scene.getScene('GameScene'), s = sc.sim, pl = s.player; return {
      paused: sc.paused, phase: s.phase, lives: pl.lives, respawning: pl.isRespawning, shield: pl.shieldActive, boost: pl.boost.active, pos: pl.position,
      asteroids: s.asteroids.map((a) => ({ x: Math.round(a.position.x), y: Math.round(a.position.y), alive: a.alive, dying: a.dying })), time: s.time,
      layer: window.__game.registry.get('touchControls').currentLayer, focus: window.__game.hasFocus }; })()`);
    console.log(`DIAG  ${label}: no game over within 5 s: ${JSON.stringify(state)}`);
    await p.shot(`diag-no-game-over-${label}`).catch(() => {});
    throw error;
  }
}

async function runDpad() {
  console.log('\n--- D-pad ---');
  // =====================================================================================================
  // D1. Title screen: the choice, the Fullscreen pill, layout
  // =====================================================================================================
  const t = await mobilePage(844, 390, { steering: null }); // a first-time visitor
  await t.start();
  let texts = await t.texts('StartScene');
  check('the title screen offers STEERING: JOYSTICK | D-PAD', texts.includes('STEERING') && texts.includes('JOYSTICK') && texts.includes('D-PAD'), texts.join(' | ').slice(0, 200));
  check('a player who never chose gets the D-pad (the default), with nothing saved yet', (await steeringOf(t)) === 'dpad' && (await t.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === null && (await t.texts('StartScene')).some((x) => x.startsWith('D-PAD: UP')));
  const pill = await t.rect('.tc-sys-btn');
  const pillText = await t.page.evaluate(() => document.querySelector('.tc-sys-btn').textContent);
  check('the title screen shows the Fullscreen control, at least 44 CSS px tall, inside the screen, top right', (await t.rect('.tc-system')).display === 'block' && pillText === 'FULLSCREEN' && pill.height >= 44 && pill.right <= 844 && pill.top >= 0 && pill.left > 422 && pill.top < 30, `${pillText} ${Math.round(pill.width)}x${Math.round(pill.height)} at ${Math.round(pill.left)},${Math.round(pill.top)}`);
  const playBtn = await gameRectCss(t, 700, 105, 1180, 205);
  check('the Fullscreen control does not cover the TAP TO PLAY button', !overlaps(pill, playBtn), JSON.stringify({ pill: [pill.left, pill.bottom], play: [playBtn.right, playBtn.top] }));
  const selectorButtons = [await gameRectCss(t, 662, 523, 938, 613), await gameRectCss(t, 946, 523, 1222, 613)];
  check('both steering buttons are at least 44 CSS px tall and 100 wide (thumb-sized)', selectorButtons.every((r) => r.height >= 44 && r.width >= 100), selectorButtons.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`).join(' '));
  await t.shot('dpad-title');

  // the joystick is one tap away, and applies at once
  await t.tapGame(798, 568);
  await sleep(250);
  check('tapping JOYSTICK selects it, applies it at once, saves it and the how-to text says what the joystick does', (await steeringOf(t)) === 'joystick' && (await t.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === 'joystick' && (await t.texts('StartScene')).some((x) => x.startsWith('LEFT SIDE')));
  await t.shot('dpad-title-joystick-selected');
  await t.tapGame(1082, 568);
  await sleep(250);
  check('tapping D-PAD selects it again, applies it at once and the how-to text says what the D-pad does', (await steeringOf(t)) === 'dpad' && (await t.texts('StartScene')).some((x) => x.startsWith('D-PAD: UP')), (await t.texts('StartScene')).filter((x) => /LEFT SIDE|D-PAD:/.test(x)).join('|'));
  check('the choice is saved in localStorage', (await t.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === 'dpad');
  await t.shot('dpad-title-dpad-selected');
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  check('after a reload D-PAD is still selected (the choice persists between sessions)', (await steeringOf(t)) === 'dpad');
  check('no touch controls on the title screen, in either mode', !(await t.overlayShown()));

  // =====================================================================================================
  // D2. Play with the D-pad: what is on screen
  // =====================================================================================================
  await t.play();
  await t.quiet();
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 99`);
  await sleep(250);
  check('in D-pad mode the pad is on screen and the joystick zone and STEER ring are gone', (await t.rect('.tc-dpad')).display !== 'none' && (await t.rect('.tc-zone')).display === 'none' && (await t.rect('.tc-hint')).display === 'none');
  let pad = await t.rect('.tc-dpad');
  const others = { fire: await t.rect('.tc-fire'), laser: await t.rect('.tc-laser'), boost: await t.rect('.tc-boost'), pause: await t.rect('.tc-pause') };
  check('the pad is large (a thumb-sized disc), round, bottom left, inside the screen', pad.width >= 120 && Math.abs(pad.width - pad.height) < 1 && pad.left >= 0 && pad.bottom <= 390 && pad.left < 60 && pad.bottom > 330, `${Math.round(pad.width)}px at ${Math.round(pad.left)},${Math.round(pad.top)}`);
  check('the pad does not overlap FIRE, LASER, BOOST or PAUSE', Object.values(others).every((r) => !overlaps(pad, r)));
  const hudBoxes = await t.page.evaluate(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), k = c.width / 1280;
    return window.__game.scene.getScene('GameScene').children.list.filter((x) => x.type === 'Text' && x.visible && /^(P1|Lives|LASER|BOOST|\\d\\d:\\d\\d)/.test(x.text)).map((x) => { const b = x.getBounds(); return { left: c.left + b.x * k, top: c.top + b.y * k, right: c.left + (b.x + b.width) * k, bottom: c.top + (b.y + b.height) * k }; }); })()`);
  check('the pad does not cover any HUD text', hudBoxes.length >= 4 && hudBoxes.every((h) => !overlaps(h, pad)));
  const lobeCount = await t.page.evaluate(() => document.querySelectorAll('.tc-dpad .tc-lobe').length);
  check('the pad has four arms (up, down, left, right)', lobeCount === 4);
  await t.shot('dpad-play-idle');

  // =====================================================================================================
  // D3. Directions on a real (emulated) thumb
  // =====================================================================================================
  const results = [];
  for (const [angle, rotate, move] of EIGHT) {
    const pt = padPoint(pad, angle);
    await t.finger.down(1, pt.x, pt.y);
    await sleep(60);
    const c = await t.cmd();
    results.push(c.rotate === rotate && c.move === move && !c.shoot && !c.laser && !c.boost);
    await t.finger.up(1);
    await sleep(40);
    if ((await t.cmd()).rotate !== 0 || (await t.cmd()).move !== 0) results.push(false);
  }
  check('all eight directions (4 directions + 4 diagonals) give full-strength digital commands on a real touch, and lifting returns to neutral', results.every(Boolean), results.join(','));

  // lit arms
  const pt315 = padPoint(pad, 315);
  await t.finger.down(1, pt315.x, pt315.y);
  await sleep(80);
  const lit = await t.page.evaluate(() => [...document.querySelectorAll('.tc-lobe.tc-on')].map((e) => e.className.replace(/tc-lobe-?|tc-on|\s+/g, '')));
  check('pressed-state feedback: Up + Left lights exactly the Up and Left arms', lit.length === 2 && lit.includes('up') && lit.includes('left'), JSON.stringify(lit));
  await t.shot('dpad-play-up-left');
  await t.finger.up(1);
  await sleep(60);
  check('the arms go dark again on release', (await t.page.evaluate(() => document.querySelectorAll('.tc-lobe.tc-on').length)) === 0);

  // sliding between directions with ONE thumb, never lifting
  const slideSeen = [];
  const start = padPoint(pad, 0);
  await t.finger.down(2, start.x, start.y);
  for (const angle of [0, 20, 45, 70, 90, 135, 180, 225, 270, 315, 0]) {
    const pt = padPoint(pad, angle);
    await t.finger.move(2, pt.x, pt.y);
    await sleep(35);
    const c = await t.cmd();
    slideSeen.push(`${c.rotate},${c.move}`);
  }
  check('one thumb sliding round the pad passes through every direction and diagonal in order, without lifting', JSON.stringify(slideSeen.filter((s, i) => i === 0 || s !== slideSeen[i - 1])) === JSON.stringify(['0,1', '1,1', '1,0', '1,-1', '0,-1', '-1,-1', '-1,0', '-1,1', '0,1']), slideSeen.join(' '));
  // sliding outside the control
  const far = padPoint(pad, 0, 0.7);
  await t.finger.move(2, far.x, 6); // far above the pad, over the playfield / HUD
  await sleep(60);
  check('sliding far outside the pad keeps the direction (up) until the thumb lifts', (await t.cmd()).move === 1 && (await t.cmd()).rotate === 0);
  await t.finger.move(2, 350, 30); // across the playfield: 45 degrees up-right of the pad's centre
  await sleep(60);
  check('a thumb dragged across the screen still steers by its angle from the pad (no stuck or lost input)', (await t.cmd()).rotate === 1 && (await t.cmd()).move === 1, JSON.stringify(await t.cmd()));
  await t.finger.up(2);
  await sleep(60);
  check('lifting anywhere releases at once', JSON.stringify(await t.cmd()) === NEUTRAL_CMD && (await t.page.evaluate(`window.__game.registry.get('touchControls').model.activePointers`)) === 0);

  // =====================================================================================================
  // D4. What the ship does: forward is where it faces, taps nudge, no creep
  // =====================================================================================================
  const s0 = await t.sim();
  const right = padPoint(pad, 90);
  await t.finger.down(3, right.x, right.y);
  await sleep(500);
  await t.finger.up(3);
  await sleep(100);
  const s1 = await t.sim();
  const turned = Math.abs((((s1.rot - s0.rot) % 360) + 540) % 360 - 180);
  check('holding Right turns the ship (clockwise, like D) and Releasing stops the turn', s1.rot !== s0.rot && turned > 20, `rot ${s0.rot.toFixed(1)} -> ${s1.rot.toFixed(1)}`);
  await sleep(300);
  check('no creeping turn after release', (await t.sim()).rot === s1.rot);
  const up = padPoint(pad, 0);
  const fwdBefore = await t.sim();
  await t.finger.down(4, up.x, up.y);
  await sleep(600);
  await t.finger.up(4);
  await sleep(100);
  const fwdAfter = await t.sim();
  const dx = fwdAfter.x - fwdBefore.x;
  const dy = fwdAfter.y - fwdBefore.y;
  const rad = (fwdBefore.rot * Math.PI) / 180;
  const along = (dx * -Math.sin(rad) + dy * Math.cos(rad)) / Math.hypot(dx, dy);
  check('Up flies the way the ship is facing (not toward the thumb or screen top)', Math.hypot(dx, dy) > 20 && along > 0.98 && fwdAfter.rot === fwdBefore.rot, JSON.stringify({ moved: Math.round(Math.hypot(dx, dy)), along: along.toFixed(3) }));

  // short taps: each is a small nudge, and the ship does not keep turning
  let nudges = [];
  for (let i = 0; i < 4; i++) {
    const before = (await t.sim()).rot;
    await t.finger.tap(padPoint(pad, 270).x, padPoint(pad, 270).y, 60);
    await sleep(120);
    nudges.push(((((await t.sim()).rot - before) % 360) + 540) % 360 - 180); // signed turn: rotation wraps at 360
  }
  check('short taps on Left make small, repeatable nudges (responsive steering corrections)', nudges.every((n) => n < -0.5 && n > -110), nudges.map((n) => n.toFixed(1)).join(' '));
  check('and the pad is neutral after every tap', JSON.stringify(await t.cmd()) === NEUTRAL_CMD);

  // =====================================================================================================
  // D5. Multi-touch: D-pad + FIRE + LASER + BOOST
  // =====================================================================================================
  const fire = await t.centre('.tc-fire');
  const laser = await t.centre('.tc-laser');
  const boost = await t.centre('.tc-boost');
  const ul = padPoint(pad, 315);
  await t.finger.down(5, ul.x, ul.y);
  await t.finger.down(6, fire.x, fire.y);
  await sleep(120);
  let c = await t.cmd();
  check('D-pad Up + Left with one thumb, while FIRE is held with the other', c.rotate === -1 && c.move === 1 && c.shoot === true, JSON.stringify(c));
  await sleep(500);
  check('the ship shoots continuously while steering with the D-pad', (await t.sim()).shots >= 2);
  const laserBefore = (await t.sim()).laser;
  await t.finger.down(7, laser.x, laser.y);
  await sleep(150);
  c = await t.cmd();
  check('LASER with D-pad + FIRE (three fingers): one charge spent', c.laser && c.shoot && c.rotate === -1 && (await t.sim()).laser === laserBefore - 1, JSON.stringify(c));
  await t.finger.up(7);
  await t.finger.down(8, boost.x, boost.y);
  await sleep(150);
  c = await t.cmd();
  check('BOOST with D-pad + FIRE (three fingers)', c.boost && c.shoot && c.move === 1 && (await t.sim()).boost === true, JSON.stringify(c));
  await t.finger.up(8);
  await t.finger.up(6);
  await sleep(60);
  c = await t.cmd();
  check('lifting FIRE keeps D-pad steering', !c.shoot && c.rotate === -1 && c.move === 1);
  await t.finger.up(5);
  await sleep(60);
  check('everything neutral after the last finger lifts, in the model and in the browser', JSON.stringify(await t.cmd()) === NEUTRAL_CMD && t.finger.count === 0 && (await t.page.evaluate(`window.__game.registry.get('touchControls').model.activePointers`)) === 0);

  // a second thumb on the pad is ignored; a thumb that slides onto FIRE does not fire
  await t.finger.down(9, padPoint(pad, 270).x, padPoint(pad, 270).y);
  await t.finger.down(10, padPoint(pad, 90).x, padPoint(pad, 90).y);
  await sleep(80);
  check('a second finger on the pad is ignored (the first keeps control)', (await t.cmd()).rotate === -1);
  await t.finger.up(10);
  await t.finger.move(9, fire.x, fire.y);
  await sleep(80);
  check('a thumb that slides from the pad over FIRE keeps steering and does not shoot', (await t.cmd()).shoot === false && (await t.cmd()).rotate === 1);
  await t.finger.up(9);

  // =====================================================================================================
  // D6. Cancellation, pause, focus, orientation: nothing stays held
  // =====================================================================================================
  await t.finger.down(11, padPoint(pad, 45).x, padPoint(pad, 45).y);
  await t.finger.down(12, fire.x, fire.y);
  await sleep(100);
  await t.finger.cancelAll();
  await sleep(120);
  check('a cancelled touch (system gesture) leaves no stuck turn, thrust or FIRE', JSON.stringify(await t.cmd()) === NEUTRAL_CMD);

  await t.finger.down(13, padPoint(pad, 0).x, padPoint(pad, 0).y);
  await sleep(80);
  const pauseAt = await t.centre('.tc-pause');
  await t.finger.down(14, pauseAt.x, pauseAt.y);
  await t.finger.up(14);
  await sleep(250);
  check('pausing with the thumb on the pad releases it, hides the controls and pauses', (await t.sim()).paused === true && JSON.stringify(await t.cmd()) === NEUTRAL_CMD && !(await t.overlayShown()));
  check('the pause screen offers the steering choice with D-PAD lit, and the Fullscreen control', (await t.texts()).includes('STEERING') && (await t.texts()).includes('D-PAD') && (await t.rect('.tc-system')).display === 'block');
  await t.shot('dpad-pause');
  await t.finger.up(13);
  await sleep(100);

  // switch to the joystick FROM THE PAUSE MENU (JOYSTICK button), then resume
  await t.tapGame(218, 610);
  await sleep(250);
  check('the pause menu switches to the joystick by touch and remembers it', (await steeringOf(t)) === 'joystick' && (await t.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === 'joystick');
  await t.tapGame(340, 300); // RESUME
  await sleep(300);
  check('after RESUME the joystick zone is back and the D-pad is gone', (await t.rect('.tc-zone')).display === 'block' && (await t.rect('.tc-dpad')).display === 'none' && (await t.rect('.tc-hint')).display !== 'none');
  await t.finger.down(15, 150, 280);
  await t.finger.move(15, 150 - 45, 280 - 45);
  await sleep(100);
  c = await t.cmd();
  check('the original floating joystick still works, analogue, in joystick mode', c.rotate < -0.4 && c.rotate > -1 && c.move > 0.4, JSON.stringify(c));
  await t.finger.down(16, fire.x, fire.y);
  await t.finger.down(17, laser.x, laser.y);
  await t.finger.down(18, boost.x, boost.y);
  await sleep(100);
  c = await t.cmd();
  check('joystick + FIRE + LASER + BOOST all work together (unchanged)', c.shoot && c.laser && c.boost && c.rotate < -0.4, JSON.stringify(c));
  // switch mode while those fingers are down (programmatically: the UI only offers it on menu screens)
  await t.page.evaluate(`window.__game.registry.get('touchSteering').set('dpad')`);
  await sleep(100);
  check('switching from joystick to D-pad while the fingers are down releases everything and removes the joystick', JSON.stringify(await t.cmd()) === NEUTRAL_CMD && (await t.rect('.tc-zone')).display === 'none' && (await t.rect('.tc-dpad')).display !== 'none' && (await t.rect('.tc-base')).display === 'none');
  await t.finger.move(15, 60, 60);
  await sleep(60);
  check('the old joystick finger keeps moving and does nothing', JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  for (const id of [15, 16, 17, 18]) await t.finger.up(id);
  await sleep(60);
  pad = await t.rect('.tc-dpad');
  await t.finger.down(19, padPoint(pad, 270).x, padPoint(pad, 270).y);
  await sleep(80);
  check('and the D-pad works straight away', (await t.cmd()).rotate === -1);
  await t.finger.up(19);

  // focus loss
  await t.finger.down(20, padPoint(pad, 90).x, padPoint(pad, 90).y);
  await sleep(80);
  await t.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(200);
  check('losing focus releases the pad and pauses', (await t.sim()).paused === true && JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  await t.finger.up(20);
  await t.tapGame(340, 300);
  await sleep(300);

  // orientation
  await t.finger.down(21, padPoint(pad, 0).x, padPoint(pad, 0).y);
  await sleep(80);
  await t.page.evaluate(`window.__simId = Math.random(), window.__game.scene.getScene('GameScene').sim.__id = window.__simId`);
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  check('turning to portrait with the thumb on the pad: rotate prompt, paused, released, controls hidden', (await t.rect('.tc-rotate')).display !== 'none' && (await t.sim()).paused === true && JSON.stringify(await t.cmd()) === NEUTRAL_CMD && !(await t.overlayShown()));
  await t.finger.cancelAll();
  await t.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  check('back in landscape: the same run, still paused, nothing held', (await t.sim()).paused === true && (await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.__id === window.__simId`)) && JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  await t.tapGame(340, 300);
  await sleep(300);
  pad = await t.rect('.tc-dpad');
  check('after RESUME the pad is in place and neutral', (await t.overlayShown()) && JSON.stringify(await t.cmd()) === NEUTRAL_CMD && pad.width >= 120);

  // restart with a thumb resting where the pad will be
  await t.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
    s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
  await t.finger.down(22, padPoint(pad, 270).x, padPoint(pad, 270).y);
  await waitGameOver(t, 'dpad-thumb-on-pad');
  await sleep(300);
  check('game over with the thumb on the pad: controls removed, nothing held', !(await t.overlayShown()) && JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  await t.finger.up(22);
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.retryDelay = 0`);
  await t.finger.down(23, padPoint(pad, 90).x, padPoint(pad, 90).y); // resting where the pad will reappear
  await t.tapGame(430, 470); // RETRY
  await sleep(400);
  const st = await t.sim();
  check('RETRY gives a clean run in D-pad mode; a thumb already resting where the pad appears does not steer it', st.phase === 'playing' && st.lives === 3 && (await t.overlayShown()) && JSON.stringify(await t.cmd()) === NEUTRAL_CMD && st.rot === 0, JSON.stringify(st));
  await t.finger.up(23);
  check('(D-pad mode) no console errors', t.problems.length === 0, t.problems.join(' | '));
  await t.context.close();

  // =====================================================================================================
  // D7. Persistence across sessions, in both directions, on a fresh page
  // =====================================================================================================
  const first = await mobilePage(844, 390, { steering: null });
  await first.start();
  await first.play();
  check('a first-time visitor starts their first run with the D-pad (the pad is shown, no joystick zone)', (await first.rect('.tc-dpad')).display !== 'none' && (await first.rect('.tc-zone')).display === 'none' && (await first.rect('.tc-hint')).display === 'none');
  await first.context.close();

  const fresh = await mobilePage(844, 390, { steering: 'joystick' }); // someone who saved the joystick before the default changed
  await fresh.start();
  check('a saved JOYSTICK choice is NOT overridden by the D-pad default', (await steeringOf(fresh)) === 'joystick');
  await fresh.play();
  check('and their first run shows the joystick zone and no pad', (await fresh.rect('.tc-zone')).display === 'block' && (await fresh.rect('.tc-dpad')).display === 'none');
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('the joystick choice survives a reload (the seed never overwrites a saved choice)', (await steeringOf(fresh)) === 'joystick');
  await fresh.page.evaluate(() => localStorage.setItem('asteroids.touchSteering', 'dpad'));
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  await fresh.play();
  check('a saved D-PAD choice is applied on a brand-new visit (the pad is shown in the first run)', (await fresh.rect('.tc-dpad')).display !== 'none' && (await fresh.rect('.tc-zone')).display === 'none');
  await fresh.page.evaluate(() => localStorage.setItem('asteroids.touchSteering', 'nonsense'));
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('an unknown saved value falls back to the D-pad default', (await steeringOf(fresh)) === 'dpad');
  await fresh.context.close();

  // storage that throws (private window): the choice still works for the visit
  const priv = await mobilePage(844, 390, { steering: null });
  await priv.page.addInitScript(() => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
  });
  await priv.start();
  check('with storage blocked a first-time visitor still gets the D-pad', (await steeringOf(priv)) === 'dpad');
  await priv.tapGame(798, 568);
  await sleep(200);
  check('with storage blocked the joystick can still be chosen for the visit and nothing crashes', (await steeringOf(priv)) === 'joystick' && priv.problems.filter((x) => !/SecurityError/.test(x)).length === 0, priv.problems.join(' | '));
  await priv.context.close();

  // =====================================================================================================
  // D8. Layout and screenshots on representative phones, D-pad mode
  // =====================================================================================================
  const SIZES = [
    [667, 375, 'iphone-se-landscape'],
    [844, 390, 'iphone-landscape'],
    [932, 430, 'iphone-max-landscape'],
    [740, 360, 'android-small-landscape'],
    [915, 412, 'android-large-landscape'],
    [1024, 768, 'tablet-landscape'],
  ];
  for (const [w, h, name] of SIZES) {
    const p = await mobilePage(w, h);
    await p.start();
    await p.page.evaluate(() => localStorage.setItem('asteroids.touchSteering', 'dpad'));
    await p.page.reload();
    await p.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await sleep(250);
    await p.play();
    await p.quiet();
    await sleep(300);
    const d = await p.rect('.tc-dpad');
    const r = { fire: await p.rect('.tc-fire'), laser: await p.rect('.tc-laser'), boost: await p.rect('.tc-boost'), pause: await p.rect('.tc-pause') };
    const hud = await p.page.evaluate(`(() => { const c = document.querySelector('canvas').getBoundingClientRect(), k = c.width / 1280;
      return window.__game.scene.getScene('GameScene').children.list.filter((x) => x.type === 'Text' && x.visible && /^(P1|Lives|LASER|BOOST|\\d\\d:\\d\\d)/.test(x.text)).map((x) => { const b = x.getBounds(); return { left: c.left + b.x * k, top: c.top + b.y * k, right: c.left + (b.x + b.width) * k, bottom: c.top + (b.y + b.height) * k }; }); })()`);
    const inside = d.left >= 0 && d.top >= 0 && d.right <= w && d.bottom <= h;
    const clear = Object.values(r).every((x) => !overlaps(d, x)) && hud.every((x) => !overlaps(x, d));
    const scr = await p.scrollState();
    // a diagonal with FIRE held, by thumb
    const fire2 = await p.centre('.tc-fire');
    const pt = padPoint(d, 45);
    await p.finger.down(1, pt.x, pt.y);
    await p.finger.down(2, fire2.x, fire2.y);
    await sleep(120);
    const c2 = await p.cmd();
    await p.shot(`dpad-layout-${name}-pressed`);
    await p.finger.up(1);
    await p.finger.up(2);
    check(`[${name} ${w}x${h}] D-pad: ${Math.round(d.width)}px disc, inside the screen, clear of the buttons and the HUD; Up + Right + FIRE together; no overflow`, d.width >= 120 && inside && clear && c2.rotate === 1 && c2.move === 1 && c2.shoot && scr.sw <= scr.cw && scr.sh <= scr.ch, JSON.stringify({ d: [Math.round(d.left), Math.round(d.top), Math.round(d.width)], inside, clear }));
    await p.shot(`dpad-layout-${name}`);
    await p.context.close();
  }

  // =====================================================================================================
  // D9. After an automatic pause the thumb goes back to where the pad was. On a small phone that is the pause screen's MAIN MENU
  //     (seen at 667x375 and 740x360): one habitual tap there must not throw the run away.
  // =====================================================================================================
  for (const [w, h] of [
    [667, 375],
    [740, 360],
  ]) {
    const p = await mobilePage(w, h, { steering: null });
    await p.start();
    await p.play();
    await p.quiet();
    const pad = await p.rect('.tc-dpad');
    await p.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(250);
    // One habitual press, plus the bounce of a quick double press. (Repeated deliberate taps, more than 300 ms apart, would still
    // confirm: the question is shown in yellow on a paused screen. See docs/mobile-touch.md, "Known limitations".)
    const up = padPoint(pad, 0);
    await p.finger.tap(up.x, up.y, 30);
    await p.finger.tap(up.x, up.y, 30);
    await sleep(250);
    const texts = await p.texts();
    check(`[${w}x${h}] after an automatic pause, a press where the pad's UP arm was lands on MAIN MENU but does not leave the run`, (await p.activeScene()) === 'GameScene' && (await p.sim()).paused === true && texts.some((t) => /^TAP AGAIN TO QUIT/.test(t)), texts.filter((t) => /MENU|QUIT/.test(t)).join(' | '));
    await p.context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------
// Fullscreen: a scripted Fullscreen API (deterministic accept / reject / error / exit), the unsupported and installed-app cases,
// the layout after the viewport changes, the pause state, and whatever real fullscreen this Chromium offers.
// ---------------------------------------------------------------------------------------------------------

const FS_MOCK = `(() => {
  const state = { calls: [], exits: 0, mode: 'accept', el: null, active: [], events: [] };
  window.__fs = state;
  Object.defineProperty(document, 'fullscreenEnabled', { get: () => true, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', { get: () => state.el, configurable: true });
  Element.prototype.requestFullscreen = function (options) {
    state.calls.push(options || null);
    state.active.push(navigator.userActivation ? navigator.userActivation.isActive : null);
    state.events.push(window.event ? window.event.type : null);
    if (state.mode === 'throw') throw new TypeError('not allowed');
    if (state.mode === 'reject') {
      document.dispatchEvent(new Event('fullscreenerror'));
      return Promise.reject(new TypeError('Permissions check failed'));
    }
    state.el = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
  document.exitFullscreen = function () {
    state.exits++;
    state.el = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
})()`;

const UNSUPPORTED_MOCK = `(() => {
  // iPhone Safari: no document.fullscreenEnabled, no requestFullscreen (and no webkit one either).
  Object.defineProperty(document, 'fullscreenEnabled', { get: () => undefined, configurable: true });
  Element.prototype.requestFullscreen = undefined;
  delete Element.prototype.webkitRequestFullscreen;
})()`;

const STANDALONE_MOCK = `(() => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
})()`;

const pillState = (p) =>
  p.page.evaluate(() => {
    const b = document.querySelector('.tc-sys-btn');
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return { text: b.textContent, shown: cs.display !== 'none' && getComputedStyle(document.querySelector('.tc-system')).display !== 'none', warn: b.classList.contains('tc-warn'), rect: r.toJSON() };
  });
const tapPill = async (p) => {
  const c = await p.centre('.tc-sys-btn');
  await p.finger.tap(c.x, c.y, 70);
  await sleep(200);
};
const fsState = (p) => p.page.evaluate(`({ calls: window.__fs.calls.length, exits: window.__fs.exits, active: window.__fs.active, events: window.__fs.events, el: window.__fs.el ? window.__fs.el.tagName : null })`);

async function runFullscreen() {
  console.log('\n--- Fullscreen ---');
  // =====================================================================================================
  // F1. Supported (scripted API): enter from a real tap, track the change, exit, the pause state
  // =====================================================================================================
  const f = await mobilePage(844, 360);
  await f.page.addInitScript(FS_MOCK);
  await f.start();
  let s = await pillState(f);
  check('where fullscreen is supported the title screen has a FULLSCREEN control', s.shown && s.text === 'FULLSCREEN');
  await tapPill(f);
  let fs = await fsState(f);
  check('a real touch on it calls requestFullscreen() on the root element, once, with navigationUI hidden', fs.calls === 1 && fs.el === 'HTML' && JSON.stringify(await f.page.evaluate(`window.__fs.calls`)) === JSON.stringify([{ navigationUI: 'hide' }]), JSON.stringify(fs));
  check('the request ran inside the user gesture (user activation was active, from the touch pointerup)', fs.active[0] === true && fs.events[0] === 'pointerup', JSON.stringify({ active: fs.active, events: fs.events }));
  s = await pillState(f);
  check('after entering, the control says EXIT FULLSCREEN (tracked from fullscreenchange)', s.text === 'EXIT FULLSCREEN' && !s.warn);
  check('entering fullscreen did not start or restart the game (still the title screen)', (await f.activeScene()) === 'StartScene');

  // the viewport grows as the browser UI goes away (what real fullscreen does)
  const before = await f.page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().toJSON());
  await f.page.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  const after = await f.page.evaluate(() => ({ canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(), w: innerWidth, h: innerHeight }));
  check('the canvas re-fits the bigger viewport (FIT: larger, 16:9, centred, not stretched)', after.canvas.height > before.height && Math.abs(after.canvas.width / after.canvas.height - 16 / 9) < 0.01 && after.canvas.height <= after.h + 0.5 && Math.abs((after.canvas.left + after.canvas.right) / 2 - after.w / 2) < 1, JSON.stringify({ before: [Math.round(before.width), Math.round(before.height)], after: [Math.round(after.canvas.width), Math.round(after.canvas.height)] }));

  // play, check layout in "fullscreen", pause, exit
  await f.play();
  await f.quiet();
  await f.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 99`);
  await sleep(300);
  check('the Fullscreen control is not shown during play (the playfield is clear)', !(await pillState(f)).shown);
  const rects = { fire: await f.rect('.tc-fire'), laser: await f.rect('.tc-laser'), boost: await f.rect('.tc-boost'), pause: await f.rect('.tc-pause'), zone: await f.rect('.tc-zone') };
  check('in fullscreen FIRE, LASER, BOOST and PAUSE are visible, inside the screen and clear of each other', ['fire', 'laser', 'boost', 'pause'].every((k) => rects[k].display !== 'none' && rects[k].left >= 0 && rects[k].right <= 844 && rects[k].top >= 0 && rects[k].bottom <= 390) && !overlaps(rects.fire, rects.laser) && !overlaps(rects.fire, rects.boost) && !overlaps(rects.boost, rects.pause));
  const radius = await f.page.evaluate(`window.__game.registry.get('touchControls').model.stickRadius`);
  check('the joystick radius followed the new viewport (15 % of 390 = 59)', radius === 59, `radius ${radius}`);
  await f.shot('fullscreen-play-joystick');
  // a held finger when fullscreen changes is let go (the layout is moving under it)
  await f.finger.down(1, 150, 300);
  await f.finger.move(1, 110, 260);
  await sleep(100);
  const was = await f.cmd();
  await f.page.evaluate(`window.__fs.el = null; document.dispatchEvent(new Event('fullscreenchange'))`); // the system left fullscreen (back swipe)
  await sleep(150);
  check('the system leaving fullscreen mid-run releases the held finger but does not pause or restart the run', was.rotate < 0 && JSON.stringify(await f.cmd()) === NEUTRAL_CMD && (await f.sim()).paused === false && (await f.activeScene()) === 'GameScene');
  await f.finger.up(1);
  await f.page.evaluate(`window.__game.scene.getScene('GameScene').sim.__id = (window.__simId = Math.random())`);

  // pause, then fullscreen from the pause menu
  const pauseAt = await f.centre('.tc-pause');
  await f.finger.tap(pauseAt.x, pauseAt.y);
  await sleep(300);
  check('the pause screen shows the Fullscreen control', (await f.sim()).paused === true && (await pillState(f)).shown && (await pillState(f)).text === 'FULLSCREEN');
  await f.shot('fullscreen-pause');
  await tapPill(f);
  fs = await fsState(f);
  check('entering fullscreen from the pause menu keeps the game paused (it is not resumed) and the same run', fs.calls === 2 && (await f.sim()).paused === true && (await f.page.evaluate(`window.__game.scene.getScene('GameScene').sim.__id === window.__simId`)) && (await f.texts()).includes('RESUME'));
  await f.page.setViewportSize({ width: 844, height: 360 });
  await sleep(500);
  check('a viewport change while paused still leaves it paused, same run', (await f.sim()).paused === true && (await f.page.evaluate(`window.__game.scene.getScene('GameScene').sim.__id === window.__simId`)));
  await tapPill(f); // EXIT FULLSCREEN
  fs = await fsState(f);
  check('EXIT FULLSCREEN calls exitFullscreen(); the run stays paused and is not restarted', fs.exits === 1 && (await pillState(f)).text === 'FULLSCREEN' && (await f.sim()).paused === true && (await f.activeScene()) === 'GameScene');
  await f.tapGame(340, 300);
  await sleep(300);
  check('RESUME then works as usual', (await f.sim()).paused === false && (await f.overlayShown()));
  check('(fullscreen) no console errors', f.problems.length === 0, f.problems.join(' | '));
  await f.context.close();

  // =====================================================================================================
  // F2. Refusals: promise rejection, a throwing request, fullscreenerror
  // =====================================================================================================
  const rej = await mobilePage(844, 390);
  await rej.page.addInitScript(FS_MOCK);
  await rej.start();
  await rej.page.evaluate(`window.__fs.mode = 'reject'`);
  await tapPill(rej);
  s = await pillState(rej);
  check('a request the browser rejects is shown honestly (FULLSCREEN BLOCKED) and does not break the game', s.text === 'FULLSCREEN BLOCKED' && s.warn && (await rej.activeScene()) === 'StartScene', s.text);
  await rej.shot('fullscreen-blocked');
  await sleep(3200);
  s = await pillState(rej);
  check('the message clears by itself and the control is usable again', s.text === 'FULLSCREEN' && !s.warn);
  await rej.page.evaluate(`window.__fs.mode = 'throw'`);
  await tapPill(rej);
  check('a request that throws synchronously is handled the same way', (await pillState(rej)).text === 'FULLSCREEN BLOCKED');
  await sleep(3200);
  await rej.page.evaluate(`window.__fs.mode = 'accept'`);
  await tapPill(rej);
  check('a later request succeeds normally', (await pillState(rej)).text === 'EXIT FULLSCREEN');
  check('(refusals) no console errors and no unhandled promise rejections', rej.problems.length === 0, rej.problems.join(' | '));
  await rej.context.close();

  // =====================================================================================================
  // F3. Unsupported (iPhone Safari-like): no Fullscreen button, a Home Screen tip instead
  // =====================================================================================================
  const ios = await mobilePage(844, 390);
  await ios.page.addInitScript(UNSUPPORTED_MOCK);
  await ios.start();
  s = await pillState(ios);
  const iosTexts = await ios.texts('StartScene');
  check('where fullscreen is impossible there is no FULLSCREEN button anywhere (title screen)', s.shown && !/FULLSCREEN/i.test(s.text) && !iosTexts.some((x) => /FULLSCREEN/i.test(x)), s.text);
  check('it offers a tip control instead (HIDE ADDRESS BAR)', s.text === 'HIDE ADDRESS BAR');
  await tapPill(ios);
  const tip = await ios.page.evaluate(() => ({ open: document.querySelector('.tc-tip').classList.contains('tc-tip-open'), text: document.querySelector('.tc-tip').innerText, display: getComputedStyle(document.querySelector('.tc-tip')).display }));
  check('tapping it explains Add to Home Screen in plain words', tip.open && tip.display === 'flex' && /Home Screen/.test(tip.text) && /Share/.test(tip.text) && /address bar/.test(tip.text), tip.text.replace(/\n+/g, ' / '));
  await ios.shot('fullscreen-unsupported-tip');
  const ok = await ios.centre('.tc-tip-ok');
  const okBox = await ios.rect('.tc-tip-ok');
  check('the tip fits the phone screen and its OK button is at least 44 CSS px tall', okBox.height >= 44 && okBox.bottom <= 390 && (await ios.rect('.tc-tip-panel')).top >= 0);
  await ios.finger.tap(ok.x, ok.y, 70);
  await sleep(200);
  check('OK closes the tip, and the title screen is unaffected', !(await ios.page.evaluate(() => document.querySelector('.tc-tip').classList.contains('tc-tip-open'))) && (await ios.activeScene()) === 'StartScene');
  await ios.tapGame(940, 155);
  await ios.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  check('the game itself is unaffected by the missing Fullscreen API (starts and plays)', (await ios.overlayShown()) && !(await pillState(ios)).shown);
  check('(unsupported) no console errors', ios.problems.length === 0, ios.problems.join(' | '));
  await ios.context.close();

  // =====================================================================================================
  // F4. Already installed (standalone): nothing to offer
  // =====================================================================================================
  const std = await mobilePage(844, 390);
  await std.page.addInitScript(STANDALONE_MOCK);
  await std.start();
  s = await pillState(std);
  check('launched as an installed web app (display-mode: standalone) there is no fullscreen control or tip at all', !s.shown && !(await std.page.evaluate(() => document.querySelector('.tc-tip').classList.contains('tc-tip-open'))));
  await std.context.close();

  // =====================================================================================================
  // F5. The real thing, as far as headless Chromium goes
  // =====================================================================================================
  const real = await mobilePage(844, 390);
  await real.start();
  const caps = await real.page.evaluate(() => ({ enabled: document.fullscreenEnabled, request: typeof document.documentElement.requestFullscreen, secure: window.isSecureContext, standalone: matchMedia('(display-mode: standalone)').matches }));
  info(`real Chromium fullscreen support: ${JSON.stringify(caps)} (page served over ${BASE.startsWith('http://127') ? 'http://127.0.0.1, a secure context; a LAN IP over http is not' : BASE})`);
  s = await pillState(real);
  if (caps.enabled && caps.request === 'function') {
    check('real Chromium: the FULLSCREEN control is offered', s.text === 'FULLSCREEN');
    await tapPill(real);
    await sleep(500);
    const entered = await real.page.evaluate(() => ({ el: document.fullscreenElement ? document.fullscreenElement.tagName : null, w: innerWidth, h: innerHeight }));
    info(`after a real touch on the control: ${JSON.stringify(entered)}`);
    if (entered.el) {
      check('real fullscreen: the root element is fullscreen and the control now offers EXIT FULLSCREEN', entered.el === 'HTML' && (await pillState(real)).text === 'EXIT FULLSCREEN');
      const geo = await real.page.evaluate(() => ({ canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(), w: innerWidth, h: innerHeight }));
      check('real fullscreen: the canvas fits the new viewport and keeps 16:9', Math.abs(geo.canvas.width / geo.canvas.height - 16 / 9) < 0.01 && geo.canvas.width <= geo.w + 0.5 && geo.canvas.height <= geo.h + 0.5, JSON.stringify({ canvas: [Math.round(geo.canvas.width), Math.round(geo.canvas.height)], viewport: [geo.w, geo.h] }));
      await real.shot('fullscreen-real-title');
      await tapPill(real);
      await sleep(500);
      check('real fullscreen: EXIT FULLSCREEN leaves it, and the title screen is still there', !(await real.page.evaluate(() => document.fullscreenElement)) && (await real.activeScene()) === 'StartScene');
    } else {
      info('real fullscreen did not engage in this headless build: only the scripted API above is verified');
    }
  } else {
    info('this Chromium does not expose a usable Fullscreen API: only the scripted API above is verified');
  }
  await real.context.close();

  // =====================================================================================================
  // F6. Desktop (not touch mode) shows none of this
  // =====================================================================================================
  const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dp = await desk.newPage();
  await dp.goto(`${BASE}?debug`);
  await dp.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  const dstate = await dp.evaluate(() => ({ system: getComputedStyle(document.querySelector('.tc-system')).display, root: getComputedStyle(document.querySelector('.tc-root')).display, dpadBoxes: document.querySelector('.tc-dpad').getClientRects().length, steering: window.__game.registry.get('touchSteering').mode }));
  check('desktop: no Fullscreen control, no D-pad, nothing drawn (the keyboard game is unchanged)', dstate.system === 'none' && dstate.root === 'none' && dstate.dpadBoxes === 0, JSON.stringify(dstate)); // the pad is the default steering, but it is inside the hidden touch root: nothing is rendered
  await dp.keyboard.press('Space');
  await dp.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  await dp.keyboard.press('KeyP');
  await sleep(200);
  check('desktop: pausing shows no system controls either', (await dp.evaluate(() => getComputedStyle(document.querySelector('.tc-system')).display)) === 'none');
  await desk.close();
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
/**
 * `steering`: the touch steering choice a returning player has already saved. The sections written when the joystick was the only control
 * (and the default) seed 'joystick' so they keep testing it; pass `null` for a first-time visitor, who gets the D-pad. A seeded value is only
 * written when nothing is saved, so choices made during the test (and reloads) are never overwritten.
 */
async function mobilePage(width, height, { query = '?debug', mobile = true, touch = true, steering = 'joystick' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: touch });
  if (steering) {
    await context.addInitScript((value) => {
      try {
        if (localStorage.getItem('asteroids.touchSteering') === null) localStorage.setItem('asteroids.touchSteering', value);
      } catch {
        // storage blocked: nothing to seed
      }
    }, steering);
  }
  // A new visitor's soundtrack is Random now; this suite's checks are about the Original track's level and key, so it starts on Original (the music suite covers the default).
  await context.addInitScript(() => {
    try {
      if (localStorage.getItem('asteroids.musicTrack') === null) localStorage.setItem('asteroids.musicTrack', 'original');
    } catch {
      // storage blocked: nothing to seed
    }
  });
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
    /** Several fingers landing in the same touchstart (two fingers, or a palm). `list`: [[id, x, y], ...]. */
    async downMany(list) {
      for (const [id, x, y] of list) pts.set(id, { x, y });
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
          instances: g.sound.sounds.filter((s) => s.key.startsWith('music')).length, vm: a.volume('music'), vs: a.volume('sfx'), muted: a.music.isMuted }; })()`),
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
      await api.tapGame(940, 155);
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
  check('RESUME after a focus loss resumes play', (await m.sim()).paused === false && (await m.overlayShown()));

  // =====================================================================================================
  // 5. Game over, retry, menu
  // =====================================================================================================
  await m.page.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
    s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
  await m.finger.down(14, fire.x, fire.y); // still firing as the ship is lost
  await waitGameOver(m, 'firing-as-ship-lost');
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
  await waitGameOver(m, 'second-game-over');
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
  // back to the title: pause -> MAIN MENU by touch. MAIN MENU throws the run away, so it takes two taps.
  const p2 = await m.centre(sel.pause);
  await m.finger.tap(p2.x, p2.y);
  await sleep(250);
  await m.tapGame(340, 460);
  await sleep(300);
  check('ONE tap on the pause screen\'s MAIN MENU does not leave the run: it asks "TAP AGAIN TO QUIT"', (await m.activeScene()) === 'GameScene' && (await m.sim()).paused === true && (await m.texts()).some((t) => /^TAP AGAIN TO QUIT/.test(t)));
  await m.tapGame(340, 300); // RESUME instead
  await sleep(300);
  await m.finger.tap(p2.x, p2.y);
  await sleep(250);
  check('the question does not carry over to the next pause (MAIN MENU is back to one plain label)', (await m.texts()).includes('MAIN MENU') && !(await m.texts()).some((t) => /TAP AGAIN/.test(t)));
  await m.tapGame(340, 460);
  await sleep(500);
  await m.tapGame(340, 460); // the deliberate second tap
  await m.page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  await sleep(200);
  check('a second tap on MAIN MENU goes to the title screen', (await m.texts('StartScene')).includes('TAP TO PLAY'));
  // The keyboard switch takes two taps: one stray thumb must not hide every touch control.
  // Nor may one accidental contact made of two touches: two fingers (or a palm) landing together, or a bouncing thumb.
  const ctl = await m.css(940, 664);
  await m.finger.downMany([[31, ctl.x - 40, ctl.y], [32, ctl.x + 40, ctl.y]]);
  await sleep(70);
  await m.finger.up(31);
  await m.finger.up(32);
  await sleep(400);
  check('two fingers landing together on CONTROLS do not switch (they count as one tap: it only asks)', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /TAP AGAIN TO SWITCH/.test(t)) && (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  await sleep(3400);
  await m.finger.tap(ctl.x, ctl.y, 30);
  await m.finger.tap(ctl.x, ctl.y, 30); // lands well inside the 300 ms that count as the same contact
  await sleep(400);
  check('a bouncing double contact (two quick taps) does not switch either', (await m.bodyClasses()).includes('tc-active') && (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  await sleep(3400);
  await m.tapGame(940, 664);
  await sleep(300);
  check('ONE tap on the CONTROLS (keyboard) button does not switch: it asks "TAP AGAIN" and touch controls stay on', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /TAP AGAIN TO SWITCH/.test(t)) && (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  await m.shot('07a-title-tap-again');
  await sleep(3400);
  check('the question lapses by itself if nobody taps again', (await m.bodyClasses()).includes('tc-active') && !(await m.texts('StartScene')).some((t) => /TAP AGAIN/.test(t)) && (await m.texts('StartScene')).some((t) => t.startsWith('CONTROLS: TOUCH')));
  await m.tapGame(940, 664);
  await sleep(1200);
  check('a tap long after the first one only asks again (still touch mode)', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /TAP AGAIN TO SWITCH/.test(t)));
  await m.tapGame(940, 664); // the confirming tap, inside the window
  await m.page.waitForFunction(() => window.__game.scene.getScene('StartScene').sys.isActive() && window.__game.scene.getScene('StartScene').children.list.some((c) => c.type === 'Text' && /Press SPACE/.test(c.text)), null, { timeout: 5000 });
  check('the CONTROLS switch on the title screen turns touch off: the keyboard / controller title screen appears', !(await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /Press SPACE/.test(t)));
  check('the choice is remembered for next time', (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === 'desktop');
  check('a touch-capable device in keyboard mode is still offered a way back', (await m.texts('StartScene')).some((t) => t.startsWith('TOUCH CONTROLS: OFF')));
  await m.shot('07-title-keyboard-mode');
  const turnOn = await gameRectCss(m, 940, 3, 1240, 93);
  const turnOnTexts = await m.texts('StartScene');
  check('the way back is a big button, not small text: at least 44 CSS px tall and 120 wide, top right, labelled in words', turnOn.height >= 44 && turnOn.width >= 120 && turnOnTexts.some((t) => /^TOUCH CONTROLS: OFF\nTAP TO TURN ON$/.test(t)), JSON.stringify({ w: Math.round(turnOn.width), h: Math.round(turnOn.height), texts: turnOnTexts.filter((t) => /TOUCH/.test(t)) }));
  check('a phone in keyboard mode says "Press SPACE to start" (a tap does not start it)', turnOnTexts.includes('Press SPACE to start'), turnOnTexts.filter((t) => /Press/.test(t)).join('|'));
  await m.tapGame(200, 300); // empty space
  await m.tapGame(640, 630); // on the prompt itself
  await sleep(400);
  check('a stray tap anywhere on the keyboard title screen of a phone does NOT start a game', (await m.activeScene()) === 'StartScene');
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
  const turnOn2 = await gameRectCss(m, 940, 3, 1240, 93);
  await m.finger.tap((turnOn2.left + turnOn2.right) / 2, (turnOn2.top + turnOn2.bottom) / 2); // the centre of the big button, on a real touch
  await sleep(500);
  check('tapping TOUCH CONTROLS brings the touch screen back', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).includes('TAP TO PLAY'));
  await m.context.close();

  // ?touch=0 on a phone: the URL decides for the visit
  const forced = await mobilePage(844, 390, { query: '?debug&touch=0' });
  await forced.start();
  check('?touch=0 forces the keyboard game on a phone', !(await forced.bodyClasses()).includes('tc-active') && (await forced.texts('StartScene')).some((t) => /Press SPACE/.test(t)));
  check('...and saves nothing (the URL only decides for this visit)', (await forced.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  // The way back must also survive a clumsy touch: two fingers landing on it together switch once, not twice (back to keyboard).
  const turnOn3 = await gameRectCss(forced, 940, 3, 1240, 93);
  const tcy = (turnOn3.top + turnOn3.bottom) / 2;
  await forced.finger.downMany([[41, turnOn3.left + 40, tcy], [42, turnOn3.right - 40, tcy]]);
  await sleep(70);
  await forced.finger.up(41);
  await forced.finger.up(42);
  await sleep(500);
  check('two fingers landing together on TOUCH CONTROLS still bring the touch screen back', (await forced.bodyClasses()).includes('tc-active') && (await forced.texts('StartScene')).includes('TAP TO PLAY'));
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
  await portrait.tapGame(940, 155); // a tap where PLAY would be must not start a game
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
  const dcontext = await dpage.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('canvas').dispatchEvent(e);
    return e.defaultPrevented;
  });
  check('desktop: the right-click context menu is not suppressed (only touch mode blocks the long-press menu)', dcontext === false);
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

  await runDpad();
  await runFullscreen();

  // =====================================================================================================
  // 9. Overall health
  // =====================================================================================================
  check('no console errors, page errors or failed requests on the phone pages', m.problems.length === 0, m.problems.join(' | '));
  check('the audio files were requested and loaded (no 4xx)', m.requests.some((r) => /\.ogg$/.test(r.url) && r.status === 200), m.requests.filter((r) => /\.ogg/.test(r.url)).length + ' ogg requests');
  const cssUrls = [...new Set(m.requests.filter((r) => /\.css$/.test(r.url)).map((r) => r.url))];
  check('the touch stylesheet is part of the build and loads (one file, from the same origin and base path)', cssUrls.length === 1 && m.requests.filter((r) => /\.css$/.test(r.url)).every((r) => r.status === 200), cssUrls.join(' '));
}
