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

const movementOf = (p) => p.page.evaluate(`window.__game.registry.get('touchMovement').mode`);
const savedMovement = (p) => p.page.evaluate(() => localStorage.getItem('asteroids.touchMovement'));

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

// ---------------------------------------------------------------------------------------------------------
// Movement modes: Point-to-Fly and Assisted Flight on real (emulated) multi-touch, in a running game
// ---------------------------------------------------------------------------------------------------------

/** Pygame heading (0 = Down, 90 = Left, 180 = Up, 270 = Right) -> the thumb offset (CSS px, y down) that asks for it. */
const headingOffset = (heading, d = 46) => {
  const a = (heading * Math.PI) / 180;
  return { dx: -Math.sin(a) * d, dy: Math.cos(a) * d };
};
const angleApart = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const headingOfMove = (dx, dy) => ((((Math.atan2(-dx, dy) * 180) / Math.PI) % 360) + 360) % 360;

/** Puts the ship at the middle of the playfield facing `rot`, with nothing else going on, and waits a moment. */
async function recentre(t, rot = 0) {
  await t.page.evaluate(
    ([rot]) => {
      const s = window.__game.scene.getScene('GameScene').sim;
      s.spawner.spawnTimer = -1e9;
      s.asteroids.length = 0;
      s.player.position = { x: 640, y: 360 };
      s.player.rotation = rot;
      s.player.travelHeading = null;
      s.player.lives = 99;
    },
    [rot],
  );
  await sleep(60);
}

/** Waits until the simulation clock has advanced by `seconds` (the sim is paused by pausing, so this follows game time, not wall time). */
async function simSeconds(t, seconds) {
  const start = (await t.sim()).time;
  await t.page.waitForFunction(([from, secs]) => window.__game.scene.getScene('GameScene').sim.time - from >= secs, [start, seconds], { timeout: 8000, polling: 16 });
}

async function runMovement() {
  console.log('\n--- Movement modes (Point-to-Fly, Assisted Flight) ---');
  for (const mode of ['pointToFly', 'assisted']) {
    const label = mode === 'pointToFly' ? 'Point-to-Fly' : 'Assisted Flight';
    const t = await mobilePage(844, 390, { steering: mode });
    await t.start();
    check(`[${label}] saved choice applied: the stick is the live control`, (await movementOf(t)) === mode);
    await t.play();
    await recentre(t);
    check(`[${label}] in the run the joystick zone and STEER ring are on screen, the D-pad is not`, (await t.rect('.tc-zone')).display === 'block' && (await t.rect('.tc-hint')).display !== 'none' && (await t.rect('.tc-dpad')).display === 'none');
    await t.shot(`movement-${mode}-play-idle`);

    // Landing and tiny wobbles do nothing (dead zone); ship stays put
    await t.finger.down(1, 150, 250);
    await sleep(80);
    let c = await t.cmd();
    check(`[${label}] landing the thumb is neutral`, c.move === 0 && c.rotate === 0 && c.steer === undefined, JSON.stringify(c));
    await t.finger.move(1, 154, 253);
    await sleep(120);
    c = await t.cmd();
    const idle = await t.sim();
    check(`[${label}] a few pixels of wobble inside the dead zone does nothing (no command, ship still)`, c.move === 0 && c.steer === undefined && idle.x === 640 && idle.y === 360, JSON.stringify([c, idle.x, idle.y]));
    await t.shot(`movement-${mode}-play-deadzone`);

    // The eight directions: the ship turns to face the thumb and then flies that way
    const dirs = [[180, 'up'], [270, 'right'], [0, 'down'], [90, 'left'], [225, 'up-right'], [135, 'up-left'], [315, 'down-right'], [45, 'down-left']];
    const results = [];
    for (const [heading, name] of dirs) {
      await t.finger.up(1);
      await sleep(60);
      await recentre(t, 100);
      const o = headingOffset(heading);
      await t.finger.down(1, 150, 250);
      await t.finger.move(1, 150 + o.dx, 250 + o.dy);
      await sleep(60);
      const cmd = await t.cmd();
      const before = await t.sim();
      await simSeconds(t, 0.9);
      const after = await t.sim();
      const moved = headingOfMove(after.x - before.x, after.y - before.y);
      const ok =
        cmd.steer && angleApart(cmd.steer.heading, heading) < 0.5 && cmd.steer.mode === (mode === 'assisted' ? 'assist' : 'point') && cmd.move === 1 && cmd.rotate === 0 &&
        angleApart(after.rot, heading) < 2 && Math.hypot(after.x - before.x, after.y - before.y) > 150;
      // Assisted travels straight at the thumb; Point-to-Fly curves round while it is still turning, so only the later part is straight.
      const straight = mode === 'assisted' ? angleApart(moved, heading) < 25 : true;
      results.push(`${name}:${ok && straight ? 'ok' : `BAD(${JSON.stringify([cmd.steer, Math.round(after.rot), Math.round(moved)])})`}`);
    }
    check(`[${label}] thumb up / down / left / right and the four diagonals: the nose settles on that heading and the ship flies off`, results.every((r) => r.endsWith(':ok')), results.join(' '));
    await t.finger.up(1);
    await sleep(60);

    // Release: stops, keeps its heading, nothing stuck
    await recentre(t, 0);
    await t.finger.down(2, 150, 250);
    await t.finger.move(2, 150 + 46, 250);
    await simSeconds(t, 0.4);
    await t.finger.up(2);
    await sleep(80);
    const rel1 = await t.sim();
    await sleep(400);
    const rel2 = await t.sim();
    check(`[${label}] releasing the stick stops thrust and steering at once: no drift, no more turning, neutral command`, rel1.x === rel2.x && rel1.y === rel2.y && rel1.rot === rel2.rot && JSON.stringify(await t.cmd()) === NEUTRAL_CMD, JSON.stringify([rel1, rel2]));
    check(`[${label}] and the simulation has forgotten any assisted travel direction`, (await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.travelHeading`)) === null);

    // The stick beside FIRE, LASER and BOOST: four fingers
    await recentre(t, 100);
    const fire = await t.centre('.tc-fire');
    const laser = await t.centre('.tc-laser');
    const boost = await t.centre('.tc-boost');
    const before = await t.sim();
    await t.finger.down(3, 150, 250);
    await t.finger.move(3, 150, 250 - 46);
    await t.finger.down(4, fire.x, fire.y);
    await sleep(250);
    const shotsWhileFiring = (await t.sim()).shots;
    await t.finger.down(5, laser.x, laser.y);
    await sleep(100);
    await t.finger.down(6, boost.x, boost.y);
    await sleep(150);
    c = await t.cmd();
    const during = await t.sim();
    check(`[${label}] stick + FIRE + LASER + BOOST at once: all four commands arrive, the ship shoots, fires the laser and boosts`, c.shoot && c.laser && c.boost && c.steer && c.move === 1 && shotsWhileFiring >= 1 && during.laser === before.laser - 1 && during.boost === true, JSON.stringify([c, shotsWhileFiring, before.laser, during.laser, during.boost]));
    await t.shot(`movement-${mode}-play-four-fingers`);
    await t.finger.up(4);
    await sleep(80);
    c = await t.cmd();
    check(`[${label}] lifting FIRE keeps the stick, LASER and BOOST`, !c.shoot && c.laser && c.boost && c.steer, JSON.stringify(c));
    for (const id of [3, 5, 6]) await t.finger.up(id);
    await sleep(100);
    check(`[${label}] with every finger lifted the command is neutral`, JSON.stringify(await t.cmd()) === NEUTRAL_CMD);

    // A cancelled touch and focus loss leave nothing held
    await t.finger.down(7, 150, 250);
    await t.finger.move(7, 150 + 46, 250);
    await t.finger.down(8, fire.x, fire.y);
    await sleep(100);
    await t.finger.cancelAll();
    await sleep(120);
    check(`[${label}] a cancelled touch leaves no stuck thrust, heading or FIRE`, JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
    await t.finger.down(9, 150, 250);
    await t.finger.move(9, 150, 250 + 46);
    await sleep(80);
    await t.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(200);
    check(`[${label}] losing focus releases the stick and pauses`, (await t.sim()).paused === true && JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
    await t.finger.up(9);

    // Switch mode from the pause menu: the run carries on, nothing activates
    const other = mode === 'pointToFly' ? 'assisted' : 'pointToFly';
    const otherName = other === 'pointToFly' ? 'POINT-TO-FLY' : 'ASSISTED FLIGHT';
    // (The four-finger test above may have left the ship against a wall; the game's own wall-bounce impulse would keep nudging it after RESUME. That is existing physics, not input, so it is cleared here.)
    await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.velocity = { x: 0, y: 0 }`);
    const snap = await t.sim();
    await t.tapItem('controls', { scene: 'GameScene' });
    await t.shot(`movement-${mode}-pause-controls`);
    await t.tapItem('movement', { zone: otherName, scene: 'GameScene' });
    const snap2 = await t.sim();
    check(`[${label}] choosing ${otherName} in the pause menu applies it and keeps the run frozen as it was (position, heading, lives, score, shots, time)`, (await movementOf(t)) === other && snap2.paused === true && ['x', 'y', 'rot', 'lives', 'score', 'shots', 'laser', 'boost', 'time'].every((k) => snap[k] === snap2[k]), JSON.stringify([snap, snap2]));
    await t.tapItem('back', { scene: 'GameScene' });
    await t.tapItem('resume', { scene: 'GameScene' });
    await sleep(60);
    const resumed = await t.sim();
    await sleep(400);
    const later = await t.sim();
    check(`[${label}] after RESUME in ${otherName} the ship is where it was, still, with no stale thrust and no ghost FIRE / LASER / BOOST`, later.paused === false && later.x === resumed.x && later.y === resumed.y && later.laser === snap.laser && later.boost === snap.boost && later.shots <= snap.shots && JSON.stringify(await t.cmd()) === NEUTRAL_CMD, JSON.stringify([snap, resumed, later]));
    check(`[${label}] the stick works in the new mode straight away`, await (async () => {
      await t.finger.down(10, 150, 250);
      await t.finger.move(10, 150 + 46, 250);
      await sleep(100);
      const cc = await t.cmd();
      await t.finger.up(10);
      return cc.steer?.mode === (other === 'assisted' ? 'assist' : 'point');
    })());
    check(`[${label}] no console errors`, t.problems.length === 0, t.problems.join(' | '));
    await t.context.close();
  }

  // ---- Same input, two modes: the trajectories differ the way they should ---------------------------------------------------
  {
    const t = await mobilePage(844, 390, { steering: 'pointToFly' });
    await t.start();
    await t.play();
    const trial = async (mode) => {
      await t.page.evaluate((m) => window.__game.registry.get('touchMovement').set(m), mode);
      await sleep(80);
      await recentre(t, 270);
      await t.page.evaluate(() => {
        window.__game.scene.getScene('GameScene').sim.player.position = { x: 300, y: 360 };
      });
      await t.finger.down(1, 150, 250);
      await t.finger.move(1, 150 + 46, 250); // right
      await simSeconds(t, 0.5);
      const a = await t.sim();
      await t.finger.move(1, 150, 250 - 46); // flick to up
      await simSeconds(t, 0.35);
      const b = await t.sim();
      await t.finger.up(1);
      await sleep(80);
      return { sideways: b.x - a.x, up: a.y - b.y };
    };
    const p = await trial('pointToFly');
    const a = await trial('assisted');
    info(`flick right -> up, 0.35 s later: Point-to-Fly went ${p.sideways.toFixed(0)} px further right and ${p.up.toFixed(0)} px up; Assisted Flight ${a.sideways.toFixed(0)} px right and ${a.up.toFixed(0)} px up`);
    check('identical start and identical thumb: Assisted Flight gets going up sooner and wastes less sideways than Point-to-Fly', a.up > p.up + 10 && a.sideways < p.sideways - 10, JSON.stringify({ p, a }));
    check('(both modes) no console errors', t.problems.length === 0, t.problems.join(' | '));
    await t.context.close();
  }

  // ---- Layout and screenshots on small and large landscape phones -----------------------------------------------------------
  const SIZES = [
    [667, 375, 'small'],
    [844, 390, 'medium'],
    [932, 430, 'large'],
  ];
  for (const [w, h, name] of SIZES) {
    for (const mode of ['classic', 'pointToFly', 'assisted']) {
      const t = await mobilePage(w, h, { steering: mode });
      await t.start();
      // the Controls page (title screen)
      await t.tapItem('controls');
      const segs = [];
      for (const zone of ['CLASSIC D-PAD', 'POINT-TO-FLY', 'ASSISTED FLIGHT']) segs.push(await t.itemRect('movement', { zone }));
      const others = [];
      for (const id of ['haptics', 'test-vibration', 'to-keyboard', 'back']) others.push(await t.itemRect(id));
      const boxes = [...segs, ...others.filter(Boolean)];
      let anyOverlap = false;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j])) anyOverlap = true;
      const canvas = await t.rect('canvas');
      const textBounds = await t.page.evaluate(`(() => { const sc = window.__game.scene.getScene('StartScene'); const out = []; const walk = (list, v) => { for (const c of list) { const vis = v && c.visible; if (c.type === 'Text' && vis && c.text) { const b = c.getBounds(); out.push({ text: c.text, left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height }); } if (c.list) walk(c.list, vis); } }; walk(sc.children.list, true); return out; })()`);
      const spill = textBounds.filter((b) => b.left < 0 || b.right > 1280 || b.top < 0 || b.bottom > 720);
      const segSizeOk = segs.every((r) => r.height >= 44 && r.width >= 100 && r.left >= canvas.left && r.right <= canvas.right);
      const sel = (await t.page.evaluate(`window.__game.registry.get('touchMovement').mode`));
      // is the selected caption the only one lit? (read from the page's own text colours)
      const lit = await t.page.evaluate(`(() => { const sc = window.__game.scene.getScene('StartScene'); const out = []; const walk = (list) => { for (const c of list) { if (c.type === 'Text' && ['CLASSIC D-PAD', 'POINT-TO-FLY', 'ASSISTED FLIGHT'].includes(c.text)) out.push([c.text, c.style.color]); if (c.list) walk(c.list); } }; walk(sc.children.list); return out; })()`);
      const gold = lit.filter(([, color]) => color === lit.find(([text]) => text === ({ classic: 'CLASSIC D-PAD', pointToFly: 'POINT-TO-FLY', assisted: 'ASSISTED FLIGHT' })[sel])?.[1]);
      check(`[${name} ${w}x${h}, ${mode}] CONTROLS page: three thumb-sized mode buttons inside the screen, nothing overlapping, no text spilling off, the chosen mode marked`, segSizeOk && !anyOverlap && spill.length === 0 && gold.length >= 1 && sel === mode, JSON.stringify({ segs: segs.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`), anyOverlap, spill: spill.map((s) => s.text), sel }));
      await t.shot(`movement-controls-${name}-${mode}`);
      await t.tapItem('back');
      await t.play();
      await t.quiet();
      await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 99`);
      await sleep(250);
      if (mode !== 'classic') {
        await t.finger.down(1, 120, h - 150);
        await t.finger.move(1, 120 + 38, h - 150 - 38);
        await sleep(200);
        const base = await t.rect('.tc-base');
        const buttons = { fire: await t.rect('.tc-fire'), laser: await t.rect('.tc-laser'), boost: await t.rect('.tc-boost'), pause: await t.rect('.tc-pause') };
        const clear = Object.values(buttons).every((r) => !overlaps(base, r));
        const inside = base.left >= 0 && base.top >= 0 && base.right <= w && base.bottom <= h;
        check(`[${name} ${w}x${h}, ${mode}] the stick's ring while held is inside the screen and clear of FIRE / LASER / BOOST / PAUSE`, clear && inside, JSON.stringify({ base: [Math.round(base.left), Math.round(base.top), Math.round(base.width)], clear, inside }));
        await t.shot(`movement-play-${name}-${mode}`);
        await t.finger.up(1);
      } else {
        const pad = await t.rect('.tc-dpad');
        await t.finger.down(1, pad.left + pad.width * 0.5, pad.top + pad.height * 0.15);
        await sleep(150);
        await t.shot(`movement-play-${name}-${mode}`);
        await t.finger.up(1);
      }
      // pause menu with the Controls page open
      const pauseAt = await t.centre('.tc-pause');
      await t.finger.down(2, pauseAt.x, pauseAt.y);
      await t.finger.up(2);
      await sleep(250);
      await t.tapItem('controls', { scene: 'GameScene' });
      await t.shot(`movement-pause-${name}-${mode}`);
      const pm = (await t.menu('GameScene')).items.find((i) => i.id === 'movement');
      check(`[${name} ${w}x${h}, ${mode}] the pause menu's CONTROLS page has the movement selector`, !!pm && pm.zones.length === 3, JSON.stringify(pm?.zones?.map((z) => z.name)));
      check(`[${name} ${w}x${h}, ${mode}] no console errors`, t.problems.length === 0, t.problems.join(' | '));
      await t.context.close();
    }
  }
}

async function runDpad() {
  console.log('\n--- D-pad ---');
  // =====================================================================================================
  // D1. Title screen: the choice, the Fullscreen pill, layout
  // =====================================================================================================
  const t = await mobilePage(844, 390, { steering: 'classic' }); // a player who chose Classic D-Pad (a first-time visitor gets Assisted Flight, see D7)
  await t.start();
  let texts = await t.texts('StartScene');
  check('the title screen shows the D-pad in its controls reference (Classic D-Pad saved), and no movement switch of its own', texts.includes('D-PAD') && texts.includes('Move and turn') && !texts.includes('MOVEMENT') && !texts.includes('POINT-TO-FLY'), texts.join(' | ').slice(0, 200));
  check('a player with Classic D-Pad saved keeps it (the Assisted Flight default does not replace an explicit choice)', (await movementOf(t)) === 'classic' && (await savedMovement(t)) === 'classic');
  const pill = await t.rect('.tc-sys-btn');
  const pillText = await t.page.evaluate(() => document.querySelector('.tc-sys-btn').textContent);
  check('the title screen shows the Fullscreen control, at least 44 CSS px tall, inside the screen, top right', (await t.rect('.tc-system')).display === 'block' && pillText === 'FULLSCREEN' && pill.height >= 44 && pill.right <= 844 && pill.top >= 0 && pill.left > 422 && pill.top < 30, `${pillText} ${Math.round(pill.width)}x${Math.round(pill.height)} at ${Math.round(pill.left)},${Math.round(pill.top)}`);
  const playBtn = await t.itemRect('play');
  check('the Fullscreen control does not cover the PLAY button, and PLAY is big (at least 100 CSS px wide, 60 tall)', !overlaps(pill, playBtn) && playBtn.width >= 100 && playBtn.height >= 60, JSON.stringify({ pill: [pill.left, pill.bottom], play: [playBtn.right, playBtn.top, playBtn.width, playBtn.height] }));
  const doors = [await t.itemRect('audio'), await t.itemRect('controls'), await t.itemRect('powerups')];
  check('AUDIO, CONTROLS and the power-up legend are thumb-sized targets (at least 44 CSS px tall), inside the screen, and nothing overlaps', doors.every((r) => r.height >= 44 && r.left >= 0 && r.right <= 844 && r.bottom <= 390) && !overlaps(doors[0], doors[1]) && !overlaps(doors[0], playBtn) && !overlaps(doors[2], playBtn), doors.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`).join(' '));
  await t.shot('dpad-title');

  // the steering choice is on CONTROLS: one tap away, and it applies at once
  await t.tapItem('controls');
  texts = await t.texts('StartScene');
  check('the CONTROLS page offers MOVEMENT: CLASSIC D-PAD | POINT-TO-FLY | ASSISTED FLIGHT, and says what the lit one does', (await t.menu()).page === 'controls' && ['MOVEMENT', 'CLASSIC D-PAD', 'POINT-TO-FLY', 'ASSISTED FLIGHT'].every((x) => texts.includes(x)) && texts.some((x) => /original controls/.test(x)) && !texts.includes('STEERING') && !texts.includes('JOYSTICK'), texts.join(' | ').slice(0, 300));
  const segs = [await t.itemRect('movement', { zone: 'CLASSIC D-PAD' }), await t.itemRect('movement', { zone: 'POINT-TO-FLY' }), await t.itemRect('movement', { zone: 'ASSISTED FLIGHT' })];
  check('all three movement buttons are at least 44 CSS px tall and 100 wide (thumb-sized), side by side without overlap', segs.every((r) => r.height >= 44 && r.width >= 100) && !overlaps(segs[0], segs[1]) && !overlaps(segs[1], segs[2]), segs.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`).join(' '));
  await t.shot('movement-controls-page-classic');
  await t.tapItem('movement', { zone: 'POINT-TO-FLY' });
  check('tapping POINT-TO-FLY selects it, applies it at once and saves it', (await movementOf(t)) === 'pointToFly' && (await savedMovement(t)) === 'pointToFly');
  check('and the page now explains Point-to-Fly', (await t.texts('StartScene')).some((x) => /Point where you want the ship to face/.test(x)));
  await t.shot('movement-controls-page-pointtofly');
  await t.tapItem('movement', { zone: 'ASSISTED FLIGHT' });
  check('tapping ASSISTED FLIGHT selects it, applies it at once and saves it', (await movementOf(t)) === 'assisted' && (await savedMovement(t)) === 'assisted');
  await t.shot('movement-controls-page-assisted');
  await t.tapItem('back');
  check('back on the title screen, the how-to reference says what the stick does', (await t.menu()).page === 'title' && (await t.texts('StartScene')).includes('STICK') && (await t.texts('StartScene')).includes('Point to travel'));
  await t.tapItem('controls');
  await t.tapItem('movement', { zone: 'CLASSIC D-PAD' });
  check('tapping CLASSIC D-PAD selects it again and applies it at once', (await movementOf(t)) === 'classic');
  check('the choice is saved in localStorage', (await savedMovement(t)) === 'classic');
  await t.shot('movement-title-classic-selected');
  await t.tapItem('back');
  check('...and the reference says what the D-pad does once CLASSIC D-PAD is chosen again', (await t.texts('StartScene')).includes('D-PAD') && (await t.texts('StartScene')).includes('Move and turn'));
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  check('after a reload CLASSIC D-PAD is still selected (the choice persists between sessions)', (await movementOf(t)) === 'classic');
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
  check('the pause menu offers CONTROLS, and the Fullscreen control', (await t.texts()).includes('CONTROLS') && (await t.rect('.tc-system')).display === 'block');
  await t.shot('dpad-pause');
  await t.finger.up(13);
  await sleep(300);

  // switch to Point-to-Fly FROM THE PAUSE MENU (CONTROLS -> POINT-TO-FLY), then resume
  const runBefore = await t.sim();
  await t.tapItem('controls', { scene: 'GameScene' });
  check("the pause menu's CONTROLS page offers the movement choice with CLASSIC D-PAD lit, and the run stays paused", (await t.texts()).includes('MOVEMENT') && (await t.menu('GameScene')).page === 'controls' && (await t.sim()).paused === true && (await movementOf(t)) === 'classic');
  await t.shot('movement-pause-controls-classic');
  await t.tapItem('movement', { zone: 'POINT-TO-FLY', scene: 'GameScene' });
  check('the pause menu switches to Point-to-Fly by touch and remembers it', (await movementOf(t)) === 'pointToFly' && (await savedMovement(t)) === 'pointToFly');
  await t.shot('movement-pause-controls-pointtofly');
  check("the pause menu's CONTROLS page has no keyboard switch (the mode cannot change mid-run)", !(await t.menu('GameScene')).items.some((i) => i.id === 'to-keyboard'));
  const runDuring = await t.sim();
  check('changing mode while paused keeps the run exactly as it was (same position, heading, lives, score, time; still paused)', runDuring.paused === true && runDuring.x === runBefore.x && runDuring.y === runBefore.y && runDuring.rot === runBefore.rot && runDuring.lives === runBefore.lives && runDuring.score === runBefore.score && runDuring.time === runBefore.time, JSON.stringify([runBefore, runDuring]));
  await t.tapItem('back', { scene: 'GameScene' });
  await t.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
  check('after RESUME the joystick zone is back and the D-pad is gone', (await t.rect('.tc-zone')).display === 'block' && (await t.rect('.tc-dpad')).display === 'none' && (await t.rect('.tc-hint')).display !== 'none');
  check('and nothing fired or activated by the menu taps (no shots, laser charges and boost unchanged)', (await t.sim()).shots <= runBefore.shots && (await t.sim()).laser === runBefore.laser && (await t.sim()).boost === runBefore.boost && JSON.stringify(await t.cmd()) === NEUTRAL_CMD, JSON.stringify([runBefore, await t.sim()]));
  await t.finger.down(15, 150, 280);
  await t.finger.move(15, 150 - 45, 280 - 45);
  await sleep(100);
  c = await t.cmd();
  check('the Point-to-Fly stick: thumb up-left asks the ship to face up-left (heading 135) and fly, with no rotate command', c.steer && Math.abs(c.steer.heading - 135) < 0.5 && c.steer.mode === 'point' && c.move === 1 && c.rotate === 0, JSON.stringify(c));
  await t.finger.down(16, fire.x, fire.y);
  await t.finger.down(17, laser.x, laser.y);
  await t.finger.down(18, boost.x, boost.y);
  await sleep(100);
  c = await t.cmd();
  check('Point-to-Fly stick + FIRE + LASER + BOOST all work together (four fingers)', c.shoot && c.laser && c.boost && c.steer?.mode === 'point', JSON.stringify(c));
  // switch mode while those fingers are down (programmatically: the UI only offers it on menu screens)
  await t.page.evaluate(`window.__game.registry.get('touchMovement').set('classic')`);
  await sleep(100);
  check('switching from the stick to Classic while the fingers are down releases everything and removes the joystick', JSON.stringify(await t.cmd()) === NEUTRAL_CMD && (await t.rect('.tc-zone')).display === 'none' && (await t.rect('.tc-dpad')).display !== 'none' && (await t.rect('.tc-base')).display === 'none');
  await t.finger.move(15, 60, 60);
  await sleep(60);
  check('the old joystick finger keeps moving and does nothing', JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  for (const id of [15, 16, 17, 18]) await t.finger.up(id);
  await sleep(60);
  pad = await t.rect('.tc-dpad');
  await t.finger.down(19, padPoint(pad, 270).x, padPoint(pad, 270).y);
  await sleep(80);
  check('and the D-pad works straight away', (await t.cmd()).rotate === -1 && (await t.cmd()).steer === undefined);
  await t.finger.up(19);

  // focus loss
  await t.finger.down(20, padPoint(pad, 90).x, padPoint(pad, 90).y);
  await sleep(80);
  await t.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(200);
  check('losing focus releases the pad and pauses', (await t.sim()).paused === true && JSON.stringify(await t.cmd()) === NEUTRAL_CMD);
  await t.finger.up(20);
  await t.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);

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
  await t.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
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
  const first = await mobilePage(844, 390, { steering: null }); // a fresh profile: neither asteroids.touchMovement nor asteroids.touchSteering
  await first.start();
  check('a fresh profile gets Assisted Flight, and nothing is saved until they choose (no movement key, no legacy steering key)', (await movementOf(first)) === 'assisted' && (await savedMovement(first)) === null && (await first.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === null);
  const firstTitle = await first.texts('StartScene');
  check('the title screen control reference describes Assisted Flight (STICK, Point to travel) and not the D-pad', firstTitle.includes('STICK') && firstTitle.includes('Point to travel') && !firstTitle.includes('D-PAD'), firstTitle.join(' | ').slice(0, 200));
  await first.tapItem('controls');
  const firstLit = await first.page.evaluate(`(() => { const sc = window.__game.scene.getScene('StartScene'); const out = []; const walk = (list) => { for (const c of list) { if (c.type === 'Text' && ['CLASSIC D-PAD', 'POINT-TO-FLY', 'ASSISTED FLIGHT'].includes(c.text)) out.push([c.text, c.style.color]); if (c.list) walk(c.list); } }; walk(sc.children.list); return out; })()`);
  const litColor = (name) => firstLit.find(([text]) => text === name)?.[1];
  check('the Controls menu highlights ASSISTED FLIGHT (and only that one) on a fresh profile', firstLit.length === 3 && litColor('ASSISTED FLIGHT') !== litColor('CLASSIC D-PAD') && litColor('CLASSIC D-PAD') === litColor('POINT-TO-FLY'), JSON.stringify(firstLit));
  check('and the page explains Assisted Flight', (await first.texts('StartScene')).some((x) => /steers its flight toward it/.test(x)));
  await first.tapItem('back');
  await first.start();
  await first.play();
  check('a first-time visitor starts their first run with Assisted Flight (the joystick zone is shown, no pad)', (await first.rect('.tc-zone')).display === 'block' && (await first.rect('.tc-dpad')).display === 'none' && (await first.rect('.tc-hint')).display !== 'none');
  // Switching modes from the pause menu works from the new default too, and the run is untouched.
  const firstRun = await first.sim();
  const firstPause = await first.centre('.tc-pause');
  await first.finger.down(1, firstPause.x, firstPause.y);
  await first.finger.up(1);
  await sleep(250);
  await first.tapItem('controls', { scene: 'GameScene' });
  await first.tapItem('movement', { zone: 'CLASSIC D-PAD', scene: 'GameScene' });
  check('from the pause menu a fresh-profile player can switch Assisted Flight -> Classic D-Pad: applied and saved, run still paused and unchanged', (await movementOf(first)) === 'classic' && (await savedMovement(first)) === 'classic' && (await first.sim()).paused === true && (await first.sim()).x === firstRun.x && (await first.sim()).lives === firstRun.lives);
  await first.tapItem('back', { scene: 'GameScene' });
  await first.tapItem('resume', { scene: 'GameScene' });
  await sleep(150);
  check('after RESUME the D-pad is on screen and the joystick zone is gone', (await first.rect('.tc-dpad')).display !== 'none' && (await first.rect('.tc-zone')).display === 'none');
  await first.context.close();

  // Legacy migration: the old relative JOYSTICK preference (asteroids.touchSteering) is not reinterpreted as either new stick mode.
  const legacy = await mobilePage(844, 390, { steering: null });
  await legacy.context.addInitScript(() => {
    try {
      if (localStorage.getItem('asteroids.touchSteering') === null) localStorage.setItem('asteroids.touchSteering', 'joystick');
    } catch {
      // storage blocked
    }
  });
  await legacy.start();
  check('a returning player who saved the old relative JOYSTICK starts as Classic D-Pad, not as Point-to-Fly or Assisted Flight', (await movementOf(legacy)) === 'classic');
  check('and the old preference is left untouched, with nothing new saved until they choose', (await legacy.page.evaluate(() => localStorage.getItem('asteroids.touchSteering'))) === 'joystick' && (await savedMovement(legacy)) === null);
  await legacy.play();
  check('their first run shows the D-pad and no joystick', (await legacy.rect('.tc-dpad')).display !== 'none' && (await legacy.rect('.tc-zone')).display === 'none');
  await legacy.context.close();

  const fresh = await mobilePage(844, 390, { steering: 'assisted' }); // someone who already chose Assisted Flight
  await fresh.start();
  check('a saved ASSISTED FLIGHT choice is applied on a brand-new visit', (await movementOf(fresh)) === 'assisted');
  await fresh.play();
  check('and their first run shows the joystick zone and no pad', (await fresh.rect('.tc-zone')).display === 'block' && (await fresh.rect('.tc-dpad')).display === 'none');
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('the choice survives a reload (the seed never overwrites a saved choice)', (await movementOf(fresh)) === 'assisted');
  await fresh.page.evaluate(() => localStorage.setItem('asteroids.touchMovement', 'pointToFly'));
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('a saved POINT-TO-FLY choice is applied on a brand-new visit', (await movementOf(fresh)) === 'pointToFly');
  await fresh.page.evaluate(() => localStorage.setItem('asteroids.touchMovement', 'classic'));
  await fresh.page.reload();
  await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  check('a saved CLASSIC D-PAD choice stays Classic on a brand-new visit (it is not replaced by the Assisted Flight default)', (await movementOf(fresh)) === 'classic');
  await fresh.page.evaluate(() => localStorage.setItem('asteroids.touchMovement', 'pointToFly'));
  for (const junk of ['nonsense', 'joystick', 'dpad', '']) {
    await fresh.page.evaluate((v) => localStorage.setItem('asteroids.touchMovement', v), junk);
    await fresh.page.reload();
    await fresh.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
    await sleep(250);
    check(`an unsupported saved value (${JSON.stringify(junk)}) falls back to Assisted Flight`, (await movementOf(fresh)) === 'assisted');
  }
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
  check('with storage blocked a first-time visitor still gets Assisted Flight', (await movementOf(priv)) === 'assisted');
  await priv.tapItem('controls');
  await priv.tapItem('movement', { zone: 'CLASSIC D-PAD' });
  await sleep(200);
  check('with storage blocked Classic D-Pad can still be chosen for the visit and nothing crashes', (await movementOf(priv)) === 'classic' && priv.problems.filter((x) => !/SecurityError/.test(x)).length === 0, priv.problems.join(' | '));
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
    await p.page.evaluate(() => localStorage.setItem('asteroids.touchMovement', 'classic'));
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
    const pauseItems = (await p.menu('GameScene')).items;
    const rects = await Promise.all(pauseItems.map((i) => p.itemRect(i.id, { scene: 'GameScene' })));
    const upBox = { left: up.x - 1, right: up.x + 1, top: up.y - 1, bottom: up.y + 1 };
    await p.finger.tap(up.x, up.y, 30);
    await p.finger.tap(up.x, up.y, 30);
    await sleep(250);
    const texts = await p.texts();
    check(`[${w}x${h}] after an automatic pause, a press where the pad's UP arm was lands on no pause button and does not touch the run`, !rects.some((r) => overlaps(upBox, r)) && (await p.activeScene()) === 'GameScene' && (await p.sim()).paused === true && !texts.some((t) => /QUIT THIS RUN/.test(t)) && (await p.menu('GameScene')).page === 'pause', texts.filter((t) => /MENU|QUIT/.test(t)).join(' | '));
    // a bouncing double press on RETURN TO MENU itself still only asks
    const quit = await p.itemRect('menu', { scene: 'GameScene' });
    const qx = (quit.left + quit.right) / 2;
    const qy = (quit.top + quit.bottom) / 2;
    await p.finger.tap(qx, qy, 30);
    await p.finger.tap(qx, qy, 30);
    await sleep(250);
    check(`[${w}x${h}] a quick double press on RETURN TO MENU only asks "QUIT THIS RUN?" and does not leave the run`, (await p.activeScene()) === 'GameScene' && (await p.sim()).paused === true && (await p.texts()).some((t) => /^QUIT THIS RUN\?/.test(t)));
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
  await f.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
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
  await ios.tapItem('play');
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
  const dstate = await dp.evaluate(() => ({ system: getComputedStyle(document.querySelector('.tc-system')).display, root: getComputedStyle(document.querySelector('.tc-root')).display, dpadBoxes: document.querySelector('.tc-dpad').getClientRects().length, steering: window.__game.registry.get('touchMovement').mode }));
  check('desktop: no Fullscreen control, no D-pad, nothing drawn (the keyboard game is unchanged)', dstate.system === 'none' && dstate.root === 'none' && dstate.dpadBoxes === 0, JSON.stringify(dstate)); // the pad is the default steering, but it is inside the hidden touch root: nothing is rendered
  await dp.keyboard.press('Space');
  await dp.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  await dp.keyboard.press('KeyP');
  await sleep(200);
  check('desktop: pausing shows no system controls either', (await dp.evaluate(() => getComputedStyle(document.querySelector('.tc-system')).display)) === 'none');
  await desk.close();
}

// ---------------------------------------------------------------------------------------------------------
// Haptics: HAPTICS ON/OFF + TEST VIBRATION in the touch menus, and what the game asks navigator.vibrate() for. The Vibration API is
// replaced by a recording spy: this proves WHAT the game requests and WHEN. It cannot prove that a real phone's motor moves, or how
// the effects feel (see docs/mobile-touch.md, "Haptics" and "Manual testing").
// ---------------------------------------------------------------------------------------------------------

const VIB_MOCK = `(() => {
  const state = { calls: [], accept: true, events: [] };
  window.__vib = state;
  // writable: Phaser's device detection assigns navigator.vibrate itself and would throw on a read-only property
  Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value(pattern) {
    state.calls.push(Array.isArray(pattern) ? pattern.slice() : pattern);
    state.events.push(window.event ? window.event.type : null);
    return state.accept;
  } });
})()`;
const NO_VIB_MOCK = `Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: undefined })`;
const SEED_HAPTICS = (value) => `try { if (localStorage.getItem('asteroids.haptics') === null) localStorage.setItem('asteroids.haptics', '${value}'); } catch (e) {}`;
const ROCK_ON_SHIP = `(() => { const s = window.__game.scene.getScene('GameScene').sim; s.spawner.spawnTimer = -1e9; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
  s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`;

const vibCalls = (p) => p.page.evaluate(() => window.__vib.calls.slice());
const hapticsOn = (p) => p.page.evaluate(`window.__game.registry.get('haptics').enabled`);
const savedHaptics = (p) => p.page.evaluate(() => localStorage.getItem('asteroids.haptics'));

async function runHaptics() {
  console.log('\n--- Haptics ---');
  // =====================================================================================================
  // H1. Title screen: the controls, the default, persistence, TEST VIBRATION
  // =====================================================================================================
  const t = await mobilePage(844, 390, { steering: null });
  await t.context.addInitScript(VIB_MOCK);
  await t.start();
  const titleTexts = await t.texts('StartScene');
  check('the title screen has no haptic or vibration controls of its own (they live in CONTROLS)', !titleTexts.some((x) => /HAPTIC|VIBRATION/.test(x)), titleTexts.join(' | ').slice(0, 200));
  check('a new player has HAPTICS ON by default, and nothing is saved until they choose', (await hapticsOn(t)) === true && (await savedHaptics(t)) === null);
  check('merely showing the title screen did not vibrate', (await vibCalls(t)).length === 0);
  await t.tapItem('controls');
  const controlTexts = await t.texts('StartScene');
  check('the CONTROLS page offers HAPTIC FEEDBACK ON | OFF, TEST VIBRATION and a one-line hint about silent phones', controlTexts.includes('HAPTIC FEEDBACK') && controlTexts.includes('TEST VIBRATION') && controlTexts.includes('ON') && controlTexts.includes('OFF') && controlTexts.some((x) => /silent phone/.test(x)), controlTexts.join(' | ').slice(0, 220));
  check('opening the CONTROLS page did not vibrate either', (await vibCalls(t)).length === 0);
  const boxes = [await t.itemRect('haptics', { zone: 'ON' }), await t.itemRect('haptics', { zone: 'OFF' }), await t.itemRect('test-vibration')];
  check('the haptic switches are thumb-sized (at least 44 CSS px tall and 80 wide), do not overlap and stay on screen', boxes.every((b) => b.height >= 44 && b.width >= 80 && b.right <= 844 && b.bottom <= 390) && !overlaps(boxes[0], boxes[1]) && !overlaps(boxes[1], boxes[2]), boxes.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' '));
  await t.shot('haptics-controls-on');

  const audio0 = await t.audio();
  await t.tapItem('haptics', { zone: 'OFF' });
  check('tapping OFF turns it OFF, saves "0" and does not buzz by itself', (await hapticsOn(t)) === false && (await savedHaptics(t)) === '0' && (await vibCalls(t)).length === 0);
  const audio1 = await t.audio();
  check('the setting does not touch the music mute or either volume', audio1.muted === audio0.muted && audio1.vm === audio0.vm && audio1.vs === audio0.vs, JSON.stringify([audio0, audio1].map((a) => [a.muted, a.vm, a.vs])));
  await t.shot('haptics-controls-off');
  await t.tapItem('haptics', { zone: 'ON' });
  check('tapping ON turns it ON again, saves "1" and does not buzz by itself', (await hapticsOn(t)) === true && (await savedHaptics(t)) === '1' && (await vibCalls(t)).length === 0);

  await t.tapItem('test-vibration');
  const afterTest = await t.page.evaluate(() => ({ calls: window.__vib.calls.slice(), events: window.__vib.events.slice() }));
  check('TEST VIBRATION sends one short double pulse, from inside the tap itself (a direct user gesture)', JSON.stringify(afterTest.calls) === JSON.stringify([[80, 60, 80]]) && afterTest.events[0] !== null, JSON.stringify(afterTest));
  info(`TEST VIBRATION ran inside a "${afterTest.events[0]}" event`);
  check('the button then says SENT - FELT IT? (it reports the request, it does not claim the phone moved)', (await t.texts('StartScene')).includes('SENT - FELT IT?'));
  await t.shot('haptics-controls-test-sent');
  await sleep(2500);
  check('and goes back to TEST VIBRATION by itself', (await t.texts('StartScene')).includes('TEST VIBRATION'));

  await t.tapItem('haptics', { zone: 'OFF' });
  await t.tapItem('test-vibration');
  check('TEST VIBRATION works with HAPTICS OFF too (it exists to tell "this phone cannot" from "the game did not ask")', (await hapticsOn(t)) === false && (await vibCalls(t)).filter((c) => Array.isArray(c)).length === 2, JSON.stringify(await vibCalls(t)));
  await t.page.evaluate(() => {
    window.__vib.accept = false;
  });
  await sleep(2500);
  await t.tapItem('test-vibration');
  check('a browser that refuses the request is reported as BLOCKED - TAP AGAIN, without errors', (await t.texts('StartScene')).includes('BLOCKED - TAP AGAIN') && t.problems.length === 0, t.problems.join(' | '));
  await t.page.evaluate(() => {
    window.__vib.accept = true;
  });
  await t.tapItem('haptics', { zone: 'ON' });
  check('HAPTICS is ON again', (await hapticsOn(t)) === true && (await savedHaptics(t)) === '1');
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  check('after a reload HAPTICS is still ON (the preference persists)', (await hapticsOn(t)) === true && (await savedHaptics(t)) === '1');
  await t.page.evaluate(() => localStorage.setItem('asteroids.haptics', '0'));
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  check('a saved OFF is kept: the new ON default never overrides an explicit choice, and nothing is rewritten', (await hapticsOn(t)) === false && (await savedHaptics(t)) === '0');
  await t.tapItem('controls');
  check('...and the CONTROLS page shows it OFF (an OFF lit, nothing buzzed)', (await hapticsOn(t)) === false && (await vibCalls(t)).length === 0);
  await t.shot('haptics-controls-saved-off');
  await t.page.evaluate(() => localStorage.setItem('asteroids.haptics', 'maybe'));
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);
  check('an invalid stored value falls back to the default (ON)', (await hapticsOn(t)) === true);
  await t.page.evaluate(() => localStorage.setItem('asteroids.haptics', '1'));
  await t.page.reload();
  await t.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(300);

  // =====================================================================================================
  // H2. Gameplay: only successful events vibrate
  // =====================================================================================================
  await t.play();
  await t.quiet();
  await sleep(200);
  check('starting the run, after the menu taps before it, caused no gameplay vibration', (await vibCalls(t)).length === 0);
  const boost = await t.centre('.tc-boost');
  const laser = await t.centre('.tc-laser');
  const pauseBtn = await t.centre('.tc-pause');
  await t.finger.tap(boost.x, boost.y);
  await sleep(250);
  check('a successful BOOST vibrates once for 30 ms', JSON.stringify(await vibCalls(t)) === JSON.stringify([30]), JSON.stringify(await vibCalls(t)));
  await t.finger.tap(boost.x, boost.y);
  await sleep(250);
  await t.finger.tap(boost.x, boost.y);
  await sleep(250);
  check('pressing BOOST again while it is running or cooling down does not vibrate', (await vibCalls(t)).length === 1 && (await t.sim()).boostCd > 0, JSON.stringify(await vibCalls(t)));
  await t.finger.tap(laser.x, laser.y);
  await sleep(250);
  check('a LASER shot vibrates once for 55 ms', JSON.stringify(await vibCalls(t)) === JSON.stringify([30, 55]), JSON.stringify(await vibCalls(t)));
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.laser.shotsRemaining = 0`);
  await t.finger.tap(laser.x, laser.y);
  await sleep(250);
  await t.finger.tap(laser.x, laser.y);
  await sleep(250);
  check('pressing LASER with no charges does not vibrate', (await vibCalls(t)).length === 2, JSON.stringify(await vibCalls(t)));

  // opening / closing the pause menu is not gameplay; the same switches are there
  await t.finger.tap(pauseBtn.x, pauseBtn.y);
  await sleep(300);
  await t.tapItem('controls', { scene: 'GameScene' });
  check('the pause menu\'s CONTROLS page offers the same haptic controls, with ON lit', (await t.texts()).includes('HAPTIC FEEDBACK') && (await t.texts()).includes('TEST VIBRATION') && (await hapticsOn(t)) === true);
  await t.shot('haptics-pause-on');
  await t.tapItem('haptics', { zone: 'OFF', scene: 'GameScene' });
  check('HAPTICS can be switched OFF from the pause menu (saved at once)', (await hapticsOn(t)) === false && (await savedHaptics(t)) === '0');
  await t.tapItem('test-vibration', { scene: 'GameScene' });
  check('TEST VIBRATION from the pause menu sends the test pattern', JSON.stringify((await vibCalls(t)).slice(2)) === JSON.stringify([[80, 60, 80]]), JSON.stringify(await vibCalls(t)));
  await t.tapItem('haptics', { zone: 'ON', scene: 'GameScene' });
  check('...and HAPTICS goes back ON', (await hapticsOn(t)) === true);
  await t.tapItem('back', { scene: 'GameScene' });
  await t.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
  const beforePause = (await vibCalls(t)).length;
  await t.finger.tap(pauseBtn.x, pauseBtn.y);
  await sleep(300);
  await t.tapItem('resume', { scene: 'GameScene' });
  await sleep(150);
  check('pausing and resuming caused no vibration', (await vibCalls(t)).length === beforePause);

  // damage, then death: one vibration each
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 3`);
  const mark = (await vibCalls(t)).length;
  await t.page.evaluate(ROCK_ON_SHIP);
  await sleep(300);
  check('losing a life vibrates once for 65 ms', (await t.sim()).lives === 2 && JSON.stringify((await vibCalls(t)).slice(mark)) === JSON.stringify([65]), JSON.stringify((await vibCalls(t)).slice(mark)));
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 1`);
  await sleep(2300); // respawn protection ends
  const mark2 = (await vibCalls(t)).length;
  await t.page.evaluate(ROCK_ON_SHIP);
  await waitGameOver(t, 'haptics-death');
  await sleep(400);
  check('the fatal hit gives ONE vibration, the 110 ms death one (not a damage buzz followed by a death buzz)', JSON.stringify((await vibCalls(t)).slice(mark2)) === JSON.stringify([110]), JSON.stringify((await vibCalls(t)).slice(mark2)));
  await sleep(1200);
  check('nothing keeps buzzing on the game-over screen', (await vibCalls(t)).length === mark2 + 1);

  // restart: a fresh run replays nothing
  await t.page.evaluate(`window.__game.scene.getScene('GameScene').sim.retryDelay = 0`);
  const mark3 = (await vibCalls(t)).length;
  await t.tapGame(430, 470); // RETRY
  await sleep(800);
  check('RETRY starts a clean run that does not replay the previous run\'s vibrations', (await t.sim()).phase === 'playing' && (await vibCalls(t)).length === mark3, JSON.stringify(await vibCalls(t)));

  // cancellation: all inside one evaluate, so the 220 ms test pattern is certainly still running at each check
  const cancelled = await t.page.evaluate(async () => {
    const g = window.__game;
    const h = g.registry.get('haptics');
    const sc = g.scene.getScene('GameScene');
    const lastIsCancel = () => window.__vib.calls[window.__vib.calls.length - 1] === 0;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = {};
    h.testVibration();
    h.setEnabled(false);
    out.disabled = lastIsCancel();
    h.setEnabled(true);
    h.testVibration();
    sc.togglePause();
    await frame();
    out.paused = lastIsCancel();
    sc.togglePause();
    await frame();
    h.testVibration();
    window.dispatchEvent(new Event('blur'));
    out.blur = lastIsCancel();
    out.blurredRequest = h.request('boost');
    window.dispatchEvent(new Event('focus'));
    h.testVibration();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    out.hidden = lastIsCancel();
    out.hiddenRequest = h.request('boost');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    h.testVibration();
    g.scene.start('StartScene');
    await frame();
    out.sceneLeft = lastIsCancel();
    return out;
  });
  check('turning HAPTICS off, pausing, losing focus, hiding the tab and leaving the scene each cancel a running vibration (vibrate(0))', cancelled.disabled && cancelled.paused && cancelled.blur && cancelled.hidden && cancelled.sceneLeft, JSON.stringify(cancelled));
  check('and a blurred or hidden page refuses to start one', cancelled.blurredRequest === 'background' && cancelled.hiddenRequest === 'background', JSON.stringify(cancelled));
  await sleep(300);
  check('(haptics, touch) no console errors', t.problems.length === 0, t.problems.join(' | '));
  await t.context.close();

  // =====================================================================================================
  // H3. Fullscreen and orientation never buzz
  // =====================================================================================================
  const f = await mobilePage(844, 390, { steering: null });
  await f.context.addInitScript(VIB_MOCK);
  await f.context.addInitScript(SEED_HAPTICS('1'));
  await f.page.addInitScript(FS_MOCK);
  await f.start();
  await tapPill(f);
  await f.page.setViewportSize({ width: 844, height: 360 });
  await sleep(400);
  await f.play();
  await f.quiet();
  await f.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 99`);
  await f.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await f.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  await f.page.evaluate(`window.__fs.el = null; document.dispatchEvent(new Event('fullscreenchange'))`);
  await sleep(200);
  check('entering and leaving fullscreen and turning the phone upright and back caused no vibration, and the run is paused', (await vibCalls(f)).length === 0 && (await f.sim()).paused === true, JSON.stringify(await vibCalls(f)));
  check('(haptics, fullscreen/orientation) no console errors', f.problems.length === 0, f.problems.join(' | '));
  await f.context.close();

  // =====================================================================================================
  // H4. Unsupported browsers (iPhone Safari): the game is unaffected
  // =====================================================================================================
  const u = await mobilePage(844, 390, { steering: null });
  await u.context.addInitScript(NO_VIB_MOCK);
  await u.context.addInitScript(SEED_HAPTICS('1'));
  await u.start();
  await u.tapItem('controls');
  const uTexts = await u.texts('StartScene');
  const uItems = (await u.menu()).items.map((i) => i.id);
  check('without navigator.vibrate the CONTROLS page still shows the saved HAPTIC FEEDBACK choice, no TEST VIBRATION button, and says why', uTexts.includes('HAPTIC FEEDBACK') && !uItems.includes('test-vibration') && !uTexts.includes('TEST VIBRATION') && uTexts.includes('This browser cannot vibrate.') && (await u.page.evaluate(() => typeof navigator.vibrate)) === 'undefined', uTexts.join(' | ').slice(0, 200));
  await u.shot('haptics-controls-unsupported');
  await u.tapItem('haptics', { zone: 'OFF' });
  await u.tapItem('haptics', { zone: 'ON' });
  check('switching the setting without the API is silent: no errors', u.problems.length === 0, u.problems.join(' | '));
  await u.tapItem('back');
  await u.play();
  await u.quiet();
  const ub = await u.centre('.tc-boost');
  const ul = await u.centre('.tc-laser');
  await u.finger.tap(ub.x, ub.y);
  await sleep(200);
  await u.finger.tap(ul.x, ul.y);
  await sleep(200);
  await u.page.evaluate(ROCK_ON_SHIP);
  await sleep(300);
  await u.page.evaluate(`window.__game.scene.getScene('GameScene').sim.player.lives = 1`);
  await sleep(2300);
  await u.page.evaluate(ROCK_ON_SHIP);
  await waitGameOver(u, 'haptics-unsupported');
  check('boost, laser, damage and death all work with no vibration API, and nothing is logged as an error', (await u.sim()).phase === 'gameOver' && u.problems.length === 0, u.problems.join(' | '));
  await u.context.close();

  // =====================================================================================================
  // H5. Desktop / keyboard: the same events never reach a vibration motor
  // =====================================================================================================
  const d = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await d.addInitScript(VIB_MOCK);
  await d.addInitScript(SEED_HAPTICS('1'));
  const dp = await d.newPage();
  const dproblems = [];
  dp.on('console', (m) => m.type() === 'error' && dproblems.push(m.text()));
  dp.on('pageerror', (e) => dproblems.push(String(e)));
  await dp.goto(`${BASE}?debug`);
  await dp.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(250);
  await dp.keyboard.press('Space');
  await dp.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  for (const key of ['ShiftLeft', 'KeyE']) {
    await dp.keyboard.down(key); // held for a few frames: the game samples the keys once per frame
    await sleep(150);
    await dp.keyboard.up(key);
    await sleep(150);
  }
  await dp.evaluate(ROCK_ON_SHIP);
  await sleep(400);
  const dsim = await dp.evaluate(`(() => { const s = window.__game.scene.getScene('GameScene').sim; return { lives: s.player.lives, boosted: s.player.boost.cooldown > 0, lasers: s.player.laser.shotsRemaining }; })()`);
  check('desktop with HAPTICS saved ON: boost, laser and damage happen but the vibration API is never called', dsim.boosted && dsim.lasers < 15 && dsim.lives < 3 && (await dp.evaluate(() => window.__vib.calls.length)) === 0, JSON.stringify(dsim));
  check('(haptics, desktop) no console errors', dproblems.length === 0, dproblems.join(' | '));
  await d.close();
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
 * (and the default) seed 'joystick' so they keep testing it; pass `null` for a first-time visitor, who gets Assisted Flight. A seeded value is only
 * written when nothing is saved, so choices made during the test (and reloads) are never overwritten.
 */
async function mobilePage(width, height, { query = '?debug', mobile = true, touch = true, steering = 'joystick' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: touch });
  // 'classic' | 'pointToFly' | 'assisted': a movement choice the player already saved. 'joystick' (the default) is not a choice any more:
  // it puts the retired relative stick on screen through the compatibility seam in `start()`, for the sections that test the stick
  // zone's multi-touch and lifecycle rules. null: a first-time visitor.
  // 'joystick' is the retired relative stick: Classic's stick style plus the `setSteering` seam in `start()`. The default movement mode is Assisted Flight
  // now (a different stick style), so those sections seed Classic explicitly instead of depending on the default.
  const seeded = steering === 'joystick' ? 'classic' : steering;
  if (seeded) {
    await context.addInitScript((value) => {
      try {
        if (localStorage.getItem('asteroids.touchMovement') === null) localStorage.setItem('asteroids.touchMovement', value);
      } catch {
        // storage blocked: nothing to seed
      }
    }, seeded);
  }
  // A new visitor's soundtrack is MegaPop now; this suite's checks are about the Original track's level and key, so it starts on Original (the music suite covers the default).
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
    /** Where every menu button is, in game px: the title screen's menu (default) or the pause menu in a run. */
    menu: (sceneName = 'StartScene') => page.evaluate((k) => window.__game.scene.getScene(k)[k === 'StartScene' ? 'menuSnapshot' : 'pauseMenuSnapshot'](), sceneName),
    /** A real touch on a menu item (or one named part of it: '+', 'OFF', ...), found through the menu itself, then a pause long enough to clear its page-change lock. */
    tapItem: async (id, { zone = null, scene = 'StartScene', ms = 70 } = {}) => {
      const item = (await api.menu(scene)).items.find((i) => i.id === id);
      if (!item) throw new Error(`no menu item "${id}" on ${scene}`);
      const r = zone ? item.zones.find((z) => z.name === zone) : item;
      if (!r) throw new Error(`no zone "${zone}" on ${id}`);
      const p = await api.css(r.x + r.w / 2, r.y + r.h / 2);
      await finger.tap(p.x, p.y, ms);
      await sleep(270);
    },
    /** CSS rectangle of a menu item, or of one named part of it. */
    itemRect: async (id, { zone = null, scene = 'StartScene' } = {}) => {
      const item = (await api.menu(scene)).items.find((i) => i.id === id);
      if (!item) return null;
      const r = zone ? item.zones.find((z) => z.name === zone) : item;
      return gameRectCss(api, r.x, r.y, r.x + r.w, r.y + r.h);
    },
    /** Every visible Text of a scene's menu, one per line of what the player reads. */
    menuTexts: (sceneName = 'StartScene') => api.texts(sceneName),
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
      if (steering === 'joystick') await page.evaluate(() => window.__game.registry.get('touchControls').setSteering('joystick'));
      await sleep(250);
    },
    /** Taps PLAY and waits for the run. */
    play: async () => {
      await api.tapItem('play');
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
  const titleItems = (await m.menu()).items.map((i) => i.id);
  check('the title screen is the touch one (a big PLAY, no keyboard instructions, no players switch)', titleTexts.includes('PLAY') && !titleTexts.some((t) => /SPACE|click to start/.test(t)) && !titleItems.includes('players'), titleTexts.join(' | ').slice(0, 160));
  check('the title screen shows how to play (the controls with their in-game names), the power-up legend, and AUDIO and CONTROLS doors', ['HOW TO PLAY', 'D-PAD', 'FIRE', 'LASER', 'BOOST', 'POWER-UPS', 'RAPID FIRE', 'SLOW MOTION'].every((t) => titleTexts.includes(t)) && ['audio', 'controls', 'powerups'].every((i) => titleItems.includes(i)), titleTexts.join(' | ').slice(0, 200));
  check('no settings clutter on the first screen (no volume rows, haptics, steering or mute switches)', !titleTexts.some((t) => /VOLUME|SFX|HAPTIC|VIBRATION|STEERING|MOVEMENT|^MUSIC/.test(t)), titleTexts.join(' | ').slice(0, 200));
  check('no touch controls are drawn on the title screen', !(await m.overlayShown()));
  const a0 = await m.audio();
  check('audio starts locked, music not yet playing', a0.locked === true && !a0.playing, JSON.stringify(a0));
  await m.shot('01-title-landscape');

  // Landscape recommended, portrait prompt is a DOM overlay: not visible here.
  check('the rotate prompt is not shown in landscape', (await m.rect('.tc-rotate')).display === 'none');

  await m.play();
  check('tapping PLAY (a real touch) starts a one-player run', (await m.activeScene()) === 'GameScene' && (await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.players.length`)) === 1);
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
  const pauseItems = (await m.menu('GameScene')).items;
  check('the pause screen is touch-operable (RESUME, AUDIO, CONTROLS, RETURN TO MENU), every button at least 44 CSS px tall', ['RESUME', 'AUDIO', 'CONTROLS', 'RETURN TO MENU'].every((t) => pauseTexts.includes(t)) && pauseItems.length === 4 && (await Promise.all(pauseItems.map((i) => m.itemRect(i.id, { scene: 'GameScene' })))).every((r) => r.height >= 44 && r.width >= 100), pauseTexts.join(' | ').slice(0, 200));
  check('no keyboard-only instructions on the touch pause screen', !pauseTexts.some((t) => /Press P|Press ESC|Press M/.test(t)));
  await m.finger.up(8);
  await m.finger.up(9);
  await sleep(600); // long enough for a synthesised mouse / click to arrive if the browser sent one
  st = await m.sim();
  check('no ghost tap: the game is still paused 600 ms after the PAUSE tap and the lifting of the other fingers', st.paused === true && (await m.activeScene()) === 'GameScene');
  await m.shot('04-pause');

  // volume by touch, in the pause menu's AUDIO page: opens on top of the pause menu, BACK returns to it
  const v0 = await m.audio();
  await m.tapItem('audio', { scene: 'GameScene' });
  check('AUDIO opens from the pause menu and the run stays paused', (await m.menu('GameScene')).page === 'audio' && (await m.sim()).paused === true && !(await m.overlayShown()));
  await m.shot('04b-pause-audio');
  await m.tapItem('music-volume', { zone: '+', scene: 'GameScene' });
  await m.tapItem('sfx-volume', { zone: '-', scene: 'GameScene' });
  const v1 = await m.audio();
  check('Music and SFX volume can be changed by touch (and are saved)', Math.abs(v1.vm - (v0.vm + 0.1)) < 1e-9 && Math.abs(v1.vs - (v0.vs - 0.1)) < 1e-9 && (await m.page.evaluate(() => localStorage.length)) > 0, JSON.stringify({ v0: [v0.vm, v0.vs], v1: [v1.vm, v1.vs] }));
  await m.tapItem('music', { zone: 'OFF', scene: 'GameScene' });
  const mutedNow = (await m.audio()).muted === true;
  await m.tapItem('music', { zone: 'ON', scene: 'GameScene' });
  check('the music can be muted by touch, and unmuted again', mutedNow && (await m.audio()).muted === false);
  await m.tapItem('back', { scene: 'GameScene' });
  check('BACK returns to the pause menu, still paused (not resumed, not restarted)', (await m.menu('GameScene')).page === 'pause' && (await m.sim()).paused === true);

  const instanceBefore = await m.page.evaluate(`window.__game.scene.getScene('GameScene').sim.time`);
  await m.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
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
  await m.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
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
  await m.tapItem('resume', { scene: 'GameScene' });
  await sleep(100);
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
  check('MAIN MENU by touch returns to the touch title screen with no controls drawn', (await m.texts('StartScene')).includes('PLAY') && (await m.texts('StartScene')).includes('HOW TO PLAY') && !(await m.overlayShown()));
  const listeners = await m.page.evaluate(`({ touch: window.__game.registry.get('touchControls').listenerCount, blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  await m.play();
  const listeners2 = await m.page.evaluate(`({ touch: window.__game.registry.get('touchControls').listenerCount, blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  check('no listener build-up across game, menu and game again', listeners2.touch === listeners.touch + 2 && listeners2.blur === listeners.blur + 1, JSON.stringify({ listeners, listeners2 }));

  // =====================================================================================================
  // 6. Input-mode selection
  // =====================================================================================================
  // back to the title: pause -> RETURN TO MENU by touch. It throws the run away, so it takes two taps.
  const p2 = await m.centre(sel.pause);
  await m.finger.tap(p2.x, p2.y);
  await sleep(300);
  await m.tapItem('menu', { scene: 'GameScene' });
  check('ONE tap on the pause screen\'s RETURN TO MENU does not leave the run: it asks "QUIT THIS RUN?"', (await m.activeScene()) === 'GameScene' && (await m.sim()).paused === true && (await m.texts()).some((t) => /^QUIT THIS RUN\?/.test(t)));
  await m.tapItem('resume', { scene: 'GameScene' }); // RESUME instead
  await sleep(200);
  await m.finger.tap(p2.x, p2.y);
  await sleep(300);
  check('the question does not carry over to the next pause (RETURN TO MENU is back to one plain label)', (await m.texts()).includes('RETURN TO MENU') && !(await m.texts()).some((t) => /QUIT THIS RUN/.test(t)));
  await m.tapItem('menu', { scene: 'GameScene' });
  await sleep(300);
  await m.tapItem('menu', { scene: 'GameScene' }); // the deliberate second tap
  await m.page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  await sleep(300);
  check('a second tap on RETURN TO MENU goes to the title screen', (await m.texts('StartScene')).includes('PLAY') && (await m.texts('StartScene')).includes('HOW TO PLAY'));
  // The keyboard switch takes two taps: one stray thumb must not hide every touch control.
  // Nor may one accidental contact made of two touches: two fingers (or a palm) landing together, or a bouncing thumb.
  // The switch lives on the CONTROLS page now, below the steering and haptic choices.
  await m.tapItem('controls');
  const controlIds = (await m.menu()).items.map((i) => i.id);
  check('CONTROLS opens a page for this phone: movement mode, haptic feedback, test vibration, and the way to the keyboard', (await m.menu()).page === 'controls' && ['movement', 'haptics', 'test-vibration', 'to-keyboard', 'back'].every((id) => controlIds.includes(id)), JSON.stringify(controlIds));
  const sw = await m.itemRect('to-keyboard');
  check('the switch to keyboard controls is a full-size button (at least 44 CSS px tall)', sw.height >= 44 && sw.width >= 120, JSON.stringify({ w: Math.round(sw.width), h: Math.round(sw.height) }));
  const ctl = { x: (sw.left + sw.right) / 2, y: (sw.top + sw.bottom) / 2 };
  await m.finger.downMany([[31, ctl.x - 40, ctl.y], [32, ctl.x + 40, ctl.y]]);
  await sleep(70);
  await m.finger.up(31);
  await m.finger.up(32);
  await sleep(400);
  check('two fingers landing together on the switch do not switch (they count as one tap: it only asks)', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /TAP AGAIN TO SWITCH/.test(t)) && (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  await m.shot('07a-controls-tap-again');
  await sleep(3400);
  await m.finger.tap(ctl.x, ctl.y, 30);
  await m.finger.tap(ctl.x, ctl.y, 30); // lands well inside the 300 ms that count as the same contact
  await sleep(400);
  check('a bouncing double contact (two quick taps) does not switch either', (await m.bodyClasses()).includes('tc-active') && (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  await sleep(3400);
  check('the question lapses by itself if nobody taps again', (await m.bodyClasses()).includes('tc-active') && !(await m.texts('StartScene')).some((t) => /TAP AGAIN/.test(t)) && (await m.texts('StartScene')).includes('SWITCH TO KEYBOARD'));
  await m.tapItem('to-keyboard');
  await sleep(1200);
  check('a tap long after the first one only asks again (still touch mode)', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).some((t) => /TAP AGAIN TO SWITCH/.test(t)));
  await m.finger.tap(ctl.x, ctl.y, 70); // the confirming tap, inside the window
  await m.page.waitForFunction(() => window.__game.scene.getScene('StartScene').menuSnapshot().items.some((i) => i.id === 'touch-on'), null, { timeout: 5000 });
  await sleep(300);
  check('the switch turns touch off right where the player is: the CONTROLS page for keyboard and controller appears, with a big way back to touch on top', !(await m.bodyClasses()).includes('tc-active') && (await m.menu()).page === 'controls' && (await m.texts('StartScene')).some((t) => /TOUCH CONTROLS ARE OFF/.test(t)));
  check('the choice is remembered for next time', (await m.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === 'desktop');
  const recover = await m.itemRect('touch-on');
  check('the way back is a big green button across the top of the page: at least 44 CSS px tall and 300 wide, in words', recover.height >= 44 && recover.width >= 300, JSON.stringify({ w: Math.round(recover.width), h: Math.round(recover.height) }));
  await m.shot('07b-controls-keyboard-mode');
  await m.tapItem('back');
  check('a touch-capable device in keyboard mode is offered the way back on the first screen too', (await m.texts('StartScene')).some((t) => /^TOUCH CONTROLS: OFF\nTAP TO TURN ON$/.test(t)));
  await m.shot('07-title-keyboard-mode');
  const turnOn = await m.itemRect('touch-on');
  const turnOnTexts = await m.texts('StartScene');
  check('the way back is a big button, not small text: at least 44 CSS px tall and 120 wide, top right, labelled in words', turnOn.height >= 44 && turnOn.width >= 120 && turnOn.top < 40 && turnOn.right > 422 && turnOnTexts.some((t) => /^TOUCH CONTROLS: OFF\nTAP TO TURN ON$/.test(t)), JSON.stringify({ w: Math.round(turnOn.width), h: Math.round(turnOn.height), texts: turnOnTexts.filter((t) => /TOUCH/.test(t)) }));
  const playLabel = (await m.menu()).items.find((i) => i.id === 'play');
  check('a phone in keyboard mode offers PLAY WITH KEYBOARD, which says it needs SPACE (the green button above is the main thing)', playLabel.label === 'PLAY WITH KEYBOARD' && turnOnTexts.includes('PRESS SPACE ON A KEYBOARD'), turnOnTexts.filter((t) => /PLAY|SPACE/.test(t)).join('|'));
  await m.tapGame(300, 300); // empty space, over the controls reference
  await m.tapGame(640, 52); // the title itself
  await m.tapItem('play'); // a tap on PLAY WITH KEYBOARD: a phone has no keyboard, so a tap alone does not start it either
  await sleep(400);
  check('a stray tap anywhere on the keyboard title screen of a phone, even on PLAY itself, does NOT start a game', (await m.activeScene()) === 'StartScene');
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
  await m.tapItem('touch-on'); // the big button, on a real touch
  await sleep(300);
  check('tapping TOUCH CONTROLS brings the touch screen back', (await m.bodyClasses()).includes('tc-active') && (await m.texts('StartScene')).includes('PLAY') && (await m.texts('StartScene')).includes('HOW TO PLAY'));
  await m.context.close();

  // ?touch=0 on a phone: the URL decides for the visit
  const forced = await mobilePage(844, 390, { query: '?debug&touch=0' });
  await forced.start();
  check('?touch=0 forces the keyboard game on a phone', !(await forced.bodyClasses()).includes('tc-active') && (await forced.texts('StartScene')).includes('PLAY WITH KEYBOARD'));
  check('...and saves nothing (the URL only decides for this visit)', (await forced.page.evaluate(() => localStorage.getItem('asteroids.inputMode'))) === null);
  // The way back must also survive a clumsy touch: two fingers landing on it together switch once, not twice (back to keyboard).
  const turnOn3 = await forced.itemRect('touch-on');
  const tcy = (turnOn3.top + turnOn3.bottom) / 2;
  await forced.finger.downMany([[41, turnOn3.left + 40, tcy], [42, turnOn3.right - 40, tcy]]);
  await sleep(70);
  await forced.finger.up(41);
  await forced.finger.up(42);
  await sleep(500);
  check('two fingers landing together on TOUCH CONTROLS still bring the touch screen back', (await forced.bodyClasses()).includes('tc-active') && (await forced.texts('StartScene')).includes('PLAY') && (await forced.texts('StartScene')).includes('HOW TO PLAY'));
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
  const playBox = (await portrait.menu()).items.find((i) => i.id === 'play');
  await portrait.tapGame(playBox.x + playBox.w / 2, playBox.y + playBox.h / 2); // a tap where PLAY is must not start a game
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
  check('desktop (fine pointer, no touch): the title screen is the keyboard one (PLAY with SPACE, 1 / 2 players), with no touch switch', dtexts.includes('PLAY') && dtexts.includes('SPACE') && dtexts.includes('1 PLAYER') && dtexts.includes('2 PLAYERS') && !dtexts.some((t) => /TOUCH/.test(t)), dtexts.slice(0, 6).join(' | '));
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
  check('desktop: the pause menu has the same four buttons, plus the keyboard hint line', dpaused.includes('PAUSED') && ['RESUME', 'AUDIO', 'CONTROLS', 'RETURN TO MENU'].every((t) => dpaused.includes(t)) && dpaused.some((t) => /^P \/ ESC: resume/.test(t)));
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
    check('touch laptop (mouse primary + touch screen): keyboard title screen plus a TOUCH CONTROLS switch', ltexts.includes('PLAY') && ltexts.includes('SPACE') && ltexts.some((t) => t.startsWith('TOUCH CONTROLS: OFF')));
  } else {
    info('this Chromium reports a coarse pointer for hasTouch, so the touch-laptop case cannot be emulated here (covered by unit tests of the policy)');
  }
  await laptopCtx.close();

  await runDpad();
  await runMovement();
  await runFullscreen();
  await runHaptics();

  // =====================================================================================================
  // 9. Overall health
  // =====================================================================================================
  check('no console errors, page errors or failed requests on the phone pages', m.problems.length === 0, m.problems.join(' | '));
  check('the audio files were requested and loaded (no 4xx)', m.requests.some((r) => /\.ogg$/.test(r.url) && r.status === 200), m.requests.filter((r) => /\.ogg/.test(r.url)).length + ' ogg requests');
  const cssUrls = [...new Set(m.requests.filter((r) => /\.css$/.test(r.url)).map((r) => r.url))];
  check('the touch stylesheet is part of the build and loads (one file, from the same origin and base path)', cssUrls.length === 1 && m.requests.filter((r) => /\.css$/.test(r.url)).every((r) => r.status === 200), cssUrls.join(' '));
}
