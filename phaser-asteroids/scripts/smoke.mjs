// Browser smoke test: drives the production build in a real (headless) Chrome and checks the behaviour that
// unit tests cannot: Phaser/WebGL start-up, input, audio unlocking, pause / blur handling, HUD, restart cleanup.
//
//   npm run test:browser          (builds first)
//   CHROME_PATH=/path/to/chrome node scripts/smoke.mjs     (reuse an existing build in dist/)
//
// It needs a Chromium-based browser installed locally; nothing is downloaded. It starts its own `vite preview`.
// Screenshots go to scripts/.smoke-output/ (git-ignored).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.SMOKE_PORT ?? 4399);
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
  // Default autoplay policy on purpose: audio must start locked and unlock on the first key press.
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
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // A new visitor's soundtrack is Random now; this suite's checks are about the Original track's level and key, so it starts on Original (the music suite covers the default).
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

  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const scene = () => `window.__game.scene.getScene('GameScene')`;
  const sim = () =>
    page.evaluate(`(() => { const s = ${scene()}.sim, p = s.player; return {
      x: p.position.x, y: p.position.y, rot: p.rotation, lives: p.lives, score: p.score, time: s.time, phase: s.phase,
      shots: s.shots.length, asteroids: s.asteroids.length, powerups: s.powerups.length, lasers: s.lasers.length,
      laser: p.laser.shotsRemaining, boost: p.boost.active, mega: p.megaPower.active, rapid: p.rapidFire.active,
      multi: p.multiShot.active, shield: p.shieldActive, slow: s.slowMotion.active, retry: s.retryDelay };})()`);
  const hudText = () =>
    page.evaluate(`${scene()}.children.list.filter((c) => c.type === 'Text' && c.visible).map((t) => t.text)`);
  const audio = () =>
    page.evaluate(`(() => { const g = window.__game, a = g.registry.get('audio'), m = a.musicSound;
      return { locked: g.sound.locked, ctx: g.sound.context ? g.sound.context.state : 'n/a',
        music: m ? { playing: m.isPlaying, paused: m.isPaused, rate: m.rate, key: m.key, gain: m.volume, requested: m.currentConfig.volume } : null,
        musicInstances: g.sound.sounds.filter((s) => s.key.startsWith('music')).length, totalSounds: g.sound.sounds.length,
        sfxPlaying: a.sfx.playingCount(), muted: a.music.isMuted, musicState: a.music.currentState,
        vm: a.volume('music'), vs: a.volume('sfx'),
        sfxVolumes: g.sound.sounds.filter((s) => !s.key.startsWith('music') && s.volumeNode).map((s) => s.currentConfig.volume) }; })()`);
  const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
  const near = (x, y, eps = 0.005) => typeof x === 'number' && Math.abs(x - y) < eps;
  const keyTap = async (key, ms = 60) => (await page.keyboard.down(key), await sleep(ms), await page.keyboard.up(key));
  const quiet = () =>
    page.evaluate(`(() => { const s = ${scene()}.sim; s.spawner.spawnTimer = -1e9; s.asteroids.length = 0; s.shots.length = 0; s.startCooldown = 0; })()`);
  const addRock = (x, y, radius = 60, archetype = 'standard', vx = 0, vy = 0) =>
    page.evaluate(
      ([x, y, radius, archetype, vx, vy]) => {
        const hp = archetype === 'armored' ? 2 : 1;
        window.__game.scene.getScene('GameScene').sim.asteroids.push({
          position: { x, y }, velocity: { x: vx, y: vy }, radius, archetype,
          sizeCategory: radius >= 50 ? 'large' : radius >= 30 ? 'medium' : 'small', maxHitPoints: hp, hitPoints: hp,
          dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
      },
      [x, y, radius, archetype, vx, vy],
    );
  const grant = (type) =>
    page.evaluate(
      (type) => {
        const s = window.__game.scene.getScene('GameScene').sim;
        s.powerups.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 15, type, lifetime: 12, alive: true });
      },
      type,
    );
  const place = (x, y, rotation) =>
    page.evaluate(([x, y, r]) => { const p = window.__game.scene.getScene('GameScene').sim.player; p.position.x = x; p.position.y = y; p.rotation = r; p.velocity = { x: 0, y: 0 }; }, [x, y, rotation]);

  // --- start-up, engine, audio lock -------------------------------------------------------------------
  await page.goto(`${BASE}?debug`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  const info = await page.evaluate(() => ({ type: window.__game.renderer.type, w: window.__game.scale.width, h: window.__game.scale.height }));
  check('WebGL renderer at 1280x720', info.type === 2 && info.w === 1280 && info.h === 720, JSON.stringify(info));
  await sleep(300);
  await shot('01-start');

  let a = await audio();
  check('audio starts locked, music not yet playing', a.locked === true && a.music === null, JSON.stringify(a));

  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await page.waitForFunction(() => !window.__game.sound.locked, null, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  a = await audio();
  check('first key press unlocks audio and starts the music', !a.locked && a.music?.playing === true && a.music.key === 'music', JSON.stringify(a));
  check('exactly one music instance, normal speed', a.musicInstances === 1 && a.music?.rate === 1, `instances=${a.musicInstances} rate=${a.music?.rate}`);

  const listenerBaseline = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden'), focus: window.__game.events.listenerCount('focus') })`);

  // --- movement basics ----------------------------------------------------------------------------------
  await quiet();
  let s0 = await sim();
  check('ship starts centred, facing Down, with full lives and charges', s0.x === 640 && s0.y === 360 && s0.rot === 0 && s0.lives === 3 && s0.laser === 15);
  await page.keyboard.down('KeyW');
  await sleep(450);
  await shot('02-thrust');
  await page.keyboard.up('KeyW');
  const s1 = await sim();
  check('W moves the ship Down at ~300 px/s', s1.y - s0.y > 100 && Math.abs(s1.x - s0.x) < 1, `dy=${(s1.y - s0.y).toFixed(0)}`);
  await page.keyboard.down('KeyD');
  await sleep(300);
  await page.keyboard.up('KeyD');
  check('D rotates the ship', (await sim()).rot > 40);

  // --- shooting + drops -----------------------------------------------------------------------------------
  await quiet();
  await place(300, 360, 270);
  await addRock(600, 360, 20);
  await page.evaluate(`(() => { const s = ${scene()}.sim; const orig = s.rng; const q = [0.5, 0.01, 0.5];  // forced: ordinary drop, 3rd type
    s.rng = () => (q.length ? q.shift() : orig()); })()`);
  await page.keyboard.down('Space');
  await sleep(1100);
  await page.keyboard.up('Space');
  await sleep(300);
  const hits = await sim();
  check('a shot kills an asteroid (small = 50 pts)', hits.score >= 50, `score=${hits.score}`);
  check('the kill dropped a power-up that is on the field', hits.powerups >= 1 || hits.rapid || hits.multi || hits.shield || hits.slow, JSON.stringify({ p: hits.powerups, multi: hits.multi }));
  await shot('03-shot-and-drop');

  // --- every power-up: pickup, HUD, expiry ------------------------------------------------------------------
  await quiet();
  await place(640, 360, 0);
  for (const [type, label, flag] of [
    ['rapid_fire', 'RAPID FIRE:', 'rapid'],
    ['multi_shot', 'MULTI-SHOT:', 'multi'],
    ['shield', 'SHIELD: ACTIVE', 'shield'],
    ['slow_motion', 'SLOW MOTION:', 'slow'],
  ]) {
    await grant(type);
    await sleep(250);
    const st = await sim();
    const texts = await hudText();
    check(`${type}: collected, active, shown in the HUD`, st[flag] === true && texts.some((t) => t.startsWith(label)), `${label} in ${JSON.stringify(texts.filter((t) => /:/.test(t)))}`);
  }
  await shot('04-powerups-active');
  await grant('mega_power');
  await sleep(300);
  const mega = await sim();
  const megaTexts = await hudText();
  check('MEGA POWER: all effects on, single rainbow HUD line', mega.mega && mega.rapid && mega.multi && mega.shield && mega.slow && megaTexts.some((t) => t.includes('MEGA POWER')) && !megaTexts.some((t) => t.startsWith('RAPID FIRE')), JSON.stringify(megaTexts.filter((t) => /:/.test(t))));
  const audioMega = await audio();
  check('music speed unchanged during Mega Power (Python ships the speed-up disabled)', audioMega.music?.rate === 1 && audioMega.musicInstances === 1);
  await shot('05-mega');
  await page.evaluate(`(() => { const p = ${scene()}.sim.player; p.megaPower.timer = 0.05; ${scene()}.sim.slowMotion.timer = 0.05; })()`);
  await sleep(300);
  const afterMega = await sim();
  check('Mega Power expiry switches Rapid Fire / Multi-Shot / Slow Motion off, keeps the shield', !afterMega.mega && !afterMega.rapid && !afterMega.multi && !afterMega.slow && afterMega.shield);

  // --- laser -------------------------------------------------------------------------------------------------
  await quiet();
  await page.evaluate(`(() => { const p = ${scene()}.sim.player; p.shieldActive = false; })()`);
  await place(100, 360, 270);
  await addRock(400, 360, 60);
  await addRock(700, 350, 40);
  await addRock(1000, 370, 20);
  const beforeLaser = await sim();
  await keyTap('KeyE');
  await sleep(120);
  const laser = await sim();
  await shot('06-laser');
  check('E fires the laser: charge spent, beam alive, all three asteroids pierced', laser.laser === beforeLaser.laser - 1 && laser.lasers === 1 && laser.score >= beforeLaser.score + 80, JSON.stringify({ charges: laser.laser, beams: laser.lasers, score: laser.score }));
  check('HUD shows the remaining laser charges', (await hudText()).includes(`LASER: ${laser.laser}/15`));
  await keyTap('KeyE');
  check('a second press during the 1 s cooldown does nothing', (await sim()).laser === laser.laser);
  await sleep(500);
  check('beam fades away after 0.3 s', (await sim()).lasers === 0);

  // --- boost ---------------------------------------------------------------------------------------------------
  await quiet();
  await place(100, 360, 270);
  await page.keyboard.down('Shift');
  await sleep(80);
  await page.keyboard.up('Shift');
  await sleep(100);
  const boost = await sim();
  check('Shift starts a boost', boost.boost === true);
  check('HUD shows boost status', (await hudText()).some((t) => t.startsWith('BOOST:') && !t.includes('READY')));
  const bx = (await sim()).x;
  await page.keyboard.down('KeyW');
  await sleep(300);
  await shot('07-boost');
  await addRock((await sim()).x + 120, 360, 60);
  await sleep(400);
  await page.keyboard.up('KeyW');
  const rammed = await sim();
  check('boost moves ~2.5x faster and rams an asteroid without losing a life', rammed.x - bx > 300 && rammed.lives === 3 && rammed.score >= 10, JSON.stringify({ dx: rammed.x - bx, lives: rammed.lives, score: rammed.score }));
  await page.evaluate(`(() => { ${scene()}.sim.player.boost.timer = 0.05; })()`);
  await sleep(250);
  const boostEnded = await sim();
  check('boost ends and the cooldown shows', !boostEnded.boost && (await hudText()).some((t) => t.endsWith('CD')));

  // --- audio: pause / blur / mute -------------------------------------------------------------------------------
  await page.keyboard.press('KeyP');
  await sleep(200);
  a = await audio();
  check('pausing the game pauses the music', a.music?.paused === true && a.musicState === 'paused', JSON.stringify(a.music));
  const overlayText = await page.evaluate(`${scene()}.children.list.filter((c) => c.type === 'Container' && c.visible).flatMap((c) => c.list.filter((t) => t.type === 'Text').map((t) => t.text))`);
  check('pause overlay shows PAUSED and the music toggle', overlayText.includes('PAUSED') && overlayText.some((t) => t.startsWith('Press M to Toggle Music')), JSON.stringify(overlayText));
  await page.keyboard.press('KeyP');
  await sleep(200);
  a = await audio();
  check('resuming resumes the same music instance', a.music?.playing === true && a.musicInstances === 1);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(200);
  a = await audio();
  check('window blur pauses game and music', (await page.evaluate(`${scene()}.paused`)) && a.music?.paused === true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(200);
  a = await audio();
  check('regaining focus keeps a paused game silent', (await page.evaluate(`${scene()}.paused`)) && a.music?.paused === true, JSON.stringify(a.music));
  await page.keyboard.press('KeyP');
  await sleep(200);
  check('unpausing after blur resumes the music', (await audio()).music?.playing === true);

  await keyTap('KeyM');
  await sleep(150);
  a = await audio();
  const mutedStored = await stored('asteroids.musicMuted');
  check('M mutes the music and remembers it', a.muted && a.music?.paused === true && mutedStored === '1', `stored=${mutedStored}`);
  await keyTap('KeyM');
  await sleep(150);
  a = await audio();
  check('M again unmutes', !a.muted && a.music?.playing === true && (await page.evaluate(() => localStorage.getItem('asteroids.musicMuted'))) === '0');

  // --- audio: Music / SFX volume controls (pause screen), persistence, mute, restarts ----------------------------------------------
  a = await audio();
  check('defaults: Music 80 % (real gain 0.56), SFX 80 %, nothing saved yet', near(a.vm, 0.8, 1e-9) && near(a.vs, 0.8, 1e-9) && near(a.music?.gain, 0.56) && (await stored('asteroids.musicVolume')) === null, JSON.stringify({ vm: a.vm, vs: a.vs, gain: a.music?.gain }));
  await page.keyboard.press('ArrowLeft'); // not paused: the arrows steer the ship and must not touch the volume
  await sleep(100);
  check('arrow keys do not change the volume while playing', near((await audio()).vm, 0.8, 1e-9) && (await stored('asteroids.musicVolume')) === null);

  await page.keyboard.press('KeyP');
  await sleep(200);
  const pausedTexts = await hudText();
  check('pause screen shows Music and SFX rows with the keys to use', pausedTexts.some((t) => t.startsWith('> Music') && t.includes('80%')) && pausedTexts.some((t) => t.startsWith('  SFX') && t.includes('80%')) && pausedTexts.some((t) => t.includes('Left/Right')), JSON.stringify(pausedTexts.filter((t) => /Music|SFX|Left/.test(t))));
  await shot('11-pause-volume');
  await page.keyboard.press('ArrowLeft');
  await sleep(80);
  await page.keyboard.press('ArrowLeft');
  await sleep(150);
  a = await audio();
  check('Left x2 lowers Music to 60 %: applied to the playing track, one instance, still paused', near(a.vm, 0.6, 1e-9) && near(a.music?.requested, 0.42) && a.musicInstances === 1 && a.music?.paused === true, JSON.stringify({ vm: a.vm, requested: a.music?.requested, inst: a.musicInstances }));
  check('...saved, SFX untouched', (await stored('asteroids.musicVolume')) === '0.6' && near(a.vs, 0.8, 1e-9) && (await stored('asteroids.sfxVolume')) === null);

  await page.keyboard.press('ArrowDown'); // select SFX
  await sleep(80);
  await page.keyboard.press('ArrowRight');
  await sleep(80);
  await page.keyboard.press('ArrowRight');
  a = await audio();
  check('Down + Right x2 raises SFX to 100 % and plays a sample shot at that level', near(a.vs, 1, 1e-9) && a.sfxVolumes.some((v) => near(v, 0.28)), JSON.stringify({ vs: a.vs, sfx: a.sfxVolumes }));
  check('...saved, Music untouched', (await stored('asteroids.sfxVolume')) === '1' && near(a.vm, 0.6, 1e-9));
  await sleep(500);
  const pausedRows = (await hudText()).filter((t) => /^[> ] (Music|SFX)/.test(t));
  check('rows redraw with the new values and selection', pausedRows.some((t) => t.startsWith('  Music') && t.includes('60%')) && pausedRows.some((t) => t.startsWith('> SFX') && t.includes('100%')), JSON.stringify(pausedRows));

  await page.keyboard.press('KeyM'); // mute while paused, then adjust Music
  await sleep(100);
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  await page.keyboard.press('ArrowLeft');
  await sleep(150);
  a = await audio();
  check('Music can be adjusted while muted: stays muted and paused, level saved', a.muted && a.music?.paused === true && near(a.vm, 0.5, 1e-9) && (await stored('asteroids.musicVolume')) === '0.5' && (await stored('asteroids.musicMuted')) === '1', JSON.stringify({ vm: a.vm, muted: a.muted }));
  await page.keyboard.press('KeyM');
  await sleep(100);
  await page.keyboard.press('ArrowRight'); // back to 60 %
  await sleep(100);
  await page.keyboard.press('KeyP');
  await sleep(250);
  a = await audio();
  check('unmuting + resuming plays the same single track at the chosen level', !a.muted && a.music?.playing === true && a.musicInstances === 1 && near(a.music?.gain, 0.42) && near(a.vm, 0.6, 1e-9), JSON.stringify({ gain: a.music?.gain, inst: a.musicInstances, vm: a.vm }));
  await page.evaluate(() => { const a = window.__game.registry.get('audio'); for (let i = 0; i < 7; i++) a.adjustVolume('sfx', -1); });
  await sleep(100);
  a = await audio();
  check('SFX can be lowered to 30 %; the music is not affected by it', near(a.vs, 0.3, 1e-9) && near(a.music?.gain, 0.42) && a.music?.playing === true, JSON.stringify({ vs: a.vs, gain: a.music?.gain }));
  await page.evaluate(() => { const a = window.__game.registry.get('audio'); for (let i = 0; i < 4; i++) a.adjustVolume('sfx', 1); });
  await sleep(400);
  a = await audio();
  check('settled at Music 60 %, SFX 70 %', near(a.vm, 0.6, 1e-9) && near(a.vs, 0.7, 1e-9), JSON.stringify({ vm: a.vm, vs: a.vs }));
  await page.evaluate(() => window.__game.registry.get('audio').adjustVolume('music', -1));
  await sleep(150);
  a = await audio();
  check('a change while the music is playing reaches the live audio node (50 % -> gain 0.35), no restart', a.music?.playing === true && near(a.music?.gain, 0.35) && a.musicInstances === 1, JSON.stringify({ gain: a.music?.gain, playing: a.music?.playing }));
  await page.evaluate(() => window.__game.registry.get('audio').adjustVolume('music', 1));
  await sleep(150);
  a = await audio();
  check('...and back to 60 % (gain 0.42)', a.music?.playing === true && near(a.music?.gain, 0.42) && near(a.vm, 0.6, 1e-9));

  // --- chaos: effects + many sounds, sound objects must not pile up --------------------------------------------------------
  await quiet();
  await page.evaluate(`(() => { const s = ${scene()}.sim; s.player.lives = 99; s.spawner.spawnTimer = 0; })()`);
  await grant('mega_power');
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyW');
  const { times: frameTimes, maxShoot } = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let maxShoot = 0;
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          let shoot = 0;
          for (const s of window.__game.sound.sounds) if (s.key.startsWith('shoot') && s.volumeNode) shoot += s.currentConfig.volume;
          maxShoot = Math.max(maxShoot, shoot);
          if (now - t0 < 6000) requestAnimationFrame(tick);
          else resolve({ times, maxShoot });
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const sorted = [...frameTimes].sort((x, y) => x - y);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avg = frameTimes.reduce((x, y) => x + y, 0) / frameTimes.length;
  console.log(`INFO  chaos frame times over 6 s: avg ${avg.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms (software GL)`);
  check('chaos stays smooth (avg frame < 25 ms)', avg < 25, `avg=${avg.toFixed(1)}`);
  const chaos = await sim();
  a = await audio();
  await shot('08-chaos');
  check('sound objects stay bounded under heavy fire', a.totalSounds < 30 && a.sfxPlaying < 20, `total=${a.totalSounds} sfx=${a.sfxPlaying}`);
  const oneShot = 0.28 * a.vs;
  console.log(`INFO  Mega Power fire: loudest moment adds up to ${(maxShoot / oneShot).toFixed(2)} x one shot (${maxShoot.toFixed(3)} vs ${oneShot.toFixed(3)})`);
  check('Rapid Fire + Multi-Shot shots add up to at most ~2.1 x a single shot (3 x if unattenuated)', maxShoot > 0 && maxShoot <= oneShot * 2.1 + 1e-6, `max=${maxShoot.toFixed(3)} single=${oneShot.toFixed(3)}`);
  check('entity counts stay bounded', chaos.shots < 60 && chaos.asteroids < 100 && chaos.powerups < 20, JSON.stringify({ shots: chaos.shots, ast: chaos.asteroids, pu: chaos.powerups }));

  // --- game over with effects active, then restarts: no stacked music, listeners or effects --------------------------------------
  for (let round = 0; round < 3; round++) {
    await page.evaluate(`(() => { const s = ${scene()}.sim; s.spawner.spawnTimer = -1e9; s.player.lives = 1; s.player.shieldActive = false; s.player.isRespawning = false; s.player.boost.active = false;
      s.player.rapidFire = { active: true, timer: 4 }; s.slowMotion = { active: true, timer: 4 };
      s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true }); })()`);
    await page.waitForFunction(`${scene()}.sim.phase === 'gameOver'`, null, { timeout: 5000 });
    if (round === 0) await shot('09-gameover');
    const over = await sim();
    check(`game over #${round + 1} reached with effects active`, over.phase === 'gameOver' && over.lives === 0);
    await page.waitForFunction(`${scene()}.sim.retryDelay === 0`, null, { timeout: 5000 });
    await keyTap('KeyR');
    await sleep(400);
    const fresh = await sim();
    a = await audio();
    check(`restart #${round + 1}: clean state, one music instance still playing`, fresh.phase === 'playing' && fresh.lives === 3 && fresh.score === 0 && !fresh.rapid && !fresh.slow && fresh.laser === 15 && fresh.powerups === 0 && a.musicInstances === 1 && a.music?.playing === true, JSON.stringify({ fresh: [fresh.phase, fresh.lives, fresh.rapid, fresh.slow, fresh.laser], music: a.musicInstances }));
    check(`restart #${round + 1}: Music and SFX levels kept, music still at its level`, near(a.vm, 0.6, 1e-9) && near(a.vs, 0.7, 1e-9) && near(a.music?.gain, 0.42), JSON.stringify({ vm: a.vm, vs: a.vs, gain: a.music?.gain }));
  }
  const listeners = await page.evaluate(`({ blur: window.__game.events.listenerCount('blur'), hidden: window.__game.events.listenerCount('hidden'), focus: window.__game.events.listenerCount('focus') })`);
  check('no listener build-up after restarts', JSON.stringify(listeners) === JSON.stringify(listenerBaseline), JSON.stringify({ listeners, listenerBaseline }));

  // --- one-shot keys: auto-repeat and same-frame bursts (Phaser 4.2.1 replays queued key events) ------------------------
  const wasPaused = await page.evaluate(`${scene()}.paused`);
  await page.keyboard.down('KeyP');
  for (let i = 0; i < 5; i++) await page.keyboard.down('KeyP'); // auto-repeat events
  await page.keyboard.up('KeyP');
  await sleep(150);
  check('holding P (auto-repeat) toggles pause exactly once', (await page.evaluate(`${scene()}.paused`)) === !wasPaused);
  await keyTap('KeyP');
  let burstFailures = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('KeyP');
    await page.keyboard.press('Escape'); // typically lands in the same frame as P
    const reached = await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 1500 }).then(() => true, () => false);
    if (!reached) burstFailures++;
    if (!reached) await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 3000 });
    await sleep(120);
  }
  check('P then Escape in quick succession always reaches the menu (12 tries)', burstFailures === 0, `failures=${burstFailures}`);

  // --- menu and back ---------------------------------------------------------------------------------------------------
  await page.keyboard.press('KeyP');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 3000 });
  a = await audio();
  check('music keeps playing on the title screen, at the same level', a.music?.playing === true && a.musicInstances === 1 && near(a.music?.gain, 0.42) && near(a.vm, 0.6, 1e-9));
  await shot('10-start-with-powerups');
  check('title screen shows the volume rows', (await page.evaluate(`window.__game.scene.getScene('StartScene').children.list.filter((c) => c.type === 'Text').map((t) => t.text)`)).some((t) => t.startsWith('> Music') && t.includes('60%')));
  await page.keyboard.press('ArrowRight');
  await sleep(120);
  a = await audio();
  check('Right on the title screen raises Music to 70 % (live and saved)', near(a.vm, 0.7, 1e-9) && near(a.music?.gain, 0.49) && (await stored('asteroids.musicVolume')) === '0.7' && a.musicInstances === 1);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 3000 });
  check('can start again; still one music instance', (await audio()).musicInstances === 1);

  // --- a new session remembers the mix -------------------------------------------------------------------------------------------
  await page.keyboard.press('KeyM'); // leave a mute preference behind too
  await sleep(100);
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  a = await audio();
  check('after a reload Music 70 %, SFX 70 % and mute are restored', near(a.vm, 0.7, 1e-9) && near(a.vs, 0.7, 1e-9) && a.muted === true, JSON.stringify({ vm: a.vm, vs: a.vs, muted: a.muted }));
  await page.keyboard.press('KeyM'); // unmute: the music starts, at the restored level
  await page.waitForFunction(() => !window.__game.sound.locked, null, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  a = await audio();
  check('...and the music starts straight at the saved level', !a.muted && a.music?.playing === true && near(a.music?.gain, 0.49) && a.musicInstances === 1, JSON.stringify({ muted: a.muted, gain: a.music?.gain, playing: a.music?.playing, locked: a.locked }));
  await shot('12-start-after-reload');

  // --- scaling ------------------------------------------------------------------------------------------------------------
  for (const vp of [{ width: 800, height: 600 }, { width: 1920, height: 500 }]) {
    await page.setViewportSize(vp);
    await sleep(800);
    const r = await page.evaluate(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return { w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, iw: innerWidth, ih: innerHeight }; });
    check(`scales to ${vp.width}x${vp.height}: 16:9, centred`, Math.abs(r.w / r.h - 16 / 9) < 0.02 && Math.abs(r.cx - r.iw / 2) < 2 && Math.abs(r.cy - r.ih / 2) < 2);
  }

  // --- production does not expose the debug hook ----------------------------------------------------------------------------
  const plain = await browser.newPage();
  await plain.goto(BASE);
  await plain.waitForFunction(() => document.querySelector('canvas'), null, { timeout: 15000 });
  check('without ?debug no game object is exposed on window', await plain.evaluate(() => window.__game === undefined));
  await plain.close();

  check('no console errors, page errors or failed requests', problems.length === 0, problems.join(' | '));
}
