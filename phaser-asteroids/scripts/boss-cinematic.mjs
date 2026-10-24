// Focused DEV-only integration checks with real Web Audio. No full browser suite.
// node scripts/boss-cinematic.mjs [--timing-only]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts/.smoke-output');
fs.mkdirSync(out, { recursive: true });
const port = Number(process.env.BOSS_PORT ?? 4417);
const base = `http://127.0.0.1:${port}`;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
try {
  for (let i = 0; ; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    if (i > 100) throw new Error('Vite did not start');
    await sleep(100);
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); console.log('BROWSER ERROR', String(e)); });
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('BROWSER', m.text()); });
  await page.addInitScript(() => localStorage.setItem('asteroids.musicTrack', 'random'));
  await open(page, '', true);
  const regular = (await snapshot(page)).track;
  await page.waitForFunction(() => window.__game.sound.sounds.some(s => s.key === 'boss_alarm' && s.isPlaying));
  await page.waitForFunction(() => window.__game.cache.audio.exists('music-gatekeeper'));
  let s = await snapshot(page);
  assert.equal(s.alarms.length, 1);
  assert.equal(s.gain, 0);
  assert(s.cachedGatekeeper);
  pass('one alarm, regular music faded, Gatekeeper prepared during entrance');
  await page.keyboard.press('p');
  await sleep(150);
  s = await snapshot(page);
  const frozenAge = s.age;
  assert(s.alarms[0].paused);
  await sleep(350);
  assert.equal((await snapshot(page)).age, frozenAge);
  pass('pause freezes entrance and the real alarm voice');
  await page.evaluate(() => window.__game.registry.get('audio').sfx.setVolume(0.2));
  assert(Math.abs((await snapshot(page)).alarms[0].configured - 0.11) < 0.001);
  // Keep the entrance paused during settings checks so slow browser commands cannot consume the shorter intro.
  await page.evaluate(() => window.__game.registry.get('audio').sfx.setVolume(0));
  assert.equal((await snapshot(page)).alarms[0].configured, 0);
  await page.evaluate(() => window.__game.registry.get('audio').sfx.setVolume(0.8));
  // Chromium can defer AudioParam.value while every source is paused; resumption must apply the requested gain.
  await page.keyboard.press('p');
  await page.waitForFunction(() => Math.abs(window.__game.sound.sounds.find(s => s.key === 'boss_alarm').volume - 0.44) < 0.001);
  pass('live alarm volume and mute changes reach the existing sound');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.age >= 8);
  await page.screenshot({ path: path.join(out, 'boss-arrival.png') });
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.phase === 'fighting', null, { timeout: 25000 });
  await page.waitForFunction(() => window.__game.registry.get('audio').musicSound?.key === 'music-gatekeeper');
  await sleep(120);
  s = await snapshot(page);
  assert.equal(s.alarms.length, 0);
  assert.equal(s.musicCount, 1);
  assert.equal(s.stored, 'random');
  assert.equal(s.choice, 'random');
  const samples = await page.evaluate(() => window.__arrivalSamples);
  const fading = samples.filter(s => s.phase === 'entering');
  assert(fading.some(s => s.volume > 0.4), JSON.stringify(samples));
  assert(fading.some(s => s.volume > 0.15 && s.volume < 0.3));
  assert(fading.some(s => s.volume > 0 && s.volume < 0.1));
  for (const sample of fading) {
    const expected = 0.44 * Math.min(1, Math.max(0, (11 - sample.age) / 0.4));
    // AudioParam readback trails scheduled gain by an audio render quantum.
    assert(Math.abs(sample.configured - expected) < 0.001, JSON.stringify({ sample, expected }));
    assert.equal(sample.bar, false);
  }
  const settled = samples.at(-1);
  assert(settled.age >= 11 - 1e-9 && settled.age < 11.1);
  assert(Math.abs(settled.y - (-120 + 355 * (1 - (1 - (settled.age - 1.1) / 12.9) ** 3))) < 1e-8);
  assert.equal(settled.volume, 0);
  assert.equal(settled.track, 'gatekeeper');
  assert.equal(settled.bar, true);
  pass('0.4s alarm fade ends at 11s on the unchanged descent with Gatekeeper, health bar, one music instance and unchanged preferences');
  if (!process.argv.includes('--timing-only')) {
  await sleep(850);
  await page.screenshot({ path: path.join(out, 'boss-combat.png') });
  await defeat(page);
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.deathTime >= 1.1);
  await page.screenshot({ path: path.join(out, 'boss-internal-failure.png') });
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.deathTime >= 2.8);
  await page.screenshot({ path: path.join(out, 'boss-detonation.png') });
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.phase === 'destroyed');
  await sleep(100);
  s = await snapshot(page);
  assert.equal(s.score, 2000);
  assert.equal(s.track, regular);
  assert.equal(s.stored, 'random');
  assert.equal(s.musicCount, 1);
  await page.screenshot({ path: path.join(out, 'boss-victory.png') });
  pass('staged detonation awards 2000 once and restores this run’s Random pick');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.ordinaryPlay);
  await sleep(1800);
  s = await snapshot(page);
  assert.equal(s.score, 2000);
  assert(s.spawnTimer > 0);
  assert(!s.texts.some(t => t.includes('MOTHERSHIP') || t.includes('WARNING')));
  assert.equal(s.camera, 0);
  await page.screenshot({ path: path.join(out, 'boss-ordinary-play.png') });
  pass('same run resumes ordinary spawning, clear UI/lighting and unchanged bonus');

  // Reset via the trial's actual reset control, then repeat several times during the alarm.
  const baseline = s.objects;
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const scene = window.__game.scene.getScene('GameScene');
      window.__priorTrial = scene.sim;
      scene.children.list.find(c => c.text === 'RESET BOSS TRIAL').emit('pointerdown');
    });
    // Restart is queued until the next frame: the previous entrance's alarm is not evidence of the new run.
    await page.waitForFunction(() => {
      const sim = window.__game.scene.getScene('GameScene').sim;
      return sim !== window.__priorTrial && sim?.boss && window.__game.sound.sounds.some(s => s.key === 'boss_alarm' && s.isPlaying);
    });
    s = await snapshot(page);
    assert.equal(s.alarms.length, 1);
    assert.equal(s.objects, baseline);
    assert(s.musicCount <= 1);
  }
  pass('three real trial resets leave one alarm and a stable graphics/UI count');
  await page.evaluate(() => window.__game.events.emit('hidden'));
  await sleep(100);
  s = await snapshot(page);
  assert(s.alarms[0].paused);
  assert(s.paused);
  await page.evaluate(() => window.__game.events.emit('visible'));
  await sleep(100);
  assert((await snapshot(page)).alarms[0].paused);
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.age >= 5.1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.phase === 'fighting');
  assert.equal((await snapshot(page)).alarms.length, 0);
  pass('visibility pauses without auto-resume; optional Engage shortcut cleans up alarm');
  await page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
  await sleep(200);
  s = await snapshot(page);
  assert.equal(s.alarms.length, 0);
  assert.equal(s.musicCount, 1);
  assert(s.gain > 0);
  pass('scene exit restores normal audio and cleans up all alarm voices');

  // A real failed download must not stall combat or victory.
  const failPage = await browser.newPage();
  failPage.on('pageerror', e => errors.push(String(e)));
  await failPage.addInitScript(() => localStorage.setItem('asteroids.musicTrack', 'original'));
  await failPage.route('**/gatekeeper.mp3', route => route.abort());
  await open(failPage, '&bosscore=1');
  await failPage.waitForFunction(() => window.__game.registry.get('audio').musicSound?.key === 'music');
  assert.equal((await snapshot(failPage)).phase, 'fighting');
  await defeat(failPage);
  await failPage.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.ordinaryPlay);
  assert.equal((await snapshot(failPage)).score, 2000);
  pass('Gatekeeper download failure keeps encounter and victory working');
  await failPage.close();

  const racePage = await browser.newPage();
  racePage.on('pageerror', e => errors.push(String(e)));
  await racePage.addInitScript(() => { localStorage.setItem('asteroids.musicTrack', 'original'); localStorage.setItem('asteroids.sfxVolume', '0'); });
  let releaseDownload;
  let requests = 0;
  const pendingDownload = new Promise(resolve => { releaseDownload = resolve; });
  await racePage.route('**/gatekeeper.mp3', async route => {
    requests++;
    await pendingDownload;
    await route.fulfill({ contentType: 'audio/mpeg', body: fs.readFileSync(path.join(root, 'public/audio/music/gatekeeper.mp3')) }).catch(() => {});
  });
  await open(racePage);
  await racePage.evaluate(() => {
    const sim = window.__game.scene.getScene('GameScene').sim;
    sim.boss.age = 5;
    sim.skipEntrance();
  });
  await racePage.waitForFunction(() => window.__game.registry.get('audio').currentTrack === 'gatekeeper' && window.__game.registry.get('audio').musicLoading);
  assert(requests >= 1);
  await racePage.evaluate(() => window.__game.scene.getScene('GameScene').children.list.find(c => c.text === 'RESET BOSS TRIAL').emit('pointerdown'));
  await racePage.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss?.phase === 'warning');
  releaseDownload();
  await sleep(350);
  s = await snapshot(racePage);
  assert.equal(s.track, 'original');
  assert(s.musicCount <= 1);
  assert.equal(s.alarms.length, 0);
  await racePage.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
  await sleep(200);
  assert.equal((await snapshot(racePage)).track, 'original');
  pass('reset/scene exit during a pending Gatekeeper load cannot resurrect the override or alarm');
  await racePage.close();

  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  mobile.on('pageerror', e => errors.push(String(e)));
  await mobile.addInitScript(() => { localStorage.setItem('asteroids.musicTrack', 'gatekeeper'); localStorage.setItem('asteroids.sfxVolume', '0'); });
  await open(mobile, '&bosscore=1&touch=1');
  await sleep(900);
  s = await snapshot(mobile);
  assert.equal(s.alarms.length, 0);
  assert.equal(s.musicCount, 1);
  assert.equal(s.camera, 0);
  await mobile.screenshot({ path: path.join(out, 'boss-mobile-reduced-motion.png') });
  await defeat(mobile);
  await mobile.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.detonated);
  assert.equal((await snapshot(mobile)).camera, 0);
  pass('mobile/core shortcut, muted SFX, already-selected Gatekeeper and reduced motion');
  await mobile.close();
  const normal = await browser.newPage();
  normal.on('pageerror', e => errors.push(String(e)));
  await normal.goto(`${base}/?debug`);
  await normal.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  assert.equal(await normal.evaluate(() => window.__game.cache.audio.exists('boss_alarm')), false);
  await normal.goto(`${base}/?debug&bosstrial=1&verified=1`);
  await normal.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  await normal.keyboard.press('Shift');
  await normal.evaluate(() => window.__game.scene.getScene('StartScene').scene.start('GameScene'));
  await normal.waitForFunction(() => window.__game.scene.isActive('GameScene'));
  assert.equal(await normal.evaluate(() => Boolean(window.__game.scene.getScene('GameScene').sim.boss)), false);
  pass('ordinary boot skips alarm loading; recorded play excludes the boss even with the trial URL');
  }
  assert.deepEqual(errors, []);
  pass('no browser runtime errors');
} finally {
  await browser?.close();
  server.kill();
}
console.log(`${checks} focused browser checks passed; screenshots: ${out}`);

async function open(page, extra = '', observeArrival = false) {
  await page.goto(`${base}/?debug&bosstrial=1${extra}`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  // A genuine gesture unlocks Web Audio; scene entry is direct to keep this test scoped to the boss.
  await page.keyboard.press('Shift');
  await page.evaluate(observeArrival => {
    const scene = window.__game.scene.getScene('GameScene');
    const freezeOnInstall = () => {
      if (!scene.sim?.boss) return;
      scene.paused = true;
      scene.events.off('postupdate', freezeOnInstall);
      if (observeArrival) {
        window.__arrivalSamples = [];
        const sample = () => {
          const b = scene.sim.boss;
          if (b.age < 10.5) return;
          const alarm = window.__game.sound.sounds.find(s => s.key === 'boss_alarm' && !s.pendingRemove);
          window.__arrivalSamples.push({ age: b.age, y: b.position.y, phase: b.phase, volume: alarm?.volume ?? 0,
            configured: alarm?.currentConfig.volume ?? 0,
            track: window.__game.registry.get('audio').currentTrack,
            bar: scene.children.list.some(c => c.visible && c.text === 'MOTHERSHIP — THE DREADNAUGHT') });
          if (b.phase === 'fighting') scene.events.off('postupdate', sample);
        };
        scene.events.on('postupdate', sample);
      }
    };
    scene.events.on('postupdate', freezeOnInstall);
    window.__game.scene.getScene('StartScene').scene.start('GameScene');
  }, observeArrival);
  await page.waitForFunction(() => window.__game?.scene.getScene('GameScene').sim?.boss);
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').paused);
  await page.keyboard.press('p');
}

async function snapshot(page) {
  return page.evaluate(() => {
    const game = window.__game;
    const scene = game.scene.getScene('GameScene');
    const a = game.registry.get('audio');
    const sounds = game.sound.sounds.filter(s => !s.pendingRemove);
    return { age: scene.sim.boss.age, phase: scene.sim.boss.phase, paused: scene.paused, score: scene.sim.totalScore,
      spawnTimer: scene.sim.spawner.spawnTimer, choice: a.music.choice, track: a.currentTrack, gain: a.music.gain,
      stored: localStorage.getItem('asteroids.musicTrack'), musicCount: sounds.filter(s => s.key.startsWith('music')).length,
      alarms: sounds.filter(s => s.key === 'boss_alarm').map(s => ({ paused: s.isPaused, volume: s.volume, configured: s.currentConfig.volume })),
      cachedGatekeeper: game.cache.audio.exists('music-gatekeeper'), objects: scene.children.list.length,
      locked: game.sound.locked, context: game.sound.context.state,
      camera: Math.abs(scene.cameras.main?.scrollX ?? 0), texts: scene.children.list.filter(c => c.visible && c.text).map(c => c.text) };
  });
}

async function defeat(page) {
  await page.evaluate(() => {
    const sim = window.__game.scene.getScene('GameScene').sim;
    // Exercise actual weapon collisions and the existing scoring path, without a long manual fight.
    for (const section of sim.boss.sections) {
      for (let i = 0; i < section.hp; i++) sim.shots.push({ position: { ...section.position }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    }
  });
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').sim.boss.phase === 'dying');
}
