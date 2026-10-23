// Focused title-entry regression checks against the production build and real local Worker/D1.
// Faults are injected at the browser network boundary; no gameplay or ranked validation is bypassed.
import fs from 'node:fs';
import { clickItem, itemPoint, makeChecker, menuItems, openTitle, requireBuild, sceneTexts, sleep, startGameAndBrowser, WorkerStack } from './lib/rankedStack.mjs';

const PORT = 4417;
const worker = new WorkerStack({ port: 8797, gamePort: PORT });
const { check, state } = makeChecker();
requireBuild();
const migration = worker.migrate();
if (!migration.ok) throw new Error(migration.output);
fs.mkdirSync('scripts/.smoke-output', { recursive: true });
let game;
try {
  await worker.start();
  game = await startGameAndBrowser(PORT);
  const { browser, GAME } = game;
  const phone = async ({ off = false, width = 844, height = 390, query = '' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((off) => {
      if (off) localStorage.setItem('asteroids.inputMode', 'desktop');
      localStorage.setItem('asteroids.touchMovement', 'pointToFly');
      window.testPad = null;
      Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad, null, null, null] });
    }, off);
    const page = await openTitle(ctx, GAME, { api: worker.API, query });
    let requests = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/runs')) requests++; });
    return { ctx, page, requests: () => requests };
  };
  const tap = async (page, id) => {
    const p = await itemPoint(page, id);
    await page.touchscreen.tap(p.x, p.y);
    await sleep(300);
  };
  const playing = (page, ranked) => page.waitForFunction((ranked) => window.__game.scene.isActive('GameScene') && !!window.__ASTEROIDS_REPLAY__?.isVerified === ranked, ranked, { timeout: 15000 });
  const recovery = async (page) => (await sceneTexts(page, 'StartScene')).includes('TOUCH GAMEPLAY CONTROLS ARE OFF.');
  const titleActive = (page) => page.evaluate(() => window.__game.scene.isActive('StartScene'));
  const prefsOff = (page) => page.evaluate(() => localStorage.getItem('asteroids.inputMode') === 'desktop' && localStorage.getItem('asteroids.touchMovement') === 'pointToFly');
  const waitError = (page) => page.waitForFunction(() => window.__game.scene.getScene('StartScene').menuSnapshot().items.some((i) => i.id === 'play-normally'));
  const outage = (page) => page.route(`${worker.API}/api/v1/runs`, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"unavailable","message":"Test outage"}}' })
    : route.continue());
  const putPad = (page, pressed = false) => page.evaluate((pressed) => {
    window.testPad = { index: 0, id: 'Test standard controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed && i === 0, value: pressed && i === 0 ? 1 : 0 })) };
  }, pressed);
  const joinPad = async (page) => { await putPad(page, true); await sleep(150); await putPad(page); await sleep(300); };

  for (const [width, height] of [[667, 375], [844, 390]]) {
    const { ctx, page, requests } = await phone({ width, height });
    const snap = await menuItems(page);
    const play = snap.items.find((i) => i.id === 'play');
    const practice = snap.items.find((i) => i.id === 'practice');
    const scores = snap.items.find((i) => i.id === 'scores');
    check(`${width}: PLAY dominates; PRACTICE and HIGH SCORES have their own row`, play.w === 560 && play.h > practice.h && scores.y === practice.y && scores.y > play.y);
    const scale = await page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width / 1280);
    check(`${width}: all targets are >=44 CSS px and fit the landscape canvas`, snap.items.every((i) => Math.min(i.w, i.h) * scale >= 44 && i.x >= 0 && i.y >= 0 && i.x + i.w <= 1280 && i.y + i.h <= 720));
    check(`${width}: no overlapping controls`, snap.items.every((a, i) => snap.items.slice(i + 1).every((b) => a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h)));
    check(`${width}: PLAY explains leaderboard entry and the standard time limit`, (await sceneTexts(page, 'StartScene')).includes('ONLINE LEADERBOARD  /  20:00 LIMIT'));
    await page.screenshot({ path: `scripts/.smoke-output/mobile-entry-${width}.png` });
    await tap(page, 'ranked');
    check(`${width}: ranked explanation remains accessible without issuing a challenge`, (await sceneTexts(page, 'StartScene')).includes('A RANKED RUN ENDS AT 20:00.') && requests() === 0);
    await tap(page, 'back');
    await tap(page, 'scores');
    check(`${width}: High Scores opens directly without starting a run`, (await menuItems(page)).page === 'scores' && requests() === 0);
    await tap(page, 'back');
    for (const id of ['audio', 'controls']) {
      await tap(page, id);
      check(`${width}: ${id} remains one tap away`, (await menuItems(page)).page === id);
      await tap(page, 'back');
    }
    await tap(page, 'play');
    await playing(page, true);
    check(`${width}: primary PLAY directly starts one ranked challenge with touch controls`, requests() === 1 && await page.evaluate(() => document.querySelector('.tc-root').classList.contains('tc-play')));
    check(`${width}: ranked run keeps the selected movement mode`, await page.evaluate(() => localStorage.getItem('asteroids.touchMovement') === 'pointToFly'));
    await ctx.close();
  }
  {
    // Even the development ?ranked override must not hijack an explicit Practice action.
    const { ctx, page, requests } = await phone({ query: 'ranked=1' });
    await tap(page, 'practice');
    await playing(page, false);
    check('PRACTICE starts the normal game without a ranked request, including with ?ranked', requests() === 0);
    await ctx.close();
  }
  for (const input of ['keyboard', 'gamepad']) {
    const { ctx, page, requests } = await phone();
    const press = async (key, button) => {
      if (input === 'keyboard') await page.keyboard.press(key);
      else {
        await page.evaluate((button) => { window.testPad.buttons[button] = { pressed: true, value: 1 }; }, button);
        await sleep(100);
        await page.evaluate((button) => { window.testPad.buttons[button] = { pressed: false, value: 0 }; }, button);
      }
      await sleep(250);
    };
    if (input === 'gamepad') { await putPad(page); await sleep(200); await joinPad(page); }
    await press('ArrowDown', 13);
    check(`mobile ${input}: Down from PLAY focuses PRACTICE`, (await menuItems(page)).focus === 'practice');
    await press('ArrowRight', 15);
    await press('Enter', 0);
    check(`mobile ${input}: Right and select opens HIGH SCORES`, (await menuItems(page)).page === 'scores' && requests() === 0);
    await press('Escape', 1);
    await press('ArrowLeft', 14);
    await press('Enter', 0);
    await playing(page, false);
    check(`mobile ${input}: selecting PRACTICE starts unranked`, requests() === 0);
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await outage(page);
    await tap(page, 'play');
    await waitError(page);
    const snap = await menuItems(page);
    check('backend failure stays on menu with a clear error, RETRY and PLAY PRACTICE INSTEAD', await titleActive(page) && (await sceneTexts(page, 'StartScene')).includes('RANKED PLAY IS TEMPORARILY UNAVAILABLE.') && snap.items.some((i) => i.label === 'RETRY') && snap.items.some((i) => i.label === 'PLAY PRACTICE INSTEAD'));
    await page.screenshot({ path: 'scripts/.smoke-output/mobile-entry-error.png' });
    await tap(page, 'start');
    await waitError(page);
    check('RETRY issues another request and never silently starts casual play', requests() === 2 && await titleActive(page));
    await tap(page, 'play-normally');
    await playing(page, false);
    check('explicit error fallback starts Practice without another challenge', requests() === 2);
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    await outage(page);
    await tap(page, 'play');
    await waitError(page);
    await page.unroute(`${worker.API}/api/v1/runs`);
    await tap(page, 'start');
    await playing(page, true);
    check('RETRY after service recovery starts the existing ranked flow', requests() === 2);
    await ctx.close();
  }
  for (const action of ['play', 'practice']) {
    const { ctx, page, requests } = await phone({ off: true });
    await page.screenshot({ path: 'scripts/.smoke-output/mobile-entry-touch-off.png' });
    check(`${action}: touch-off phone retains player-count and control recovery`, (await menuItems(page)).items.filter((i) => ['players', 'touch-on'].includes(i.id)).length === 2);
    await tap(page, action);
    check(`${action}: touch-off phone is blocked before any challenge and keeps preferences`, await recovery(page) && requests() === 0 && await prefsOff(page));
    await tap(page, 'start');
    check(`${action}: finger cannot activate keyboard-only start`, await titleActive(page) && requests() === 0);
    await tap(page, 'touch-on');
    check(`${action}: turning touch on is explicit and does not auto-start`, !(await recovery(page)) && requests() === 0 && await titleActive(page));
    await tap(page, 'start');
    await playing(page, action === 'play');
    check(`${action}: recovered start preserves the requested run type`, requests() === (action === 'play' ? 1 : 0));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone({ off: true });
    await page.keyboard.press('Space');
    await playing(page, true);
    check('mobile Space matches primary PLAY with a physical keyboard and touch off', requests() === 1 && await prefsOff(page));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone({ off: true });
    await putPad(page);
    await sleep(200);
    await tap(page, 'play');
    check('unassigned gamepad cannot bypass readiness', await recovery(page) && requests() === 0);
    await joinPad(page);
    await tap(page, 'back');
    // START must have the same meaning as the mobile primary PLAY button.
    await page.evaluate(() => { window.testPad.buttons[9] = { pressed: true, value: 1 }; });
    await playing(page, true);
    check('assigned gamepad START matches primary PLAY without changing touch preference', requests() === 1 && await prefsOff(page));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone({ off: true });
    await putPad(page);
    await sleep(200);
    await joinPad(page);
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
    await tap(page, 'play');
    await responseReady;
    await page.evaluate(() => { window.testPad = null; });
    await sleep(200);
    release();
    await page.waitForFunction(() => window.__ASTEROIDS_RANKED__?.phase === 'idle');
    check('controller lost during direct PLAY request prevents an uncontrollable run', requests() === 1 && await recovery(page) && await titleActive(page) && await prefsOff(page));
    await ctx.close();
  }
  {
    const { ctx, page, requests } = await phone();
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(`${worker.API}/api/v1/runs`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    await tap(page, 'play');
    check('pending direct PLAY exposes CONNECTING and CANCEL', (await menuItems(page)).items.some((i) => i.label === 'CONNECTING...' && !i.enabled) && (await menuItems(page)).items.some((i) => i.label === 'CANCEL'));
    await page.keyboard.press('Escape');
    release();
    await sleep(500);
    check('cancelling ignores the late challenge and returns to title', requests() === 1 && await titleActive(page) && (await menuItems(page)).page === 'title');
    await ctx.close();
  }
  for (const touchCapable of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: touchCapable });
    // A touch-capable laptop still has a fine primary pointer. Chromium's hasTouch alone emulates a coarse primary pointer.
    if (touchCapable) await ctx.addInitScript(() => {
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === '(pointer: coarse)'
        ? Object.defineProperty(nativeMatchMedia(query), 'matches', { value: false })
        : nativeMatchMedia(query);
    });
    const page = await openTitle(ctx, GAME, { api: worker.API });
    let requests = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/runs')) requests++; });
    const snap = await menuItems(page);
    check(`desktop touch-capable=${touchCapable}: original PLAY / RANKED / player selector remain`, !snap.items.some((i) => i.id === 'practice') && ['play', 'ranked', 'players', 'scores'].every((id) => snap.items.some((i) => i.id === id)));
    await page.keyboard.press('Digit2');
    await sleep(200);
    check('desktop two-player ranked remains disabled and Co-op is available', (await menuItems(page)).items.some((i) => i.id === 'ranked' && !i.enabled) && (await menuItems(page)).items.some((i) => i.id === 'coop'));
    await page.keyboard.press('Digit1');
    await sleep(200);
    await page.keyboard.press('Space');
    await playing(page, false);
    check('desktop Space still starts normal unranked play', requests === 0);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await openTitle(ctx, GAME, { api: worker.API });
    await clickItem(page, 'ranked');
    check('desktop RANKED still opens explanation before starting', (await menuItems(page)).page === 'ranked');
    await clickItem(page, 'start');
    await playing(page, true);
    check('desktop explicit ranked start still works', true);
    await ctx.close();
  }
} finally {
  await game?.close();
  worker.cleanup();
}
console.log(`\n${state.total - state.failures}/${state.total} mobile entry checks passed`);
process.exit(state.failures ? 1 : 0);
