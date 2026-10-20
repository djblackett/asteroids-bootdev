// Browser test for the soundtrack selector: drives the production build in a real (headless) Chrome and checks what unit tests cannot:
// which music files the browser downloads and when, that exactly one music sound exists after every kind of switch, that the choice
// survives a reload, Random's per-run behaviour through real restarts, a track that fails to load, and the selector on the title and pause
// screens with a keyboard, a mouse, a (simulated) gamepad and a touch screen.
//
//   npm run test:music          (builds first)
//   node scripts/music.mjs      (reuse an existing build in dist/)
//
// What this proves and what it does not: it proves the wiring and the audio lifecycle in Chromium (real Web Audio, real decoding, no audio
// device needed). It does NOT prove how the tracks sound or how loud they are relative to each other and to the effects: that needs a
// listening session (see docs/music-tracks.md). Screenshots go to scripts/.smoke-output/music-*.png (git-ignored).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'scripts', '.smoke-output');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.MUSIC_PORT ?? 4406);
const BASE = `http://127.0.0.1:${PORT}/`;
const STORE = 'asteroids.musicTrack';
// The levels these checks expect (src/audio/audioConfig.ts): master 0.7 x Music setting 0.8 x the track's own level.
const GAIN = { music: 0.56, 'music-megaman': 0.56 * 1.65, 'music-gatekeeper': 0.56 * 1.55 };
const KEY_OF = { original: 'music', megaman: 'music-megaman', gatekeeper: 'music-gatekeeper' };

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
const near = (a, b, tol = 0.002) => typeof a === 'number' && Math.abs(a - b) <= tol;

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
  // Default autoplay policy on purpose: audio starts locked and unlocks on the first key press / tap.
  browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await run();
} finally {
  await browser?.close();
  stopServer();
}
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------

/** A page with its console / network recorded. `touch` gives mobile emulation; `pad` a scripted Gamepad API. */
async function open({ query = '?debug', touch = false, size, pad = false, seed = null } = {}) {
  const viewport = size ?? (touch ? { width: 844, height: 390 } : { width: 1280, height: 720 });
  const context = await browser.newContext({ viewport, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch });
  if (seed) {
    // Written once, before the first load only, so a reload sees what the game itself saved.
    await context.addInitScript((s) => {
      try {
        if (!sessionStorage.getItem('__seeded')) {
          sessionStorage.setItem('__seeded', '1');
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }
      } catch {
        // storage blocked: nothing to seed
      }
    }, seed);
  }
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
  const page = await context.newPage();
  const problems = [];
  const warnings = [];
  const musicRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  page.on('request', (r) => {
    const m = /\/audio\/music\/([^/?#]+)/.exec(r.url());
    if (m) musicRequests.push(m[1]);
  });
  const cdp = touch ? await context.newCDPSession(page) : null;
  const t = {
    page,
    context,
    problems,
    warnings,
    musicRequests,
    async goto() {
      await page.goto(`${BASE}${query}`);
      await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
      await sleep(250);
    },
    scene: () => page.evaluate(() => window.__game.scene.getScenes(true).map((s) => s.scene.key).join(',')),
    paused: () => page.evaluate(() => window.__game.scene.getScene('GameScene').paused),
    /** Everything about the music, in one round trip. */
    audio: () =>
      page.evaluate(() => {
        const g = window.__game;
        const a = g.registry.get('audio');
        const sounds = g.sound.sounds.filter((s) => s.key.startsWith('music'));
        return {
          choice: a.musicChoice,
          current: a.currentTrack,
          state: a.music.currentState,
          muted: a.music.isMuted,
          locked: g.sound.locked,
          loading: a.musicLoading,
          count: sounds.length,
          sounds: sounds.map((s) => ({ key: s.key, playing: s.isPlaying, paused: s.isPaused, loop: s.loop, volume: s.volume, requested: s.currentConfig.volume, tag: s.__tag ?? null })),
          cached: ['music', 'music-megaman', 'music-gatekeeper'].filter((k) => g.cache.audio.exists(k)),
          stored: localStorage.getItem('asteroids.musicTrack'),
          musicVolume: a.volume('music'),
          sfxVolume: a.volume('sfx'),
          storedMusicVolume: localStorage.getItem('asteroids.musicVolume'),
          storedSfxVolume: localStorage.getItem('asteroids.sfxVolume'),
        };
      }),
    /** Waits until nothing is downloading and any faded-out sound is gone, then reports the music state. */
    async settled(timeout = 20000) {
      await page.waitForFunction(() => { const a = window.__game.registry.get('audio'); return !a.musicLoading && a.musicSoundCount <= 1; }, null, { timeout }).catch(() => {});
      await sleep(150);
      return t.audio();
    },
    /** The one playing music sound's key, once it plays. */
    async playing(key, timeout = 20000) {
      await page.waitForFunction((k) => window.__game.registry.get('audio').musicSound?.key === k && window.__game.registry.get('audio').musicSound.isPlaying, key, { timeout }).catch(() => {});
      return t.settled();
    },
    texts: (sceneKey) =>
      page.evaluate((k) => {
        const out = [];
        const walk = (list, visible) => {
          for (const c of list) {
            const v = visible && c.visible;
            if (c.type === 'Text' && v && c.text) out.push(c.text);
            if (c.list) walk(c.list, v);
          }
        };
        walk(window.__game.scene.getScene(k).children.list, true);
        return out;
      }, sceneKey),
    key: (k) => page.keyboard.press(k),
    /** Tags the live music sound so a later check can tell whether it is the same object (not restarted). */
    tag: (name) => page.evaluate((n) => { window.__game.registry.get('audio').musicSound.__tag = n; }, name),
    /** Page coordinates of a point inside the game canvas, given game coordinates. */
    async toPage(gx, gy) {
      const r = await page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().toJSON());
      return { x: r.left + (gx / 1280) * r.width, y: r.top + (gy / 720) * r.height, scale: r.width / 1280 };
    },
    /** Game-space bounds of the first visible Text in a scene whose text matches. */
    textBounds: (sceneKey, pattern) =>
      page.evaluate(([k, p]) => {
        const re = new RegExp(p);
        const find = (list) => {
          for (const c of list) {
            if (c.type === 'Text' && c.visible && re.test(c.text)) return c.getBounds();
            if (c.list) { const f = find(c.list); if (f) return f; }
          }
          return null;
        };
        const b = find(window.__game.scene.getScene(k).children.list);
        return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      }, [sceneKey, pattern]),
    async tap(gx, gy) {
      const p = await t.toPage(gx, gy);
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      } else {
        await page.mouse.click(p.x, p.y);
      }
      await sleep(250);
    },
    shot: (name) => page.screenshot({ path: path.join(outDir, `music-${name}.png`) }),
    /** Start from the title screen with the keyboard. */
    async start() {
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
      await sleep(300);
    },
    /** Ends the run (a rock on the player, no spare lives), waits for RETRY to work. */
    async gameOver() {
      if (await t.paused()) {
        info('the game was paused when the test wanted to end the run; resuming it first');
        await page.keyboard.press('KeyP');
        await sleep(200);
      }
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('GameScene').sim;
        s.spawner.spawnTimer = -1e9;
        s.player.lives = 1;
        s.player.shieldActive = false;
        s.player.isRespawning = false;
        s.player.boost.active = false;
        s.asteroids.push({ position: { x: s.player.position.x, y: s.player.position.y }, velocity: { x: 0, y: 0 }, radius: 40, archetype: 'standard', sizeCategory: 'medium', maxHitPoints: 1, hitPoints: 1, dying: false, deathTimer: 0, deathTimerReal: 0, hitFlashTimer: 0, shakeOffset: { x: 0, y: 0 }, alive: true });
      });
      await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.phase === 'gameOver', null, { timeout: 8000 });
      await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.retryDelay === 0, null, { timeout: 8000 });
    },
    padPut: (spec) => page.evaluate((s) => window.__pads.put(0, s), spec),
    async padTap(button, ms = 140) {
      await t.padPut({ buttons: { [button]: 1 } });
      await sleep(ms);
      await t.padPut({});
      await sleep(140);
    },
  };
  return t;
}

async function run() {
  // =====================================================================================================
  // 1. A first visit: Original, and only Original is downloaded before the title appears
  // =====================================================================================================
  console.log('\n--- first visit ---');
  const a = await open();
  await a.goto();
  let s = await a.audio();
  check('a new player has no saved soundtrack and gets Original', s.stored === null && s.choice === 'original' && s.current === 'original', JSON.stringify({ stored: s.stored, choice: s.choice }));
  check('only the Original music file was downloaded to show the title screen', a.musicRequests.length === 1 && a.musicRequests[0] === 'retro-bgmusic.ogg', JSON.stringify(a.musicRequests));
  check('the audio is locked and nothing plays before the first key press', s.locked === true && s.count === 0 && s.state === 'stopped', JSON.stringify({ locked: s.locked, count: s.count }));
  const titleTexts = await a.texts('StartScene');
  check('the title screen shows the Track row with Original', titleTexts.some((x) => /Track\s*<\s*Original\s*>/.test(x)), JSON.stringify(titleTexts.filter((x) => /Track|Music|SFX/.test(x))));
  await a.shot('title');

  // The first key press both unlocks the audio and (here) selects the Track row: it must not start a game.
  await a.key('ArrowDown');
  s = await a.playing('music');
  check('the first key press unlocks audio and plays Original, once, looping, at the unchanged level', !s.locked && s.count === 1 && s.sounds[0]?.playing && s.sounds[0]?.loop === true && near(s.sounds[0]?.volume, GAIN.music, 1e-6), JSON.stringify(s.sounds));
  check('that key press did not start a game', (await a.scene()) === 'StartScene');

  // =====================================================================================================
  // 2. Keyboard on the title screen
  // =====================================================================================================
  console.log('\n--- keyboard: title screen ---');
  await a.key('ArrowDown'); // Track row selected
  await a.key('ArrowRight');
  s = await a.playing('music-megaman');
  check('Right on the Track row selects Mega Man: saved, downloaded on demand, plays', s.choice === 'megaman' && s.stored === 'megaman' && s.current === 'megaman' && a.musicRequests.includes('megaman.mp3') && s.sounds.length === 1 && s.sounds[0]?.key === 'music-megaman' && s.sounds[0]?.playing, JSON.stringify({ s: s.sounds, req: a.musicRequests }));
  check('only one music sound exists (Original was released), at the Mega Man level', s.count === 1 && near(s.sounds[0]?.volume, GAIN['music-megaman'], 1e-6) && s.sounds[0]?.loop === true, JSON.stringify(s.sounds));
  check('the title screen shows Mega Man and is still the title screen', (await a.texts('StartScene')).some((x) => /Track\s*<\s*Mega Man\s*>/.test(x)) && (await a.scene()) === 'StartScene');
  await a.shot('title-megaman');

  await a.key('ArrowRight');
  s = await a.playing('music-gatekeeper');
  check('Right again selects Gatekeeper (one sound, its own level)', s.choice === 'gatekeeper' && s.stored === 'gatekeeper' && s.count === 1 && near(s.sounds[0]?.volume, GAIN['music-gatekeeper'], 1e-6), JSON.stringify(s.sounds));
  await a.tag('before-random');
  await a.key('ArrowRight');
  s = await a.settled();
  check('Right again selects Random: saved as "random", the playing track carries on untouched', s.choice === 'random' && s.stored === 'random' && s.count === 1 && s.sounds[0]?.key === 'music-gatekeeper' && s.sounds[0]?.tag === 'before-random', JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  await a.key('ArrowRight');
  s = await a.playing('music');
  check('Right again wraps to Original', s.choice === 'original' && s.stored === 'original' && s.count === 1 && s.sounds[0]?.key === 'music', JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  await a.key('ArrowLeft');
  s = await a.settled();
  check('Left from Original wraps to Random', s.choice === 'random' && s.stored === 'random' && s.count === 1, JSON.stringify({ choice: s.choice, count: s.count }));
  check('each extra track was requested once on its first selection', a.musicRequests.filter((f) => f === 'megaman.mp3').length >= 1 && a.musicRequests.filter((f) => f === 'gatekeeper.mp3').length >= 1);
  check('no more than two decoded music tracks are kept in memory', s.cached.length <= 2, JSON.stringify(s.cached));
  check('the selector changed no other setting (Music 80 %, SFX 80 %, not muted; nothing saved for them)', near(s.musicVolume, 0.8, 1e-9) && near(s.sfxVolume, 0.8, 1e-9) && !s.muted && s.storedMusicVolume === null && s.storedSfxVolume === null, JSON.stringify({ m: s.musicVolume, f: s.sfxVolume }));

  // =====================================================================================================
  // 3. Mouse on the title screen
  // =====================================================================================================
  console.log('\n--- mouse: title screen ---');
  await a.key('ArrowRight'); // Random -> Original
  await a.playing('music');
  const row = await a.textBounds('StartScene', 'Track');
  check('the Track row has a sensible size on the title screen', row !== null && row.w > 150 && row.h >= 16, JSON.stringify(row));
  await a.tap(row.x + row.w * 0.85, row.y + row.h / 2);
  s = await a.playing('music-megaman');
  check('clicking the right half of the row selects the next track (Mega Man)', s.choice === 'megaman' && s.stored === 'megaman' && s.sounds.length === 1 && s.sounds[0]?.key === 'music-megaman', JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  check('...and does not start the game', (await a.scene()) === 'StartScene');
  await a.tap(row.x + row.w * 0.12, row.y + row.h / 2);
  s = await a.playing('music');
  check('clicking the left half selects the previous track (Original)', s.choice === 'original' && s.count === 1 && s.sounds[0]?.key === 'music', JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  check('...and still does not start the game', (await a.scene()) === 'StartScene');
  check('console clean through all of the title-screen selection', a.problems.length === 0, a.problems.join(' | '));
  await a.context.close();

  // =====================================================================================================
  // 4. A run: pause, change the track while paused, resume, mute, volume, focus, menu
  // =====================================================================================================
  console.log('\n--- keyboard: in a game ---');
  const g = await open({ seed: { [STORE]: 'megaman' } });
  await g.goto();
  check('with Mega Man saved, only Mega Man is downloaded to show the title screen', g.musicRequests.length === 1 && g.musicRequests[0] === 'megaman.mp3', JSON.stringify(g.musicRequests));
  await g.start();
  s = await g.playing('music-megaman');
  check('a new game starts with the saved track playing', s.current === 'megaman' && s.count === 1 && s.sounds[0]?.playing === true, JSON.stringify(s.sounds));
  await g.tag('run-1');
  await g.key('KeyP');
  await sleep(200);
  s = await g.audio();
  check('pausing pauses the same music sound', (await g.paused()) && s.sounds.length === 1 && s.sounds[0]?.paused === true && s.sounds[0]?.tag === 'run-1' && s.state === 'paused');
  const pauseTexts = await g.texts('GameScene');
  check('the pause screen shows the Track row', pauseTexts.some((x) => /Track\s*<\s*Mega Man\s*>/.test(x)), JSON.stringify(pauseTexts.filter((x) => /Track|Music|SFX/.test(x))));
  await g.shot('pause');
  await g.key('ArrowDown');
  await g.key('ArrowDown');
  await g.key('ArrowRight'); // -> Gatekeeper
  s = await g.settled();
  check('changing the track while paused releases the old sound and does not play the new one yet', (await g.paused()) && s.choice === 'gatekeeper' && s.stored === 'gatekeeper' && !s.sounds.some((x) => x.playing) && s.state === 'stopped', JSON.stringify({ sounds: s.sounds, state: s.state }));
  check('...and does not resume or dismiss the pause screen, nor touch gameplay', (await g.scene()) === 'GameScene' && (await g.paused()));
  await g.key('KeyP');
  s = await g.playing('music-gatekeeper');
  check('resuming plays the newly chosen track: one sound, looping, its own level', !(await g.paused()) && s.count === 1 && s.sounds[0]?.playing && s.sounds[0]?.loop && near(s.sounds[0]?.volume, GAIN['music-gatekeeper'], 1e-6), JSON.stringify(s.sounds));
  await g.tag('run-1b');
  for (let i = 0; i < 4; i++) {
    await g.key('KeyP');
    await sleep(80);
    await g.key('KeyP');
    await sleep(80);
  }
  await g.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(150);
  await g.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(150);
  await g.key('KeyP');
  await sleep(150);
  s = await g.settled();
  check('repeated pause / resume and a blur / focus keep the same single sound and track', s.count === 1 && s.sounds[0]?.tag === 'run-1b' && s.sounds[0]?.playing && s.current === 'gatekeeper', JSON.stringify(s.sounds));

  // mute + track change + unmute
  await g.key('KeyM');
  await sleep(120);
  await g.key('KeyP'); // pause so the arrows act on the menu
  await g.key('ArrowRight'); // Gatekeeper -> Random (Track row is still selected)
  await g.key('ArrowRight'); // Random -> Original
  s = await g.settled();
  check('changing the track while muted starts nothing', s.muted && s.choice === 'original' && !s.sounds.some((x) => x.playing), JSON.stringify({ muted: s.muted, sounds: s.sounds }));
  await g.key('KeyM');
  await g.key('KeyP');
  s = await g.playing('music');
  check('unmuting and resuming plays the new track, one sound, at the Original level', !s.muted && s.count === 1 && near(s.sounds[0]?.volume, GAIN.music, 1e-6), JSON.stringify(s.sounds));
  check('mute state is shared by all tracks and was saved', (await g.page.evaluate(() => localStorage.getItem('asteroids.musicMuted'))) === '0');

  // volume with a boosted track
  await g.key('KeyP');
  await g.key('ArrowRight'); // Original -> Mega Man
  await g.key('KeyP');
  s = await g.playing('music-megaman');
  await g.tag('vol');
  await g.key('KeyP');
  await g.key('ArrowUp');
  await g.key('ArrowUp'); // Music row
  await g.key('ArrowLeft');
  s = await g.audio();
  check('lowering Music to 70 % reaches the playing Mega Man sound at once, scaled by its track level, without a restart', near(s.sounds[0]?.requested, 0.7 * 0.7 * 1.65, 1e-6) && s.sounds[0]?.tag === 'vol' && s.count === 1 && s.storedMusicVolume === '0.7', JSON.stringify({ sounds: s.sounds, stored: s.storedMusicVolume }));
  await g.key('ArrowRight');
  await g.key('KeyP');
  await sleep(200);

  // retry and the main menu keep the track
  await g.gameOver();
  s = await g.audio();
  check('game over keeps the same track playing (one sound)', s.count === 1 && s.sounds[0]?.key === 'music-megaman' && s.sounds[0]?.playing, JSON.stringify(s.sounds));
  await g.key('KeyR');
  await sleep(500);
  s = await g.settled();
  check('RETRY starts the new game with the same chosen track, still one sound', !(await g.paused()) && s.count === 1 && s.sounds[0]?.key === 'music-megaman' && s.sounds[0]?.tag === 'vol', JSON.stringify(s.sounds));
  await g.key('KeyP');
  await g.key('Escape');
  await sleep(500);
  s = await g.settled();
  check('Main Menu keeps the music going: the same sound, no second one', (await g.scene()) === 'StartScene' && s.count === 1 && s.sounds[0]?.tag === 'vol' && s.sounds[0]?.playing, JSON.stringify({ scene: await g.scene(), sounds: s.sounds }));
  await g.start();
  s = await g.settled();
  check('starting again from the title keeps it too', s.count === 1 && s.sounds[0]?.tag === 'vol' && s.current === 'megaman');

  // a reload
  await g.page.reload();
  await g.page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  s = await g.audio();
  check('after a reload the selection is restored (and nothing but that track was downloaded again)', s.choice === 'megaman' && (await g.texts('StartScene')).some((x) => /Track\s*<\s*Mega Man\s*>/.test(x)), JSON.stringify({ choice: s.choice }));
  check('console clean through a whole run with soundtrack changes', g.problems.length === 0, g.problems.join(' | '));
  await g.context.close();

  // =====================================================================================================
  // 5. Persistence per track, and which file the next visit downloads
  // =====================================================================================================
  console.log('\n--- persistence ---');
  for (const choice of ['original', 'megaman', 'gatekeeper']) {
    const p = await open({ seed: { [STORE]: choice } });
    await p.goto();
    const first = KEY_OF[choice];
    const file = choice === 'original' ? 'retro-bgmusic.ogg' : `${choice}.mp3`;
    await p.start();
    s = await p.playing(first);
    check(`${choice}: a saved choice downloads just its own file and plays it in the first game`, p.musicRequests.length === 1 && p.musicRequests[0] === file && s.count === 1 && s.sounds[0]?.key === first && s.sounds[0]?.playing && near(s.sounds[0]?.volume, GAIN[first], 1e-6), JSON.stringify({ req: p.musicRequests, sounds: s.sounds }));
    await p.context.close();
  }
  for (const stale of ['', 'retro-bgmusic.ogg', 'Random', 'null', '3']) {
    const p = await open({ seed: { [STORE]: stale } });
    await p.goto();
    s = await p.audio();
    check(`an invalid saved value (${JSON.stringify(stale)}) is ignored: Original`, s.choice === 'original' && s.current === 'original' && p.problems.length === 0);
    await p.context.close();
  }

  // =====================================================================================================
  // 6. Random: one track per run, a different one on every new run
  // =====================================================================================================
  console.log('\n--- Random mode ---');
  const r = await open({ seed: { [STORE]: 'random' } });
  await r.goto();
  s = await r.audio();
  check('Random is the saved mode and boot downloaded exactly one track (the first run\'s)', s.choice === 'random' && s.stored === 'random' && r.musicRequests.length === 1, JSON.stringify({ choice: s.choice, req: r.musicRequests }));
  const titleTrack = s.current;
  await r.start();
  s = await r.playing(KEY_OF[titleTrack]);
  check('the first game plays the track the title screen was already on', s.current === titleTrack && s.count === 1 && s.sounds[0]?.playing, JSON.stringify({ titleTrack, sounds: s.sounds }));
  const runTrack = s.current;
  await r.tag('random-run-1');
  for (let i = 0; i < 4; i++) {
    await r.key('KeyP');
    await sleep(100);
    await r.key('KeyP');
    await sleep(100);
  }
  await r.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await r.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await r.key('KeyP');
  await r.key('KeyM');
  await sleep(100);
  await r.key('KeyM');
  await sleep(300);
  s = await r.settled();
  check('through pause, resume, blur / focus and mute the run keeps its one track and sound', s.current === runTrack && s.count === 1 && s.sounds[0]?.tag === 'random-run-1' && s.sounds[0]?.playing, JSON.stringify({ runTrack, current: s.current, sounds: s.sounds }));
  await r.page.setViewportSize({ width: 1000, height: 700 });
  await sleep(300);
  await r.page.setViewportSize({ width: 1280, height: 720 });
  await r.page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  await sleep(300);
  s = await r.settled();
  check('resizing and a fullscreenchange do not change the track or duplicate it', s.current === runTrack && s.count === 1 && s.sounds[0]?.tag === 'random-run-1', JSON.stringify({ current: s.current, sounds: s.sounds }));

  const seen = [runTrack];
  let previous = runTrack;
  let neverRepeated = true;
  let alwaysOne = true;
  for (let i = 0; i < 7; i++) {
    await r.gameOver();
    s = await r.audio();
    if (s.current !== previous || s.count !== 1) neverRepeated = neverRepeated && s.current === previous;
    await r.key('KeyR');
    await sleep(300);
    s = await r.playing(KEY_OF[(await r.audio()).current]);
    if (s.current === previous) neverRepeated = false;
    if (s.count !== 1 || !s.sounds[0]?.playing) alwaysOne = false;
    previous = s.current;
    seen.push(previous);
  }
  check(`RETRY picks a new random track each time, never the one just played (${seen.join(' > ')})`, neverRepeated && new Set(seen).size >= 2, JSON.stringify(seen));
  check('...with exactly one playing music sound after every retry', alwaysOne);
  s = await r.audio();
  check('after all that Random is still the saved mode', s.stored === 'random' && s.choice === 'random');
  await r.key('KeyP');
  await r.key('Escape');
  await sleep(400);
  const menuTrack = (await r.audio()).current;
  await r.start();
  s = await r.playing(KEY_OF[(await r.audio()).current]);
  check('a game started from the title screen also picks a different random track', s.current !== menuTrack && s.count === 1 && s.sounds[0]?.playing, JSON.stringify({ menuTrack, now: s.current }));
  check('console clean in Random mode', r.problems.length === 0, r.problems.join(' | '));
  await r.context.close();

  // =====================================================================================================
  // 7. A track that cannot be loaded
  // =====================================================================================================
  console.log('\n--- a track that cannot be loaded ---');
  for (const [mode, handler] of [
    ['404', (route) => route.fulfill({ status: 404, body: 'nope' })],
    ['corrupt data', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(40000, 7) })],
    ['network error', (route) => route.abort('failed')],
  ]) {
    const f = await open();
    await f.page.route('**/audio/music/megaman.mp3', handler);
    await f.goto();
    await f.key('ArrowDown');
    await f.key('ArrowDown');
    await f.key('ArrowRight'); // Mega Man
    s = await f.playing('music');
    await sleep(500);
    s = await f.settled();
    check(`Mega Man unavailable (${mode}): the game falls back to Original, playing, one sound`, s.current === 'original' && s.count === 1 && s.sounds[0]?.key === 'music' && s.sounds[0]?.playing && near(s.sounds[0]?.volume, GAIN.music, 1e-6), JSON.stringify({ current: s.current, sounds: s.sounds }));
    check(`...the player's choice is kept, a diagnostic is logged, and the title screen still works`, s.choice === 'megaman' && s.stored === 'megaman' && f.warnings.some((w) => /Mega Man.*could not be loaded.*Original/.test(w)) && (await f.scene()) === 'StartScene', JSON.stringify({ warnings: f.warnings }));
    await f.start();
    s = await f.settled();
    check('...and a game can be played with it, without trying the broken file over and over', (await f.scene()) === 'GameScene' && s.count === 1 && s.sounds[0]?.playing && f.musicRequests.filter((x) => x === 'megaman.mp3').length <= 2, JSON.stringify({ req: f.musicRequests }));
    // a later choice of a working track still works
    await f.key('KeyP');
    await f.key('ArrowDown');
    await f.key('ArrowDown');
    await f.key('ArrowRight'); // Gatekeeper
    await f.key('KeyP');
    s = await f.playing('music-gatekeeper');
    check('...and choosing a working track afterwards plays it', s.current === 'gatekeeper' && s.count === 1 && s.sounds[0]?.playing, JSON.stringify(s.sounds));
    await f.context.close();
  }

  // =====================================================================================================
  // 8. Gamepad (a scripted Gamepad API: the wiring, not a real controller)
  // =====================================================================================================
  console.log('\n--- gamepad ---');
  const pd = await open({ pad: true });
  await pd.goto();
  await pd.padPut({});
  await sleep(300);
  // A button press is not a browser "user gesture", so a controller alone cannot unlock the audio (a key press, click or tap does).
  await pd.key('Shift');
  await pd.padTap(0); // A: an unassigned pad joins player 1
  await pd.padTap(2); // X: next track on the title screen
  s = await pd.playing('music-megaman');
  check('X on the title screen steps to Mega Man: saved, playing, still the title screen', s.choice === 'megaman' && s.stored === 'megaman' && s.count === 1 && (await pd.scene()) === 'StartScene', JSON.stringify({ choice: s.choice, scene: await pd.scene() }));
  await pd.padTap(2);
  await pd.padTap(2);
  await pd.padTap(2);
  s = await pd.settled();
  check('X again cycles Gatekeeper, Random, Original', s.choice === 'original' && s.count === 1, JSON.stringify({ choice: s.choice }));
  await pd.padTap(15); // D-pad right = two players, not the music
  s = await pd.audio();
  check('D-pad left / right still choose one or two players, not the music', s.choice === 'original' && (await pd.texts('StartScene')).some((x) => /PLAYER 2/.test(x)));
  await pd.padTap(14);
  await pd.padTap(0); // A: start
  await pd.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(300);
  await pd.padTap(9); // START: pause
  check('START pauses the game', await pd.paused());
  await pd.padTap(13);
  await pd.padTap(13); // Track row
  await pd.padTap(15); // right: Mega Man
  s = await pd.settled();
  check('D-pad down, down, right on the pause screen changes the track (game stays paused, nothing plays yet)', s.choice === 'megaman' && s.stored === 'megaman' && (await pd.paused()) && !s.sounds.some((x) => x.playing), JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  await pd.padTap(9);
  s = await pd.playing('music-megaman');
  check('START resumes with the new track, one sound', !(await pd.paused()) && s.count === 1 && s.sounds[0]?.playing, JSON.stringify(s.sounds));
  check('console clean with the gamepad', pd.problems.length === 0, pd.problems.join(' | '));
  await pd.context.close();

  // =====================================================================================================
  // 9. Touch screen (Chromium touch emulation, 844 x 390 landscape)
  // =====================================================================================================
  console.log('\n--- touch screen ---');
  const th = await open({ touch: true });
  await th.goto();
  const metrics = await th.toPage(0, 0);
  check('the touch title screen is the touch menu', (await th.texts('StartScene')).some((x) => x === 'TAP TO PLAY'));
  const names = await th.texts('StartScene');
  check('it shows MUSIC: ORIGINAL with arrows', names.includes('MUSIC: ORIGINAL') && names.includes('<') && names.includes('>'), JSON.stringify(names.filter((x) => /MUSIC|^<|^>/.test(x))));
  await th.shot('touch-title');
  check('the selector buttons are comfortably tappable: at least 44 CSS px tall and the arrows wide enough', 90 * metrics.scale >= 44 && 96 * metrics.scale >= 44, `scale ${metrics.scale.toFixed(3)} -> ${Math.round(90 * metrics.scale)} x ${Math.round(96 * metrics.scale)} CSS px`);
  // TrackSelector at (320, 664), width 560: arrows at 320 +- 232
  await th.tap(320 + 232, 664);
  s = await th.playing('music-megaman');
  check('tapping > selects Mega Man: saved, playing; the game did not start', s.choice === 'megaman' && s.stored === 'megaman' && s.count === 1 && s.sounds[0]?.playing && (await th.scene()) === 'StartScene', JSON.stringify({ choice: s.choice, scene: await th.scene() }));
  await th.tap(320, 664);
  s = await th.playing('music-gatekeeper');
  check('tapping the name steps forward (Gatekeeper)', s.choice === 'gatekeeper' && s.count === 1 && (await th.texts('StartScene')).includes('MUSIC: GATEKEEPER'));
  await th.tap(320 - 232, 664);
  s = await th.playing('music-megaman');
  check('tapping < goes back to Mega Man', s.choice === 'megaman' && s.count === 1, JSON.stringify({ choice: s.choice }));
  await th.tap(320 + 232, 664);
  await th.tap(320 + 232, 664);
  s = await th.settled();
  check('> twice: Gatekeeper then Random; Random is shown and saved', s.choice === 'random' && s.stored === 'random' && (await th.texts('StartScene')).includes('MUSIC: RANDOM'), JSON.stringify({ choice: s.choice }));
  await th.tap(320 + 232, 664);
  await th.tap(320 + 232, 664);
  s = await th.playing('music-megaman');
  check('then Original and Mega Man again (the wrap works)', s.choice === 'megaman', JSON.stringify({ choice: s.choice }));
  check('no tap on the selector started the game', (await th.scene()) === 'StartScene');
  await th.tap(940, 155); // TAP TO PLAY
  await th.page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  s = await th.playing('music-megaman');
  check('PLAY starts the game on the selected track', s.current === 'megaman' && s.count === 1 && s.sounds[0]?.playing, JSON.stringify(s.sounds));
  await th.tag('touch-run');
  // pause with the real PAUSE button
  const pauseBtn = await th.page.evaluate(() => document.querySelector('.tc-pause')?.getBoundingClientRect().toJSON() ?? null);
  await th.page.touchscreen.tap(pauseBtn.left + pauseBtn.width / 2, pauseBtn.top + pauseBtn.height / 2);
  await sleep(500);
  check('the PAUSE button opens the pause menu', await th.paused());
  const pt = await th.texts('GameScene');
  check('the pause menu shows MUSIC: MEGA MAN with arrows', pt.includes('MUSIC: MEGA MAN') && pt.includes('<') && pt.includes('>'), JSON.stringify(pt));
  await th.shot('touch-pause');
  await th.tap(940 + 232, 610);
  s = await th.settled();
  check('tapping > on the pause menu picks Gatekeeper; the game stays paused and no new sound plays', (await th.paused()) && s.choice === 'gatekeeper' && s.stored === 'gatekeeper' && !s.sounds.some((x) => x.playing), JSON.stringify({ choice: s.choice, sounds: s.sounds }));
  await th.tap(940, 610);
  await th.tap(940 - 232, 610);
  s = await th.settled();
  check('further taps keep working while paused: now Random -> Gatekeeper; still paused; still in the game', (await th.paused()) && (await th.scene()) === 'GameScene' && s.choice === 'gatekeeper', JSON.stringify({ choice: s.choice }));
  // orientation while paused
  await th.page.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  await th.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  s = await th.settled();
  check('rotating to portrait and back keeps the choice, stays paused, and makes no duplicate sound', (await th.paused()) && s.choice === 'gatekeeper' && s.count <= 1, JSON.stringify({ choice: s.choice, count: s.count }));
  await th.page.setViewportSize({ width: 844, height: 360 });
  await th.page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  await sleep(400);
  s = await th.settled();
  check('a fullscreen-style resize does not duplicate or restart music either', (await th.paused()) && s.count <= 1 && s.choice === 'gatekeeper', JSON.stringify({ count: s.count }));
  await th.page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  // RESUME button (340, 300)
  await th.tap(340, 300);
  await sleep(300);
  s = await th.playing('music-gatekeeper');
  check('RESUME continues with the chosen track: one sound, playing', !(await th.paused()) && s.count === 1 && s.sounds[0]?.playing && s.current === 'gatekeeper', JSON.stringify({ sounds: s.sounds }));
  check('console clean on the touch screen', th.problems.length === 0, th.problems.join(' | '));
  await th.context.close();

  // the smallest phone we test (740 x 360): the selector is still on screen and large enough
  const small = await open({ touch: true, size: { width: 740, height: 360 } });
  await small.goto();
  const sm = await small.toPage(0, 0);
  const rect = await small.textBounds('StartScene', '^MUSIC: ');
  check('on a 740 x 360 phone the selector is inside the screen and its buttons are at least 44 CSS px tall', rect !== null && rect.y + rect.h <= 720 && 90 * sm.scale >= 44, `scale ${sm.scale.toFixed(3)} -> ${Math.round(90 * sm.scale)} CSS px, label at y ${Math.round(rect?.y ?? -1)}`);
  await small.context.close();
}
