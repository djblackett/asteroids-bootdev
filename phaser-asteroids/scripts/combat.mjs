// Browser test for combos, kill-streak banners and UFOs: drives the production build in a real (headless) Chrome with
// genuine key events, using the `?debug` hook only to place things that would take minutes to reach (a UFO a few
// pixels from the ship, a long chain of rocks, ...). Every check reads state the player could see: the HUD texts, the
// banner, the ship, the sim counters.
//
//   npm run test:combat          (builds first)
//   CHROME_PATH=/path/to/chrome node scripts/combat.mjs     (reuse an existing build in dist/)
//
// Screenshots go to scripts/.smoke-output/ (git-ignored). Software WebGL (SwiftShader) in headless Chrome only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { timed } from './lib/testTiming.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.COMBAT_PORT ?? 4398);
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
let browserVersion = '?';
try {
  await timed('preview startup', waitForServer);
  browser = await timed('Chromium startup', () => chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  }));
  browserVersion = browser.version();
  await timed('combat browser checks', () => run(browser));
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed  (Chromium ${browserVersion}, headless, software WebGL; no Firefox, Safari or GPU)`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  const shot = (name) => page.screenshot({ path: path.join(outDir, `combat-${name}.png`) });
  const S = `window.__game.scene.getScene('GameScene')`;
  const sim = () =>
    page.evaluate(`(() => { const s = ${S}.sim, p = s.player; return {
      x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, score: p.score, time: s.time, phase: s.phase,
      shots: s.shots.length, asteroids: s.asteroids.length, powerups: s.powerups.length, lasers: s.lasers.length,
      ufos: s.ufos.map((u) => ({ type: u.type, x: u.position.x, y: u.position.y, alive: u.alive, vx: u.velocity.x, vy: u.velocity.y })),
      ufoShots: s.ufoShots.length, combo: s.combo.count, comboTimer: s.combo.timer,
      banner: s.streakBanner ? { name: s.streakBanner.name, kills: s.streakBanner.kills, timer: s.streakBanner.timer } : null,
      shield: p.shieldActive, boost: p.boost.active, rapid: p.rapidFire.active, retry: s.retryDelay, particles: s.particles.activeCount,
      respawning: p.isRespawning, paused: ${S}.paused }; })()`);
  const texts = () => page.evaluate(`${S}.children.list.filter((c) => c.type === 'Text' && c.visible).map((t) => t.text)`);
  const audio = () =>
    page.evaluate(`(() => { const g = window.__game, a = g.registry.get('audio'); return {
      played: a.sfx.played, sfxPlaying: a.sfx.playingCount(), totalSounds: g.sound.sounds.length,
      musicInstances: g.sound.sounds.filter((s) => s.key.startsWith('music')).length,
      keys: g.sound.sounds.map((s) => s.key) }; })()`);
  const keyTap = async (key, ms = 60) => (await page.keyboard.down(key), await sleep(ms), await page.keyboard.up(key));
  const evalSim = (body) => page.evaluate(`(() => { const s = ${S}.sim; ${body} })()`);
  const waitSim = (condition) => page.waitForFunction(`(() => { const s = ${S}.sim; return ${condition}; })()`, null, { timeout: 5000 });
  /** Stops asteroids and the UFO schedule and clears the field, so a scenario starts from a known state. */
  const quiet = () =>
    evalSim(`s.spawner.spawnTimer = -1e9; s.ufoSpawner.enabled = false; s.asteroids.length = 0; s.shots.length = 0;
      s.ufos.length = 0; s.ufoShots.length = 0; s.powerups.length = 0; s.lasers.length = 0; s.startCooldown = 0;
      s.player.lives = 3; s.player.score = 0; s.player.shieldActive = false; s.player.isRespawning = false; s.player.rapidFire = { active: false, timer: 0 };
      s.combo.count = 0; s.combo.timer = 0; s.combo.lastMilestone = 0; s.streakBanner = null;`);
  const addRock = (x, y, radius = 20, archetype = 'standard') =>
    page.evaluate(
      ([x, y, radius, archetype]) => {
        const hp = archetype === 'armored' ? 2 : 1;
        window.__game.scene.getScene('GameScene').sim.asteroids.push({
          position: { x, y }, velocity: { x: 0, y: 0 }, radius, archetype,
          sizeCategory: radius >= 50 ? 'large' : radius >= 30 ? 'medium' : 'small', maxHitPoints: hp, hitPoints: hp,
          dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
      },
      [x, y, radius, archetype],
    );
  const place = (x, y, rotation) =>
    evalSim(`const p = s.player; p.position.x = ${x}; p.position.y = ${y}; p.rotation = ${rotation}; p.velocity = { x: 0, y: 0 };`);
  /** A UFO that does not move or shoot by itself (unless `live`). */
  const addUfo = (type, x, y, live = false) =>
    evalSim(`const u = s.spawnUfo('${type}', ${x}, ${y}); ${live ? '' : "u.shootTimer = 1e9; u.movementTimer = -1e9; u.targetVelocity = { x: 0, y: 0 };"}`);
  const addUfoShot = (x, y, vx = 0, vy = 0) =>
    evalSim(`s.ufoShots.push({ position: { x: ${x}, y: ${y} }, velocity: { x: ${vx}, y: ${vy} }, radius: 6, alive: true });`);

  // --- start ----------------------------------------------------------------------------------------------------
  await page.goto(`${BASE}?debug`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await waitSim('s.time > 0');
  const baseline = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  const baselineChildren = await page.evaluate(`${S}.children.list.length`);
  // Counts the simulation events the scene hands to the audio, so 'exactly once' can be checked without racing the ship.
  await page.evaluate(`(() => { const a = window.__game.registry.get('audio'); const orig = a.sfx.handle.bind(a.sfx);
    window.__ev = { ufo: 0, drops: 0, streak: 0, hit: 0 };
    a.sfx.handle = (events) => { for (const e of events) { if (e.type === 'ufo_destroyed') window.__ev.ufo++; else if (e.type === 'powerup_dropped') window.__ev.drops++; else if (e.type === 'kill_streak') window.__ev.streak++; else if (e.type === 'player_hit') window.__ev.hit++; } orig(events); }; })()`);
  const ev = () => page.evaluate('({ ...window.__ev })');
  const resetEv = () => page.evaluate('window.__ev = { ufo: 0, drops: 0, streak: 0, hit: 0 }');

  // --- natural UFO spawning: first one after ~5 s of play, large, on the field ----------------------------------------------------
  await evalSim(`s.spawner.spawnTimer = -1e9; s.player.lives = 99; s.player.shieldActive = true;`);
  // Watch every animation frame, so the moment the UFO appears is measured in game time, not guessed from sleeps.
  const spawn = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const sim = window.__game.scene.getScene('GameScene').sim;
        let lastTime = sim.time;
        const tick = () => {
          if (sim.ufos.length > 0) resolve({ appearedAt: sim.time, previousFrameTime: lastTime, type: sim.ufos[0].type, count: sim.ufos.length });
          else if (sim.time > 9) resolve({ appearedAt: null, count: 0 });
          else (lastTime = sim.time), requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  check('the first UFO arrives at 5 s of play (not before) and is a large one', spawn.count === 1 && spawn.type === 'large' && spawn.previousFrameTime < 5.05 && spawn.appearedAt >= 4.99 && spawn.appearedAt < 5.2, JSON.stringify(spawn));
  let st = await sim();
  await evalSim(`s.player.lives = 3; s.player.shieldActive = false;`);

  // --- both UFO kinds on screen: rendering and first shots ------------------------------------------------------------------------
  await quiet();
  await place(640, 600, 180);
  await addUfo('large', 300, 200, true);
  await addUfo('small', 950, 250, true);
  await evalSim(`s.ufos.forEach((u) => { u.shootTimer = 0.3; });`);
  await waitSim('s.ufoShots.length >= 1');
  st = await sim();
  check('a large and a small UFO are in play and have fired', st.ufos.length === 2 && st.ufoShots >= 1, JSON.stringify({ ufos: st.ufos.length, shots: st.ufoShots }));
  await shot('ufos');
  await sleep(1500);
  st = await sim();
  check('UFOs wander (they have moved) and stay inside the wrap bounds', st.ufos.every((u) => Math.hypot(u.vx, u.vy) > 5 && u.x > -40 && u.x < 1320 && u.y > -40 && u.y < 760), JSON.stringify(st.ufos));

  // --- UFO shot hits the ship: life lost, death sound, respawn; shield absorbs another ----------------------------------------------
  await quiet();
  await place(640, 360, 0);
  const a0 = await audio();
  await addUfoShot(640, 360);
  await waitSim('s.ufoShots.length === 0');
  st = await sim();
  let a1 = await audio();
  check('a UFO shot costs a life, sends the ship to the respawn point and plays one sound', st.lives === 2 && Math.abs(st.x - 320) < 20 && st.respawning && st.ufoShots === 0 && a1.played === a0.played + 1, JSON.stringify({ lives: st.lives, x: st.x, played: a1.played - a0.played }));
  check('HUD shows the new life count', (await texts()).includes('Lives: 2'));
  await quiet();
  await place(640, 360, 0);
  await evalSim(`s.player.shieldActive = true;`);
  const a2 = await audio();
  await addUfoShot(640, 360);
  await waitSim('s.ufoShots.length === 0');
  st = await sim();
  a1 = await audio();
  check('a shield absorbs a UFO shot: no life lost, shield gone, no death sound', st.lives === 3 && !st.shield && a1.played === a2.played, JSON.stringify({ lives: st.lives, shield: st.shield, played: a1.played - a2.played }));
  await evalSim(`s.player.isRespawning = true; s.player.respawnTimer = 5;`);
  await addUfoShot(640, 360);
  await waitSim('s.ufoShots.length === 0');
  st = await sim();
  check('a respawning (invulnerable) ship takes no damage from a UFO shot', st.lives === 3 && st.ufoShots === 0);
  await evalSim(`s.player.isRespawning = false; s.player.respawnTimer = 0;`);

  // --- a player shot kills a UFO: flat points, no combo, a power-up, a sound ---------------------------------------------------------
  await quiet();
  await place(200, 360, 270);
  await addUfo('small', 700, 360);
  await resetEv();
  await page.keyboard.down('Space');
  await waitSim('s.ufos.length === 0');
  await page.keyboard.up('Space');
  await sleep(200);
  st = await sim();
  check('shooting a small UFO destroys it for exactly 500 points with no combo', st.ufos.length === 0 && st.score === 500 && st.combo === 0, JSON.stringify({ score: st.score, combo: st.combo, ufos: st.ufos.length }));
  check('...which reports exactly one UFO kill and one power-up drop (and the drop is on the field)', st.powerups === 1 && (await ev()).ufo === 1 && (await ev()).drops === 1, JSON.stringify({ pu: st.powerups, ev: await ev() }));
  await shot('ufo-killed-drop');

  // --- collect the UFO's drop by flying into it ---------------------------------------------------------------------------------------
  await evalSim(`const d = s.powerups[0]; d.velocity = { x: 0, y: 0 }; d.type = 'shield'; s.player.position.x = d.position.x - 120; s.player.position.y = d.position.y; s.player.rotation = 270;`);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(`${S}.sim.player.shieldActive`, null, { timeout: 3000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  st = await sim();
  check('flying into the UFO power-up collects it (Shield on, HUD line shown)', st.shield && st.powerups === 0 && (await texts()).includes('SHIELD: ACTIVE'));

  // --- boost ramming through a UFO: destroyed, no damage, shield kept --------------------------------------------------------------------
  await quiet();
  await evalSim(`s.player.shieldActive = true;`);
  await place(100, 360, 270);
  await addUfo('large', 500, 360);
  await resetEv();
  await keyTap('Shift', 80);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(`${S}.sim.ufos.length === 0`, null, { timeout: 3000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  st = await sim();
  check('a boost ram destroys the large UFO (+200) and costs neither a life nor the shield', st.score === 200 && st.lives === 3 && st.shield && (await ev()).ufo === 1 && (await ev()).drops === 1 && (await ev()).hit === 0, JSON.stringify({ score: st.score, lives: st.lives, shield: st.shield, ev: await ev() }));
  await evalSim(`s.player.boost.active = false; s.player.boost.cooldown = 0;`);

  // --- touching a UFO without boosting costs a life --------------------------------------------------------------------------------------
  await quiet();
  await place(640, 360, 0);
  await addUfo('large', 660, 360);
  await waitSim('s.player.lives === 2');
  st = await sim();
  check('touching a UFO without boosting costs a life; the UFO flies on', st.lives === 2 && st.ufos.length === 1);

  // --- the Laser Beam kills a UFO on its path (Phase 4 refinement; Python's beam ignored UFOs) -------------------------------------------
  await quiet();
  await place(100, 360, 270);
  await addUfo('large', 500, 360);
  await resetEv();
  await keyTap('KeyE');
  await sleep(600); // the beam lasts 0.3 s: long enough to prove it pays only once
  st = await sim();
  check('the Laser Beam destroys a UFO on its path: +200 once, one UFO event, one guaranteed drop', st.ufos.length === 0 && st.score === 200 && (await ev()).ufo === 1 && (await ev()).drops === 1 && st.powerups === 1, JSON.stringify({ ufos: st.ufos.length, score: st.score, powerups: st.powerups, ev: await ev() }));

  // --- a shield absorbs a UFO body once; staying in the contact does not hit again at once ---------------------------------------------
  await quiet();
  await evalSim(`s.player.shieldActive = true;`);
  await place(640, 360, 0);
  await addUfo('large', 660, 360);
  await sleep(400);
  st = await sim();
  check('a shield absorbs the UFO body and the ship is not hit again 0.4 s later in the same contact', st.lives === 3 && !st.shield && st.ufos.length === 1, JSON.stringify({ lives: st.lives, shield: st.shield }));
  await sleep(1300);
  st = await sim();
  check('...but the grace is not lasting immunity: after ~1 s of staying in the UFO the contact costs a life', st.lives === 2, JSON.stringify({ lives: st.lives }));

  // --- combo: real gunfire down a line of rocks; HUD ---------------------------------------------------------------------------------------
  await quiet();
  await place(60, 360, 270);
  await evalSim(`s.player.rapidFire = { active: true, timer: 30 };`);
  for (let i = 0; i < 5; i++) await addRock(260 + i * 90, 360, 20);
  await page.keyboard.down('Space');
  await page.waitForFunction(`${S}.sim.combo.count >= 4`, null, { timeout: 5000 }).catch(() => {});
  await sleep(120);
  const comboTexts = await texts();
  await shot('combo');
  await page.keyboard.up('Space');
  st = await sim();
  check('rapid kills build a combo (4+) and the score uses the multipliers', st.combo >= 4 && st.score >= 50 + 75 + 100 + 125, JSON.stringify({ combo: st.combo, score: st.score }));
  check('HUD shows "N x COMBO" and the multiplier', comboTexts.some((t) => /^\d+x COMBO$/.test(t)) && comboTexts.some((t) => /^\d\.\dx Points!$/.test(t)), JSON.stringify(comboTexts.filter((t) => /COMBO|Points/.test(t))));
  await sleep(3300);
  st = await sim();
  check('3 s after the last kill the combo ends and its HUD disappears', st.combo === 0 && !(await texts()).some((t) => /COMBO/.test(t)));

  // --- a UFO destroyed during a combo leaves it alone ---------------------------------------------------------------------------------------
  await quiet();
  await place(60, 360, 270);
  await evalSim(`s.player.rapidFire = { active: true, timer: 30 };`);
  for (let i = 0; i < 3; i++) await addRock(260 + i * 80, 360, 20);
  await addUfo('large', 800, 360);
  await page.keyboard.down('Space');
  await page.waitForFunction(`${S}.sim.ufos.length === 0`, null, { timeout: 5000 }).catch(() => {});
  await page.keyboard.up('Space');
  st = await sim();
  check('a UFO killed after three rocks: combo stays 3 and the UFO is a flat 200', st.combo === 3 && st.score === 50 + 75 + 100 + 200, JSON.stringify({ combo: st.combo, score: st.score }));

  // --- kill streak banner: real gunfire, 20 kills --------------------------------------------------------------------------------------------
  await quiet();
  await place(40, 360, 270);
  await evalSim(`s.player.rapidFire = { active: true, timer: 30 };`);
  for (let i = 0; i < 22; i++) await addRock(130 + i * 45, 360, 20);
  await page.keyboard.down('Space');
  await page.waitForFunction(`${S}.sim.streakBanner !== null`, null, { timeout: 8000 }).catch(() => {});
  await sleep(450);
  const bannerTexts = await texts();
  st = await sim();
  await shot('streak-banner');
  check('15 kills in a chain show the KILLING SPREE! banner with "15 KILLS"', st.banner?.name === 'KILLING SPREE!' && bannerTexts.includes('KILLING SPREE!') && bannerTexts.includes('15 KILLS'), JSON.stringify({ banner: st.banner, texts: bannerTexts.filter((t) => /KILL|SPREE/.test(t)) }));
  const moveFrom = await sim();
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  const moveTo = await sim();
  check('the banner never blocks input (the ship still moves while it is up)', moveFrom.banner !== null && Math.hypot(moveTo.x - moveFrom.x, moveTo.y - moveFrom.y) > 30, JSON.stringify({ from: [moveFrom.x, moveFrom.y], to: [moveTo.x, moveTo.y] }));
  await sleep(2800);
  st = await sim();
  check('the banner is gone after ~2.5 s', st.banner === null && !(await texts()).includes('KILLING SPREE!'));

  // --- the widest banner next to the widest combo readout: the texts must not overlap -------------------------------------------------------------
  await quiet();
  await place(640, 650, 180);
  await evalSim('s.combo.count = 199; s.combo.timer = 3; s.combo.lastMilestone = 150;');
  await addRock(300, 200, 20);
  await evalSim('s.shots.push({ position: { x: 300, y: 200 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });');
  await sleep(700);
  const bounds = await page.evaluate(`(() => {
    const t = ${S}.children.list.filter((c) => c.type === 'Text' && c.visible);
    const b = (re) => { const o = t.find((x) => re.test(x.text)); if (!o) return null; const r = o.getBounds(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: o.text }; };
    return { name: b(/^BEYOND LEGENDARY!$/), combo: b(/COMBO$/), count: b(/^200 KILLS$/) };
  })()`);
  await shot('beyond-legendary');
  check('BEYOND LEGENDARY! (200 kills) and the "200x COMBO" readout do not overlap', bounds.name && bounds.combo && bounds.name.right < bounds.combo.left - 5, JSON.stringify({ bounds, sim: await sim(), texts: await texts() }));
  await evalSim('s.combo.count = 0; s.combo.timer = 0; s.streakBanner = null;');

  // --- armored: non-lethal hit makes no combo ---------------------------------------------------------------------------------------------------
  await quiet();
  await place(60, 360, 270);
  await addRock(400, 360, 20, 'armored');
  await keyTap('Space', 40);
  await waitSim('s.asteroids[0]?.hitPoints === 1');
  st = await sim();
  check('the first hit on an armored rock is not a kill (no combo, no score)', st.combo === 0 && st.score === 0 && st.asteroids === 1, JSON.stringify({ combo: st.combo, score: st.score, rocks: st.asteroids }));

  // --- pause during a UFO encounter ---------------------------------------------------------------------------------------------------------------
  await quiet();
  await place(640, 650, 180);
  await addUfo('small', 400, 200, true);
  await evalSim(`s.ufos[0].shootTimer = 0.2;`);
  await sleep(900);
  await keyTap('KeyP');
  await page.waitForFunction(`${S}.paused`, null, { timeout: 5000 });
  const pausedA = await sim();
  await sleep(1200);
  const pausedB = await sim();
  check('pausing freezes UFOs, UFO shots and the clock', pausedA.paused && JSON.stringify(pausedA.ufos) === JSON.stringify(pausedB.ufos) && pausedA.ufoShots === pausedB.ufoShots && pausedA.time === pausedB.time, JSON.stringify({ a: pausedA.ufos[0], b: pausedB.ufos[0] }));
  await keyTap('KeyP');
  await waitSim(`!${S}.paused && s.time > ${pausedB.time} + 0.3`);
  const resumed = await sim();
  check('resuming moves them again', !resumed.paused && resumed.time > pausedB.time + 0.3 && JSON.stringify(resumed.ufos) !== JSON.stringify(pausedB.ufos));

  // --- performance and lifecycle under intense combat ---------------------------------------------------------------------------------------------------
  await quiet();
  await evalSim(`s.spawner.spawnTimer = 0; s.asteroidSpawnRate = 0.15; s.player.lives = 999; s.player.shieldActive = true;`);
  await place(640, 360, 0);
  await evalSim(`s.player.rapidFire = { active: true, timer: 30 }; s.player.multiShot = { active: true, timer: 30 };`);
  await addUfo('large', 200, 150, true);
  await addUfo('small', 1100, 600, true);
  await evalSim(`s.ufos.forEach((u) => { u.shootTimer = 0.1; u.shootCooldown = 0.35; });`);
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyW');
  const perf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let peak = { ufoShots: 0, sounds: 0, particles: 0, ufos: 0 };
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          const s = window.__game.scene.getScene('GameScene').sim;
          peak = {
            ufoShots: Math.max(peak.ufoShots, s.ufoShots.length),
            sounds: Math.max(peak.sounds, window.__game.sound.sounds.length),
            particles: Math.max(peak.particles, s.particles.activeCount),
            ufos: Math.max(peak.ufos, s.ufos.length),
          };
          if (now - t0 < 8000) requestAnimationFrame(tick);
          else resolve({ times, peak });
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const sorted = [...perf.times].sort((x, y) => x - y);
  const avg = perf.times.reduce((x, y) => x + y, 0) / perf.times.length;
  console.log(`INFO  intense combat, 8 s: avg frame ${avg.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms; peaks ${JSON.stringify(perf.peak)}`);
  await shot('intense');
  check('intense combat with UFOs stays smooth (avg frame < 25 ms)', avg < 25, `avg=${avg.toFixed(1)}`);
  check('UFO shots, sound objects, particles and UFOs stay bounded', perf.peak.ufoShots < 40 && perf.peak.sounds < 40 && perf.peak.particles <= 500 && perf.peak.ufos <= 2, JSON.stringify(perf.peak));
  const after = await audio();
  check('still exactly one music instance, no pile-up of effect sounds', after.musicInstances === 1 && after.sfxPlaying < 20, JSON.stringify({ music: after.musicInstances, sfx: after.sfxPlaying }));

  // --- die with UFOs, shots, rocks and a banner on screen, then restart (3 rounds) -------------------------------------------------------------------------
  for (let round = 0; round < 3; round++) {
    await quiet();
    await evalSim(`s.spawner.spawnTimer = -1e9;`);
    await place(640, 360, 0);
    await addUfo('large', 200, 150, true);
    await addUfo('small', 1100, 600, true);
    await addUfoShot(300, 300, 50, 20);
    await addRock(900, 500, 60);
    await evalSim(`s.combo.count = 14; s.combo.timer = 3; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
      s.asteroids.push({ position: { x: 640, y: 360 }, velocity: { x: 0, y: 0 }, radius: 20, archetype: 'standard', sizeCategory: 'small', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });`);
    await page.waitForFunction(`${S}.sim.phase === 'gameOver'`, null, { timeout: 5000 });
    st = await sim();
    if (round === 0) await shot('gameover-with-ufos');
    check(`game over #${round + 1} with UFOs on screen: banner and combo HUD are gone`, st.banner === null && !(await texts()).some((t) => /COMBO|KILLS/.test(t)), JSON.stringify(await texts()));
    await page.waitForFunction(`${S}.sim.retryDelay === 0`, null, { timeout: 5000 });
    await keyTap('KeyR');
    await waitSim("s.phase === 'playing' && s.time > 0");
    st = await sim();
    const au = await audio();
    check(`restart #${round + 1}: no UFOs, enemy shots, combo or banner left over; one music instance`, st.phase === 'playing' && st.ufos.length === 0 && st.ufoShots === 0 && st.combo === 0 && st.banner === null && st.lives === 3 && st.score === 0 && au.musicInstances === 1, JSON.stringify({ ufos: st.ufos.length, shots: st.ufoShots, combo: st.combo, music: au.musicInstances }));
  }
  const listeners = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden') })`);
  check('no listener build-up after restarts', JSON.stringify(listeners) === JSON.stringify(baseline), JSON.stringify({ listeners, baseline }));
  const children = await page.evaluate(`${S}.children.list.length`);
  check('no display objects accumulate across restarts', children === baselineChildren, `${children} vs ${baselineChildren}`);
  // The new run's UFO schedule starts over: still nothing at 2 s.
  await sleep(2000);
  st = await sim();
  check('the new run schedules its first UFO from scratch (none yet)', st.ufos.length === 0 && st.time < 5);

  check('no console errors, page errors or failed requests', problems.length === 0, problems.join(' | '));
}
