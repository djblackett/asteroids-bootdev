// Local production-build checks; no leaderboard or database writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startGameAndBrowser, openTitle, clickItem, sceneTexts, sleep } from './lib/rankedStack.mjs';

const game = await startGameAndBrowser(4427);
fs.mkdirSync('scripts/.smoke-output', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const ctx = await game.browser.newContext({ viewport: mobile ? { width: 667, height: 375 } : { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile });
    const page = await openTitle(ctx, game.GAME);
    const mode = () => page.evaluate(() => window.__game.scene.getScene('StartScene').setup.mode);
    assert.equal(await mode(), 'classic');
    await page.screenshot({ path: `scripts/.smoke-output/modes-${mobile ? 'mobile' : 'desktop'}.png` });
    // Mouse/touch on the Invasion segment, then real keyboard adjustment on that same control.
    const canvas = await page.locator('canvas').boundingBox();
    const select = async x => {
      const p = { x: canvas.x + x / 1280 * canvas.width, y: canvas.y + 527 / 720 * canvas.height };
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await sleep(300);
    };
    await select(940);
    assert.equal(await mode(), 'invasion');
    if (!mobile) {
      await page.keyboard.press('ArrowLeft'); await sleep(100);
      assert.equal(await mode(), 'classic');
      await page.keyboard.press('ArrowRight'); await sleep(100);
      assert.equal(await mode(), 'invasion');
    }
    // A ranked request must stop visibly, with no challenge request and no silent practice start.
    let challenges = 0;
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/runs')) challenges++; });
    await clickItem(page, mobile ? 'play' : 'ranked');
    assert((await sceneTexts(page, 'StartScene')).includes('RANKED INVASION IS NOT AVAILABLE YET.'));
    assert.equal(challenges, 0);
    assert(await page.evaluate(() => window.__game.scene.isActive('StartScene')));
    await clickItem(page, 'back');
    await clickItem(page, mobile ? 'practice' : 'play');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene'));
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('GameScene').sim.gameMode), 'invasion');
    // Stop the real loop, then advance the same live sim deterministically for a short visual check.
    const atArrival = await page.evaluate(() => {
      const s = window.__game.scene.getScene('GameScene'); s.paused = true;
      const sim = s.sim;
      sim.player.isRespawning = true; sim.player.respawnTimer = 1000;
      while (!sim.encounterStarted) sim.step(1 / 60);
      for (let i = 0; i < 540; i++) sim.step(1 / 60);
      return { phase: sim.boss.phase, age: sim.boss.age, y: sim.boss.position.y };
    });
    assert.equal(atArrival.phase, 'fighting');
    assert(Math.abs(atArrival.age - 9) < 1e-8);
    assert(atArrival.y > 210 && atArrival.y < 220);
    await page.evaluate(() => { window.__game.scene.getScene('GameScene').paused = false; });
    await sleep(100);
    await page.screenshot({ path: `scripts/.smoke-output/modes-boss-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.evaluate(() => {
      const s = window.__game.scene.getScene('GameScene'); s.paused = true;
      s.scene.restart();
    });
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('GameScene').sim.gameMode), 'invasion');
    await page.evaluate(() => window.__game.scene.getScene('GameScene').scene.start('StartScene'));
    await sleep(350);
    assert.equal(await mode(), 'invasion');
    await select(340);
    assert.equal(await mode(), 'classic');
    await clickItem(page, 'ranked');
    assert(!(await sceneTexts(page, 'StartScene')).includes('RANKED INVASION IS NOT AVAILABLE YET.'));
    await clickItem(page, 'back');
    await clickItem(page, 'powerups');
    const guideBottom = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('StartScene');
      const bounds = [];
      const walk = list => list.forEach(o => {
        if (!o.visible) return;
        if (o.type === 'Container') walk(o.list);
        else if (o.type === 'Text' && o.text.startsWith('Brings back')) bounds.push(o.getBounds().bottom);
      });
      walk(scene.children.list);
      return Math.max(...bounds);
    });
    assert(guideBottom < 596, 'Revive explanation must be clear of BACK');
    await page.screenshot({ path: `scripts/.smoke-output/modes-guide-${mobile ? 'mobile' : 'desktop'}.png` });
    assert.deepEqual(page.problems, []);
    await ctx.close();
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: selection, ranked refusal, practice, 9s handoff, restart and menu retention`);
  }
} finally { await game.close(); }
