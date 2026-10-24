// Focused production-browser replay. Run `npm run build` first; no full browser suite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import * as engine from '../dist/node/index.js';
import { generateBotReplay } from '../server/testing/bot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BOSS_INTEGRATION_PORT ?? 4418);
const base = `http://127.0.0.1:${port}`;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = generateBotReplay(engine, { seed: 54321, bossFight: true });
assert.equal(engine.verifyReplay(run.replay).valid, true);
const assets = fs.readdirSync(path.join(root, 'dist/assets')).filter(p => p.endsWith('.js'))
  .map(p => fs.readFileSync(path.join(root, 'dist/assets', p), 'utf8')).join('');
for (const trial of ['RESET BOSS TRIAL', 'ENGAGE NOW', 'bosstrial', 'bosscore']) assert(!assets.includes(trial), trial);
assert(assets.includes('MOTHERSHIP DESTROYED!'));
console.log('PASS production contains the encounter and excludes all trial controls');
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', windowsHide: true });
let browser;
try {
  for (let i = 0; ; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    if (i >= 100) throw new Error('Preview did not start');
    await sleep(100);
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('BROWSER', m.text()); });
  await page.addInitScript(() => localStorage.setItem('asteroids.musicTrack', 'original'));
  // Both trial URL flags must be inert in the actual production build.
  await page.goto(`${base}/?debug&verified=1&seed=54321&bosstrial=1&bosscore=1`);
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  await page.keyboard.press('Shift');
  await page.evaluate(replay => {
    window.__bossReplay = replay;
    const scene = window.__game.scene.getScene('GameScene');
    const freeze = () => { scene.paused = true; scene.events.off('postupdate', freeze); };
    scene.events.on('postupdate', freeze);
    window.__game.scene.getScene('StartScene').scene.start('GameScene');
  }, run.replay);
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').paused);
  assert.equal((await snapshot(page)).started, false);
  await advance(page, 3599);
  assert.equal((await snapshot(page)).started, false);
  await advance(page, 3600);
  let s = await snapshot(page);
  assert.equal(s.started, true);
  assert.equal(s.age, 0);
  assert.equal(s.bar, false);
  assert.equal(s.hazards, 0);
  assert(!s.trialControls);
  await page.waitForFunction(() => window.__game.cache.audio.exists('music-gatekeeper'), null, { timeout: 30000 });
  await advance(page, 3649);
  s = await snapshot(page);
  assert.equal(s.alarms.length, 1);
  assert.equal(s.gain, 0);
  await page.evaluate(() => window.__game.events.emit('hidden'));
  const frozenAge = (await snapshot(page)).age;
  await sleep(200);
  s = await snapshot(page);
  assert.equal(s.age, frozenAge);
  assert(s.alarms[0].paused);
  await page.evaluate(() => window.__game.events.emit('visible'));
  console.log('PASS 60s natural trigger, deterministic hazard clearing, original music fade and paused alarm');
  await advance(page, 4248);
  s = await snapshot(page);
  assert(Math.abs(s.alarms[0].gain - 0.22) < 0.001);
  assert.equal(s.track, 'original');
  assert.equal(s.bar, false);
  await advance(page, 4260);
  await page.waitForFunction(() => window.__game.registry.get('audio').musicSound?.key === 'music-gatekeeper');
  await sleep(120); // Existing music-source cleanup finishes after the handoff.
  s = await snapshot(page, true);
  assert.equal(s.phase, 'fighting');
  assert(Math.abs(s.age - 11) < 1e-8);
  assert(Math.abs(s.y - (-120 + 355 * (1 - (1 - 9.9 / 12.9) ** 3))) < 1e-8);
  assert.equal(s.alarms.length, 0);
  assert.equal(s.musicCount, 1);
  assert.equal(s.track, 'gatekeeper');
  assert.equal(s.bar, true);
  console.log('PASS 10.6–11s alarm fade, exact 11s combat/music/bar handoff and unchanged placement');
  await advance(page, run.encounter.victoryTick - 1);
  const beforeBonus = (await snapshot(page)).score;
  await advance(page, run.encounter.victoryTick);
  await sleep(120);
  s = await snapshot(page);
  assert.equal(s.score, beforeBonus + 2000);
  assert.equal(s.track, 'original');
  assert.equal(s.bar, false);
  assert.equal(s.musicCount, 1);
  await advance(page, run.encounter.victoryTick + 200);
  assert.equal((await snapshot(page)).ordinary, true);
  await advance(page, run.ticks);
  s = await snapshot(page);
  assert.equal(s.score, run.score);
  assert.equal(s.gameOver, true);
  assert.equal(s.projectiles, 0);
  assert.equal(s.bar, false);
  const browserReplay = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getReplay());
  const verified = engine.verifyReplay(browserReplay);
  assert.equal(verified.valid, true, verified.error);
  assert.equal(verified.calculatedScore, 13064);
  assert.equal(verified.totalTicks, run.ticks);
  console.log(`PASS browser recording independently verified: ${verified.calculatedScore} points, ${verified.totalTicks} ticks, one bonus, ordinary continuation and game over`);
  await page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'));
  assert.equal(await page.evaluate(() => window.__game.sound.sounds.filter(s => !s.pendingRemove && s.key === 'boss_alarm').length), 0);
  await page.evaluate(() => window.__game.scene.getScene('StartScene').scene.start('GameScene'));
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene'));
  assert.equal((await snapshot(page)).started, false);
  assert.equal((await snapshot(page)).score, 0);
  assert.deepEqual(errors, []);
  console.log('PASS menu/restart cleanup, fresh encounter state, and no browser runtime errors');
} finally {
  await browser?.close();
  server.kill();
}

async function advance(page, target) {
  await page.evaluate(target => {
    const scene = window.__game.scene.getScene('GameScene');
    const replay = window.__bossReplay;
    let inputIndex = window.__bossInputIndex ?? 0;
    // Replay on the production browser simulation and recorder without rendering thousands
    // of artificial frames or creating thousands of short-lived cannon sounds in one task.
    while (scene.replayRecorder.ticks < target) {
      const tick = scene.replayRecorder.ticks;
      if (scene.replayRecorder.isFinalized) throw new Error(`Run ended at ${tick}, before ${target}`);
      while (replay.inputs[inputIndex + 1]?.tick <= tick) inputIndex++;
      const input = replay.inputs[inputIndex].input;
      scene.replayRecorder.recordTick(tick, input);
      scene.sim.step(1 / 60, input);
      if (scene.sim.isGameOver) scene.replayRecorder.markGameOver(scene.sim);
    }
    window.__bossInputIndex = inputIndex;
    scene.paused = false;
    window.__game.registry.get('audio').music.setGamePaused(false);
    scene.events.emit('postupdate');
    // Keep real animation frames from advancing beyond each precisely chosen checkpoint.
    scene.paused = true;
    scene.events.emit('postupdate');
  }, target);
}

async function snapshot(page, show = false) {
  return page.evaluate(show => {
    const game = window.__game;
    const scene = game.scene.getScene('GameScene');
    if (show) { scene.paused = false; scene.events.emit('postupdate'); }
    const sim = scene.sim;
    const audio = game.registry.get('audio');
    const sounds = game.sound.sounds.filter(s => !s.pendingRemove);
    const result = { started: sim.encounterStarted, age: sim.boss.age, phase: sim.boss.phase, y: sim.boss.position.y,
      ordinary: sim.ordinaryPlay, gameOver: sim.isGameOver, score: sim.totalScore, projectiles: sim.bossProjectiles.size,
      hazards: sim.asteroids.length + sim.ufos.length + sim.ufoShots.length,
      track: audio.currentTrack, gain: audio.music.gain, loading: audio.musicLoading, cache: game.cache.audio.exists('music-gatekeeper'),
      musicCount: sounds.filter(s => s.key.startsWith('music')).length,
      alarms: sounds.filter(s => s.key === 'boss_alarm').map(s => ({ paused: s.isPaused, gain: s.currentConfig.volume })),
      bar: scene.children.list.some(c => c.visible && c.text === 'MOTHERSHIP — THE DREADNAUGHT'),
      trialControls: scene.children.list.some(c => /RESET BOSS TRIAL|ENGAGE NOW/.test(c.text ?? '')) };
    if (show) { scene.paused = true; scene.events.emit('postupdate'); }
    return result;
  }, show);
}
