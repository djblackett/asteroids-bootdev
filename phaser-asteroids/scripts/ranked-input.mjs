// Focused release-blocker checks. Real local Worker/D1 + production browser build; no legacy browser sweep.
import { clickItem, itemPoint, makeChecker, menuItems, openTitle, requireBuild, sceneTexts, sleep, startGameAndBrowser, WorkerStack } from './lib/rankedStack.mjs';
import { settleTitleInput } from './lib/menuWaits.mjs';

const PORT = 4416;
const worker = new WorkerStack({ port: 8796, gamePort: PORT, vars: { RANKED_TIME_LIMIT_SECONDS: '5' } });
const { check, state } = makeChecker();
requireBuild();
const migration = worker.migrate();
if (!migration.ok) throw new Error(migration.output);
let game;
try {
  await worker.start();
  game = await startGameAndBrowser(PORT);
  const { browser, GAME } = game;
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      localStorage.setItem('asteroids.inputMode', 'desktop');
      localStorage.setItem('asteroids.touchMovement', 'pointToFly');
      window.testPad = null;
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad, null, null, null] });
    });
    const page = await openTitle(ctx, GAME, { api: worker.API });
    let requests = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/runs')) requests++; });
    return { ctx, page, requests: () => requests };
  };
  const tap = async (page, id) => {
    const p = await itemPoint(page, id);
    await page.touchscreen.tap(p.x, p.y);
    await settleTitleInput(page);
  };
  const playing = (page) => page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
  const storedOff = (page) => page.evaluate(() => localStorage.getItem('asteroids.inputMode') === 'desktop' && localStorage.getItem('asteroids.touchMovement') === 'pointToFly');
  const putPad = (page) => page.evaluate(() => {
    window.testPad = { index: 0, id: 'Test standard controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  });
  const joinPad = async (page) => {
    await page.evaluate(() => { window.testPad.buttons[0] = { pressed: true, value: 1 }; });
    await sleep(150);
    await page.evaluate(() => { window.testPad.buttons[0] = { pressed: false, value: 0 }; });
    await sleep(350);
  };
  const recovery = async (page) => (await sceneTexts(page, 'StartScene')).includes('TOUCH GAMEPLAY CONTROLS ARE OFF.');

  {
    const { ctx, page, requests } = await phone();
    await tap(page, 'ranked');
    check('touch-off phone: Ranked remains touch navigable and explains missing controls', await recovery(page));
    await tap(page, 'start');
    check('a finger cannot start the keyboard-only action or issue a challenge', requests() === 0 && await page.evaluate(() => window.__game.scene.isActive('StartScene')));
    check('blocked start preserves saved input and movement preferences', await storedOff(page));
    const snap = await menuItems(page);
    const scale = await page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width / 1280);
    check('recovery actions are at least 44 CSS pixels tall and stay on screen', snap.items.every((i) => i.h * scale >= 44 && i.y >= 0 && i.y + i.h <= 720));
    await page.screenshot({ path: 'scripts/.smoke-output/ranked-input-recovery.png' });
    await tap(page, 'back');
    check('BACK returns to the menu without a challenge', (await menuItems(page)).page === 'title' && requests() === 0);
    await tap(page, 'ranked');
    await tap(page, 'touch-on');
    check('explicit touch recovery restores ranked start, without starting automatically', !(await recovery(page)) && requests() === 0);
    check('explicit recovery saves touch ON and keeps the movement preference', await page.evaluate(() => localStorage.getItem('asteroids.inputMode') === 'touch' && localStorage.getItem('asteroids.touchMovement') === 'pointToFly'));
    await tap(page, 'start');
    await playing(page);
    check('recovered ranked run has usable on-screen gameplay controls', await page.evaluate(() => document.querySelector('.tc-root').classList.contains('tc-play')));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await tap(page, 'ranked');
    await page.keyboard.press('Enter');
    await playing(page);
    check('mobile physical keyboard can start ranked with touch OFF', requests() === 1 && await storedOff(page));
    await page.keyboard.down('KeyD');
    await sleep(200);
    await page.keyboard.up('KeyD');
    check('keyboard run advances with touch controls OFF', await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks() > 0));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await putPad(page);
    await sleep(200);
    await tap(page, 'ranked');
    check('detected but unassigned controller does not bypass safeguard', await recovery(page) && requests() === 0);
    await joinPad(page);
    check('joining assigns a usable solo controller and restores START', !(await recovery(page)));
    await tap(page, 'start');
    await playing(page);
    check('mobile assigned gamepad starts ranked without changing touch OFF', requests() === 1 && await storedOff(page));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await page.evaluate(() => window.__game.scene.getScene('StartScene').scene.restart({ rankedAgain: true }));
    await sleep(500);
    check('PLAY AGAIN auto-request is guarded before challenge issuance', await recovery(page) && requests() === 0);
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await putPad(page);
    await sleep(200);
    await joinPad(page);
    await tap(page, 'ranked');
    await page.route(`${worker.API}/api/v1/runs`, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"unavailable","message":"Test outage"}}' }) : route.continue());
    await tap(page, 'start');
    await page.waitForFunction(() => window.__game.scene.getScene('StartScene').menuSnapshot().items.some((i) => i.id === 'play-normally'));
    check('service failure offers TRY AGAIN and PLAY NORMALLY with usable input', (await menuItems(page)).items.some((i) => i.id === 'start'));
    await page.evaluate(() => { window.testPad = null; });
    await sleep(350);
    check('disconnect on error page guards both retry and casual fallback', await recovery(page) && !(await menuItems(page)).items.some((i) => i.id === 'play-normally'));
    await tap(page, 'start');
    check('blocked retry does not issue another challenge', requests() === 1 && await storedOff(page));
    await tap(page, 'back');
    check('error recovery preserves touch navigation back to menu', (await menuItems(page)).page === 'title');
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await putPad(page);
    await sleep(200);
    await joinPad(page);
    await tap(page, 'ranked');
    let release;
    const held = new Promise((r) => { release = r; });
    let received;
    const responseReady = new Promise((r) => { received = r; });
    await page.route(`${worker.API}/api/v1/runs`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    });
    await tap(page, 'start');
    await responseReady;
    await page.evaluate(() => { window.testPad = null; });
    await sleep(200);
    release();
    await page.waitForFunction(() => window.__ASTEROIDS_RANKED__?.phase === 'idle');
    check('controller lost during challenge request prevents gameplay on response', requests() === 1 && await recovery(page) && await page.evaluate(() => window.__game.scene.isActive('StartScene')));
    check('discarded challenge is not left ready for a later casual run', await page.evaluate(() => window.__ASTEROIDS_RANKED__.runId === null));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await openTitle(ctx, GAME, { api: worker.API });
    await clickItem(page, 'ranked');
    check('desktop ranked start remains available without a detected gamepad', !(await recovery(page)));
    await clickItem(page, 'start');
    await playing(page);
    check('desktop pointer start enters ranked gameplay', true);
    await ctx.close();
  }
} finally {
  await game?.close();
  worker.cleanup();
}
console.log(`\n${state.total - state.failures}/${state.total} focused ranked input checks passed`);
process.exit(state.failures ? 1 : 0);
