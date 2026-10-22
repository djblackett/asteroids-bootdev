// Developer workflow demonstration: captures a game played in Chromium in verified-run mode,
// exports the recorded normalized inputs, and independently verifies the exact score and game-over
// result in Node without Phaser or a browser.
//
// Usage:
//   node scripts/replay-browser.mjs
//   npm run test:replay:browser

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { verifyReplay } from '../dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.REPLAY_BROWSER_PORT ?? 4410);
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
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((resolve) => {
      http.get(BASE, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }).on('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error('Preview server did not start');
}

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  throw new Error('dist/ is missing; run build first.');
}
if (!fs.existsSync(path.join(root, 'dist', 'node', 'index.js'))) {
  throw new Error('dist/node/index.js is missing; build verifier bundle first.');
}

const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'inherit' },
);
const stopServer = () => server.kill();
process.on('exit', stopServer);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  console.log('\n--- Part 1: Keyboard Gameplay in Chromium -> Node Verification ---');
  await runKeyboardTest(browser);

  console.log('\n--- Part 2: Touch Assisted Flight in Chromium -> Node Verification ---');
  await runTouchTest(browser);
} finally {
  await browser?.close();
  stopServer();
}

console.log(`\n${total - failures}/${total} browser-to-node replay verification checks passed\n`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function runKeyboardTest(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const seed = 123456;

  // 1. Launch game in experimental verified mode with known seed
  await page.goto(`${BASE}?verified=1&seed=${seed}&debug=1`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });

  // Start run from StartScene
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), null, { timeout: 5000 });

  // Confirm verified replay hook is active once GameScene starts
  await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isVerified === true, null, { timeout: 5000 });
  check('GameScene launched in verified mode', true);

  // 2. Play genuine gameplay via browser input
  // Hold W (thrust), tap D (rotate), shoot, boost, laser
  await page.keyboard.down('KeyW');
  await sleep(350);
  await page.keyboard.down('KeyD');
  await sleep(150);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  // Shoot bursts
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Space');
    await sleep(80);
  }

  // Fire laser and boost
  await page.keyboard.press('KeyE');
  await sleep(100);
  await page.keyboard.press('ShiftLeft');
  await sleep(100);

  const initialTicks = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getTicks());
  check('Simulation advanced in fixed ticks with recorded inputs', initialTicks > 30, `ticks=${initialTicks}`);

  // 3. Steer towards asteroids to conclude run naturally via keyboard inputs
  console.log('  Advancing simulation until legitimate game over...');
  for (let step = 0; step < 120; step++) {
    const isOver = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true);
    if (isOver) break;

    const diff = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('GameScene');
      const sim = scene.sim;
      const px = sim.player.position.x;
      const py = sim.player.position.y;
      let nearest = null;
      let minD = Infinity;
      for (const a of sim.asteroids) {
        if (!a.alive || a.dying) continue;
        const d = Math.hypot(a.position.x - px, a.position.y - py);
        if (d < minD) { minD = d; nearest = a; }
      }
      if (!nearest) return 0;
      const dx = nearest.position.x - px;
      const dy = nearest.position.y - py;
      const heading = ((((Math.atan2(-dx, dy) * 180) / Math.PI) % 360) + 360) % 360;
      let d = heading - sim.player.rotation;
      while (d < -180) d += 360;
      while (d > 180) d -= 360;
      return d;
    });

    if (diff < -15) {
      await page.keyboard.press('KeyA');
    } else if (diff > 15) {
      await page.keyboard.press('KeyD');
    }
    await page.keyboard.down('KeyW');
    await sleep(150);
    await page.keyboard.up('KeyW');
  }

  await page.waitForFunction(
    () => window.__ASTEROIDS_REPLAY__?.isGameOver() === true,
    null,
    { timeout: 45000, polling: 50 },
  );

  const browserScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getScore());
  const browserTicks = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getTicks());
  const replayRecord = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getReplay());

  check('Browser game reached legitimate game over', replayRecord?.claimedResult?.phase === 'gameOver');
  check('Replay record exported with valid header and seed', replayRecord?.header?.seed === seed);
  check('Replay inputs captured non-empty stream', replayRecord?.inputs?.length > 0, `changes=${replayRecord?.inputs?.length}`);

  // 4. Start independent Node verification
  console.log('  Running independent Node verification...');
  const result = verifyReplay(replayRecord);

  check('Node verification succeeded without errors', result.valid === true, result.error ? `err=${result.error}` : 'ok');
  check('Independently calculated score matches browser score', result.calculatedScore === browserScore, `node=${result.calculatedScore} browser=${browserScore}`);
  check('Independently calculated tick count matches browser ticks', result.totalTicks === browserTicks, `node=${result.totalTicks} browser=${browserTicks}`);
  check('Independently determined game phase is gameOver', result.phase === 'gameOver');
}

async function runTouchTest(browser) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const seed = 654321;

  // Set Assisted Flight in localStorage
  await page.addInitScript(() => {
    localStorage.setItem('asteroids.touchMovement', 'assisted');
    localStorage.setItem('asteroids.inputMode', 'touch');
  });

  await page.goto(`${BASE}?verified=1&seed=${seed}&debug=1`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });

  // Start game by activating PLAY on the menu
  await page.evaluate(() => {
    const scene = window.__game.scene.getScene('StartScene');
    scene.menu.controller.key('Space');
  });

  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), null, { timeout: 5000 });
  await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isVerified === true, null, { timeout: 5000 });
  check('[Assisted Flight] GameScene launched in verified mode', true);

  // Simulate touch drag on steering zone (pointing left: heading 90)
  const zoneBox = await page.evaluate(() => {
    const el = document.querySelector('.tc-zone');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });

  if (zoneBox) {
    const startX = zoneBox.x + zoneBox.width / 2;
    const startY = zoneBox.y + zoneBox.height / 2;
    // Dispatch touch down and move
    await page.evaluate(
      ([sx, sy]) => {
        const touch = window.__game.registry.get('touchControls');
        touch.model.press(1, 'stick', sx, sy);
        touch.model.move(1, sx - 45, sy); // push left -> heading 90
        touch.model.press(2, 'fire', sx + 200, sy); // hold fire
      },
      [startX, startY],
    );

    await sleep(250);

    // Release touches
    await page.evaluate(() => {
      const touch = window.__game.registry.get('touchControls');
      touch.model.release(1);
      touch.model.release(2);
    });
  }

  console.log('  [Assisted Flight] Advancing simulation until legitimate game over...');
  for (let step = 0; step < 120; step++) {
    const isOver = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true);
    if (isOver) break;

    await page.evaluate(() => {
      const scene = window.__game.scene.getScene('GameScene');
      const sim = scene.sim;
      const px = sim.player.position.x;
      const py = sim.player.position.y;
      let nearest = null;
      let minD = Infinity;
      for (const a of sim.asteroids) {
        if (!a.alive || a.dying) continue;
        const d = Math.hypot(a.position.x - px, a.position.y - py);
        if (d < minD) { minD = d; nearest = a; }
      }
      const touch = window.__game.registry.get('touchControls');
      if (nearest) {
        const dx = nearest.position.x - px;
        const dy = nearest.position.y - py;
        const heading = ((((Math.atan2(-dx, dy) * 180) / Math.PI) % 360) + 360) % 360;
        const rad = (heading * Math.PI) / 180;
        const sx = 400;
        const sy = 300;
        touch.model.press(1, 'stick', sx, sy);
        touch.model.move(1, sx + Math.sin(rad) * 60, sy - Math.cos(rad) * 60);
      } else {
        touch.model.press(1, 'stick', 400, 300);
        touch.model.move(1, 400, 240);
      }
    });

    await sleep(150);
  }

  await page.evaluate(() => {
    const touch = window.__game.registry.get('touchControls');
    touch.model.release(1);
  });

  // Wait for natural game over
  await page.waitForFunction(
    () => window.__ASTEROIDS_REPLAY__?.isGameOver() === true,
    null,
    { timeout: 45000, polling: 50 },
  );

  const browserScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getScore());
  const replayRecord = await page.evaluate(() => window.__ASTEROIDS_REPLAY__?.getReplay());

  // Confirm Assisted Flight steer was captured in the input stream
  const hasSteer = replayRecord?.inputs?.some((ch) => ch.input.steer?.mode === 'assist');
  check('[Assisted Flight] Touch steer request was recorded in replay input stream', hasSteer === true);

  // Independent Node verification
  const result = verifyReplay(replayRecord);
  check('[Assisted Flight] Node independently verified browser touch replay', result.valid === true);
  check('[Assisted Flight] Verified score matches browser score', result.calculatedScore === browserScore, `node=${result.calculatedScore} browser=${browserScore}`);
}
