// Player-facing ranked scenarios against the REAL Worker + D1 (no backend mocks): everything the main journey in ranked-browser.mjs
// does not cover. Two Workers run side by side, each with its own empty database:
//   A  the normal 20:00 limit
//   B  RANKED_TIME_LIMIT_SECONDS=8, so a run can really reach the time limit in seconds (the rules are identical at 20:00)
//
//   npm run test:ranked:ui          (builds first)
//
// Network faults are injected with Playwright routes on the browser side of the wire ("the response got lost"); the server stays real.
import crypto from 'node:crypto';
import { playUntilScoredThenDie } from './lib/browserPlay.mjs';
import { clickItem, itemPoint, makeChecker, menuItems, openTitle, rankedState, requireBuild, sceneTexts, sleep, startGameAndBrowser, WorkerStack } from './lib/rankedStack.mjs';

const GAME_PORT = Number(process.env.RANKED_GAME_PORT ?? 4411);
const A = new WorkerStack({ port: Number(process.env.RANKED_API_PORT_A ?? 8794), gamePort: GAME_PORT });
const B = new WorkerStack({ port: Number(process.env.RANKED_API_PORT_B ?? 8795), gamePort: GAME_PORT, vars: { RANKED_TIME_LIMIT_SECONDS: '8' } });
const LIMIT_TICKS = 8 * 60;
const { check, state } = makeChecker();
const sha = (buf) => crypto.createHash('sha256').update(buf ?? Buffer.alloc(0)).digest('hex');

requireBuild();
for (const w of [A, B]) {
  const m = w.migrate();
  check(`worker ${w === A ? 'A' : 'B'}: local D1 migrated`, m.ok, m.ok ? '' : m.output);
  if (!m.ok) process.exit(1);
}
process.on('exit', () => {
  A.cleanup();
  B.cleanup();
});

async function waitText(page, scene, re, timeout = 15000) {
  await page.waitForFunction(
    ([key, source, flags]) => {
      const rx = new RegExp(source, flags);
      const found = [];
      const walk = (list) => list.forEach((o) => (o.type === 'Container' ? o.visible && walk(o.list) : o.type === 'Text' && o.visible && found.push(o.text)));
      walk(window.__game.scene.getScene(key).children.list);
      return found.some((t) => rx.test(t));
    },
    [scene, re.source, re.flags],
    { timeout, polling: 100 },
  );
}
const resultOpen = (page, timeout = 90000) => page.waitForFunction(() => window.__game.scene.getScene('GameScene').resultMenuSnapshot()?.page === 'result', null, { timeout, polling: 100 });
const cssScale = (page) => page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width / 1280);

/** Items overlap, or stick out of the 1280 x 720 playfield. */
function layoutProblems(snapshot) {
  const out = [];
  const items = snapshot.items;
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > 1280 || a.y + a.h > 720) out.push(`${a.id} outside the screen`);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id} overlaps ${b.id}`);
    }
  }
  return out;
}

/** Starts a ranked run from the title screen with the mouse and waits for the game scene. */
async function startRankedRun(page) {
  await clickItem(page, 'ranked', 'title');
  await clickItem(page, 'start', 'title');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
}

/** Honest play to a natural game over; returns the run's score. */
async function playToGameOver(page) {
  await playUntilScoredThenDie(page);
  await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true, null, { timeout: 60000, polling: 50 });
  await resultOpen(page, 15000);
  await sleep(800); // the page ignores keys for a moment after the run ends
  return page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
}

async function typeNickname(page, name) {
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.classList.contains('nick-input'), null, { timeout: 3000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name);
}

let game;
try {
  await Promise.all([A.start(), B.start()]);
  game = await startGameAndBrowser(GAME_PORT);
  const { GAME, browser } = game;
  const newDesktop = (viewport = { width: 1280, height: 720 }) => browser.newContext({ viewport });

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Empty leaderboard (worker B, nothing played yet) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: B.API });
    await clickItem(page, 'scores', 'title');
    await waitText(page, 'StartScene', /^NO RANKED SCORES YET\.$/);
    const texts = await sceneTexts(page, 'StartScene');
    check('an empty board says "No ranked scores yet. Be the first!" (no fictional scores)', texts.includes('NO RANKED SCORES YET.') && texts.includes('BE THE FIRST!') && !texts.some((t) => /^#\d+$/.test(t)));
    const snap = await menuItems(page, 'title');
    check('Previous and Next are disabled on an empty board', snap.items.filter((i) => ['prev', 'next'].includes(i.id)).every((i) => !i.enabled));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Weekly / all-time boards and paging (worker B, seeded directly in D1) ---');
  {
    const now = Date.now();
    const rows = [];
    for (let i = 1; i <= 20; i++) rows.push({ nick: `Week ${String(i).padStart(2, '0')}`, score: 5000 - i * 10, at: now - i * 2000 });
    for (let i = 1; i <= 4; i++) rows.push({ nick: `Old ${i}`, score: 9000 + i, at: now - 9 * 86_400_000 - i * 1000 }); // last week: all-time only, and they lead it
    const sql = rows
      .map((r, i) => {
        const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
        const run = `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`;
        return `INSERT INTO runs (id, token_hash, seed, rules_version, config_json, created_at, expires_at, status, finished_at, score_id) VALUES ('${run}', 'x', 1, '1.1.0', '{}', ${r.at - 60000}, ${r.at + 3600000}, 'accepted', ${r.at}, '${id}');
INSERT INTO scores (id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms) VALUES ('${id}', '${run}', ${r.score}, '${r.nick}', ${r.at}, '1.1.0', 3600, 60000);`;
      })
      .join('\n');
    check('seeded 24 verified scores (20 this week, 4 from last week) straight into D1', B.exec(sql));

    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: B.API });
    const requests = [];
    page.on('request', (r) => r.url().includes('/leaderboard/') && requests.push(r.url()));
    await clickItem(page, 'scores', 'title');
    await waitText(page, 'StartScene', /^Week 01$/);
    let texts = await sceneTexts(page, 'StartScene');
    check('THIS WEEK shows ten entries per screen, best first, with ranks', texts.includes('#1') && texts.includes('#10') && !texts.includes('#11') && texts.includes('Week 01') && texts.includes('Week 10') && !texts.includes('Old 1'));
    check('...and a page counter (20 weekly scores = 2 pages)', texts.includes('PAGE 1 / 2'));
    check('weekly excludes last week\'s scores', !texts.some((t) => t.startsWith('Old')));
    check('only one screen of entries was requested (limit=10), never hundreds', requests.length >= 1 && requests.every((u) => /limit=10&offset=\d+$/.test(u)), requests.join(' '));
    let snap = await menuItems(page, 'title');
    check('Previous is disabled on the first screen, Next enabled', !snap.items.find((i) => i.id === 'prev').enabled && snap.items.find((i) => i.id === 'next').enabled);
    check('the High Scores screen has no overlapping or off-screen controls', layoutProblems(snap).length === 0, layoutProblems(snap).join('; '));

    await clickItem(page, 'next', 'title');
    await waitText(page, 'StartScene', /^Week 11$/);
    texts = await sceneTexts(page, 'StartScene');
    check('NEXT shows the following ten (ranks 11-20) and the counter moves', texts.includes('#11') && texts.includes('#20') && texts.includes('Week 20') && texts.includes('PAGE 2 / 2'));
    snap = await menuItems(page, 'title');
    check('Next is disabled on the last screen', !snap.items.find((i) => i.id === 'next').enabled);
    await clickItem(page, 'prev', 'title');
    await waitText(page, 'StartScene', /^Week 01$/);
    check('PREVIOUS returns to the first screen', true);

    const zones = (await menuItems(page, 'title')).items.find((i) => i.id === 'scope').zones;
    const tab = zones.find((z) => z.name === 'ALL TIME');
    const pt = await page.evaluate(([x, y]) => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.left + (x * c.width) / 1280, y: c.top + (y * c.height) / 720 }; }, [tab.x + tab.w / 2, tab.y + tab.h / 2]);
    await page.mouse.click(pt.x, pt.y);
    await waitText(page, 'StartScene', /^Old 4$/);
    texts = await sceneTexts(page, 'StartScene');
    check('ALL TIME includes last week\'s scores and ranks them above (24 scores = 3 pages)', texts.includes('Old 4') && texts.includes('PAGE 1 / 3') && texts.indexOf('Old 4') < texts.indexOf('Week 01'));
    check('...with a caption that is not a week', texts.includes('SCORES FROM DIFFERENT VERSIONS MAY NOT BE DIRECTLY COMPARABLE.') && !texts.some((t) => t.startsWith('WEEK OF')));
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Gamepad navigation of the new menus (simulated Gamepad API) ---');
  {
    const ctx = await newDesktop();
    await ctx.addInitScript(() => {
      const slots = [null, null, null, null];
      window.__pads = {
        put(index, buttons = {}) {
          slots[index] = { index, id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0) };
        },
      };
      navigator.getGamepads = () =>
        slots.map((p) => (p ? { index: p.index, id: p.id, mapping: 'standard', connected: true, timestamp: performance.now(), axes: [...p.axes], buttons: p.buttons.map((v) => ({ pressed: v >= 0.5, touched: v > 0, value: v })) } : null));
    });
    const page = await openTitle(ctx, GAME, { api: B.API });
    const BTN = { A: 0, B: 1, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    const tap = async (button) => {
      await page.evaluate(([i, b]) => window.__pads.put(i, { [b]: 1 }), [0, button]);
      await sleep(140);
      await page.evaluate((i) => window.__pads.put(i, {}), 0);
      await sleep(160);
    };
    await page.evaluate(() => window.__pads.put(0, {}));
    await sleep(300);
    await tap(BTN.A); // an unassigned pad's A joins the game
    const focus = async () => (await menuItems(page, 'title')).focus;
    await tap(BTN.RIGHT);
    check('D-pad Right moves the focus from PLAY to RANKED', (await focus()) === 'ranked', await focus());
    await tap(BTN.A);
    check('A opens the RANKED PLAY page', (await menuItems(page, 'title')).page === 'ranked');
    await tap(BTN.DOWN);
    check('D-pad Down reaches HIGH SCORES on that page', (await focus()) === 'scores', await focus());
    await tap(BTN.A);
    await waitText(page, 'StartScene', /^Week 01$/);
    check('A opens the High Scores', (await menuItems(page, 'title')).page === 'scores');
    await tap(BTN.UP);
    check('D-pad Up reaches the board tabs', (await focus()) === 'scope', await focus());
    await tap(BTN.RIGHT);
    await waitText(page, 'StartScene', /^SCORES FROM DIFFERENT VERSIONS MAY NOT BE DIRECTLY COMPARABLE\.$/);
    check('D-pad Right switches THIS WEEK to ALL TIME', true);
    await tap(BTN.LEFT);
    await waitText(page, 'StartScene', /^WEEK OF /);
    check('D-pad Left switches back', true);
    await tap(BTN.B);
    check('B steps back out of the High Scores to RANKED PLAY', (await menuItems(page, 'title')).page === 'ranked');
    await tap(BTN.B);
    check('B again returns to the title screen', (await menuItems(page, 'title')).page === 'title');
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- The time limit is a real, verified ending (worker B: 8 s limit, 480 ticks) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: B.API });
    let ticks = 0;
    let reached = false;
    let tries = 0;
    while (!reached && tries < 6) {
      tries++;
      if (tries > 1) {
        await clickItem(page, 'skip', 'result');
        await clickItem(page, 'play-again', 'result');
        await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
      } else await startRankedRun(page);
      await page.keyboard.down('Space'); // hold the cannon and sweep it round: still honest play, and it keeps the ship busy
      await page.keyboard.down('KeyD');
      let sawCountdown = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const open = await page.evaluate(() => window.__game.scene.getScene('GameScene').resultMenuSnapshot() !== null);
        if (open) break;
        if (!sawCountdown && (await sceneTexts(page, 'GameScene')).some((t) => /LEFT$/.test(t))) sawCountdown = true;
        await sleep(100);
      }
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyD');
      ticks = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks());
      reached = await page.evaluate(() => !window.__ASTEROIDS_REPLAY__.isGameOver());
      if (reached) check('the HUD counts down the last minute ("00:0x LEFT") next to the RANKED label', sawCountdown);
      else console.log(`  attempt ${tries}: the ship was lost at tick ${ticks} before the limit (a natural game over); trying again`);
    }
    check('a run reached the time limit with the ship still alive', reached, `after ${tries} attempt(s)`);
    check('the simulation stopped at EXACTLY the issued limit (480 ticks)', ticks === LIMIT_TICKS, `ticks=${ticks}`);
    await sleep(1000);
    check('nothing simulates after the limit (ticks and clock are frozen)', (await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks())) === LIMIT_TICKS);
    const texts = await sceneTexts(page, 'GameScene');
    check('the result page says TIME LIMIT REACHED and credits the survival (not "GAME OVER")', texts.includes('TIME LIMIT REACHED') && texts.some((t) => /SURVIVED THE FULL 00:08/.test(t)) && !texts.includes('GAME OVER'), texts.filter((t) => /TIME|SURVIV/.test(t)).join(' | '));
    const runScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
    await sleep(800);
    await typeNickname(page, 'Survivor');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => ['accepted', 'rejected', 'failed'].includes(window.__ASTEROIDS_RANKED__?.phase), null, { timeout: 30000 });
    const ranked = await rankedState(page);
    check('the server accepted the time-limited run', ranked.phase === 'accepted', `${ranked.phase} ${ranked.message}`);
    check('the server\'s score is the simulation\'s score at tick 480', ranked.verifiedScore === runScore, `server=${ranked.verifiedScore} browser=${runScore}`);
    check('the server says it ended by the time limit', ranked.outcome?.score.endReason === 'time_limit');
    const row = B.sql("SELECT end_reason, ticks, duration_ms, score, nickname FROM scores WHERE nickname = 'Survivor'")?.[0];
    check('D1 records end_reason=time_limit, 480 ticks, 8 s', row?.end_reason === 'time_limit' && row?.ticks === LIMIT_TICKS && row?.duration_ms === 8000, JSON.stringify(row));
    const detail = ranked.outcome ? await (await fetch(`${B.API}/api/v1/scores/${ranked.outcome.score.id}`)).json() : null;
    check('GET /scores/:id reports the ending too', detail?.score?.endReason === 'time_limit');
    if (runScore === 0) check('a zero score is accepted but honestly not ranked', ranked.outcome.ranks.weekly === null && ranked.outcome.ranks.allTime === null);
    else check('a nonzero time-limited score appears on the weekly board', (await (await fetch(`${B.API}/api/v1/leaderboard/weekly?limit=100`)).json()).entries.some((e) => e.nickname === 'Survivor'));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- A forged score is rejected by the server and says so (worker A) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: A.API });
    await startRankedRun(page);
    await sleep(600);
    // A player-side cheat: add 500 points to the ship mid-run. The recording's claim is then wrong, and the server's replay does not have them.
    await page.evaluate(() => { window.__game.scene.getScene('GameScene').sim.player.score += 500; });
    const claimed = await playToGameOver(page);
    check('the forged game really claims 500 extra points', claimed >= 500, `claimed ${claimed}`);
    await typeNickname(page, 'Cheater');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => ['accepted', 'rejected', 'failed'].includes(window.__ASTEROIDS_RANKED__?.phase), null, { timeout: 30000 });
    const ranked = await rankedState(page);
    check('the server rejected it', ranked.phase === 'rejected', ranked.phase);
    await waitText(page, 'GameScene', /^SCORE NOT VERIFIED$/);
    const texts = await sceneTexts(page, 'GameScene');
    check('the player is told: not verified, not on the leaderboard (never "SCORE VERIFIED!")', texts.includes('SCORE NOT VERIFIED') && !texts.includes('SCORE VERIFIED!') && texts.some((t) => /NOT ADDED TO THE LEADERBOARD/.test(t)));
    check('the diagnostic reason is shown in small print, without internals', texts.some((t) => /REASON CODE: SCORE_MISMATCH/.test(t)));
    const run = A.sql("SELECT status, reject_reason FROM runs WHERE status = 'rejected'")?.[0];
    check('D1: the run is spent (rejected / score_mismatch)', run?.status === 'rejected' && run?.reject_reason === 'score_mismatch', JSON.stringify(run));
    check('D1: no score row exists, nothing was remembered on the device', A.sql('SELECT COUNT(*) AS n FROM scores')?.[0]?.n === 0 && (await page.evaluate(() => localStorage.getItem('asteroids.rankedScores'))) === null);
    const items = (await menuItems(page, 'result')).items.map((i) => i.id);
    check('PLAY AGAIN and MAIN MENU are offered', items.includes('play-again') && items.includes('menu') && !items.includes('submit'));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Skipping, and layout / typed name through resizes (worker A) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: A.API });
    const calls = [];
    page.on('request', (r) => /\/submit$/.test(r.url()) && calls.push(r.method()));
    await startRankedRun(page);
    await playToGameOver(page);
    const ready = await menuItems(page, 'result');
    check('the result page has no overlapping or off-screen controls', layoutProblems(ready).length === 0, layoutProblems(ready).join('; '));
    await typeNickname(page, 'Resize Me');
    const rectOf = () => page.evaluate(() => { const r = document.querySelector('.nick-input').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const fieldCss = async () => {
      const f = (await menuItems(page, 'result')).items.find((i) => i.id === 'nickname');
      return page.evaluate(([x, y, w, h]) => { const c = document.querySelector('canvas').getBoundingClientRect(); const k = c.width / 1280; return { x: c.left + x * k, y: c.top + y * k, w: w * k, h: h * k }; }, [f.x, f.y, f.w, f.h]);
    };
    for (const [w, h] of [[667, 375], [844, 390], [1024, 768], [768, 1024], [1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(400);
      const input = await rectOf();
      const frame = await fieldCss();
      const value = await page.evaluate(() => document.querySelector('.nick-input').value);
      const close = Math.abs(input.x - frame.x) < 2 && Math.abs(input.y - frame.y) < 2 && Math.abs(input.w - frame.w) < 2 && Math.abs(input.h - frame.h) < 2;
      check(`${w}x${h}: the name field stays exactly over its canvas frame and keeps the typed name`, close && value === 'Resize Me', `input ${JSON.stringify(input)} frame ${JSON.stringify(frame)} value "${value}"`);
      if (w === 667 || w === 844) {
        const scale = await cssScale(page);
        const small = ready.items.filter((i) => Math.min(i.w, i.h) * scale < 44).map((i) => `${i.id} ${(Math.min(i.w, i.h) * scale).toFixed(1)}px`);
        check(`${w}x${h}: every control on the result page is at least 44 CSS px`, small.length === 0, small.join(', '));
      }
    }
    await page.screenshot({ path: 'scripts/.smoke-output/ranked-result-resized.png' }).catch(() => undefined);
    check('focus is visible on the field (gold border and ring)', await page.evaluate(() => { const el = document.querySelector('.nick-input'); el.focus(); const s = getComputedStyle(el); return s.borderTopColor === 'rgb(255, 200, 0)' && s.boxShadow !== 'none'; }));
    check('the field is a labelled, real text input (screen readers can name it)', await page.evaluate(() => { const el = document.querySelector('.nick-input'); return el.tagName === 'INPUT' && el.type === 'text' && /nickname/i.test(el.getAttribute('aria-label') ?? ''); }));
    await page.evaluate(() => document.querySelector('.nick-input').blur());
    await clickItem(page, 'skip', 'result');
    await sleep(300);
    const after = await rankedState(page);
    const texts = await sceneTexts(page, 'GameScene');
    check('SKIP: the run is not submitted, and the page says so', after.phase === 'skipped' && calls.length === 0 && texts.includes('SCORE NOT SUBMITTED.'));
    check('the typed nickname was not remembered by skipping', (await page.evaluate(() => localStorage.getItem('asteroids.rankedNickname'))) === null);
    const items = (await menuItems(page, 'result')).items.map((i) => i.id);
    check('after skipping, PLAY AGAIN, HIGH SCORES and MAIN MENU are all available', ['play-again', 'scores', 'menu'].every((id) => items.includes(id)));
    check('the field and its keyboard are gone', await page.evaluate(() => document.querySelector('.nick-input').hidden));
    await clickItem(page, 'play-again', 'result');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
    check('a skipped run never blocks the next one: PLAY AGAIN starts a fresh ranked run', (await rankedState(page)).phase === 'playing');
    check('D1: the skipped run produced no score', A.sql('SELECT COUNT(*) AS n FROM scores')?.[0]?.n === 0);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- A lost response: Retry resends the identical request, no second score (worker A) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: A.API });
    const bodies = [];
    let dropResponses = true;
    await page.route(`${A.API}/api/v1/runs/*/submit`, async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.continue();
      bodies.push(sha(req.postDataBuffer()));
      if (dropResponses) {
        await route.fetch(); // the server receives it and answers...
        return route.abort('failed'); // ...and the answer never reaches the browser
      }
      return route.continue();
    });
    await startRankedRun(page);
    const score = await playToGameOver(page);
    await typeNickname(page, 'Retry Ace');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__ASTEROIDS_RANKED__?.submission === 'network_error', null, { timeout: 40000 });
    const texts = await sceneTexts(page, 'GameScene');
    check('after the automatic attempts the player is told the server could not be reached, and nothing keeps retrying', texts.includes('COULD NOT REACH THE RANKED SERVER.') && bodies.length === 3, `${bodies.length} request(s) sent`);
    const seenAfterWait = bodies.length;
    await sleep(2500);
    check('no automatic retry loop: the request count stays at 3 until the player presses RETRY', bodies.length === seenAfterWait);
    check('every attempt carried byte-identical content', new Set(bodies).size === 1);
    check('the server DID accept the first one (only the answer was lost): exactly one score row', A.sql('SELECT COUNT(*) AS n FROM scores')?.[0]?.n === 1);
    const items = (await menuItems(page, 'result')).items.map((i) => i.id);
    check('RETRY and SKIP are offered; the nickname is locked (the field is hidden)', items.includes('retry') && items.includes('skip') && !items.includes('submit') && (await page.evaluate(() => document.querySelector('.nick-input').hidden)));
    check('"verified" is not claimed while the answer is unknown', !texts.some((t) => /VERIFIED/.test(t)));
    dropResponses = false;
    await clickItem(page, 'retry', 'result');
    await page.waitForFunction(() => window.__ASTEROIDS_RANKED__?.phase === 'accepted', null, { timeout: 30000 });
    const ranked = await rankedState(page);
    check('RETRY sends the same bytes again and the server answers with the ORIGINAL score (replayed)', bodies.length === 4 && new Set(bodies).size === 1 && ranked.outcome?.replayed === true && ranked.verifiedScore === score);
    check('still exactly one score row, one run consumed', A.sql('SELECT COUNT(*) AS n FROM scores')?.[0]?.n === 1 && A.sql("SELECT COUNT(*) AS n FROM runs WHERE status = 'accepted'")?.[0]?.n === 1);
    await waitText(page, 'GameScene', /^SCORE VERIFIED!$/);
    check('the result page says SCORE VERIFIED! only after the server\'s answer, with the nickname that was first sent', (await sceneTexts(page, 'GameScene')).includes('Retry Ace'));
    check('screen readers get the outcome too (live region)', await page.evaluate(() => /Score verified/.test(document.querySelector('.nick-sr')?.textContent ?? '')));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- The challenge runs out during the run (worker A; the issued expiry is shortened to 4 s in the browser) ---');
  {
    const ctx = await newDesktop();
    const page = await openTitle(ctx, GAME, { api: A.API });
    const submits = [];
    page.on('request', (r) => /\/submit$/.test(r.url()) && r.method() === 'POST' && submits.push(r.url()));
    await page.route(`${A.API}/api/v1/runs`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const now = Date.now();
      body.issuedAt = new Date(now).toISOString();
      body.expiresAt = new Date(now + 4000).toISOString();
      return route.fulfill({ response: res, json: body });
    });
    await startRankedRun(page);
    check('before it runs out the run is labelled RANKED', (await sceneTexts(page, 'GameScene')).includes('RANKED'));
    await page.keyboard.press('KeyP'); // a long pause is exactly how a challenge expires
    await sleep(4600);
    let texts = await sceneTexts(page, 'GameScene');
    check('the pause menu explains the expiry (not discovered only at game over)', texts.some((t) => /RANKED RUN EXPIRED/.test(t)), texts.filter((t) => /EXPIRED/.test(t)).join(' | '));
    await page.keyboard.press('KeyP');
    await sleep(600);
    texts = await sceneTexts(page, 'GameScene');
    check('after resuming, the HUD says UNRANKED and shows a notice (never silently downgraded)', texts.includes('UNRANKED') && texts.some((t) => /THIS SCORE CAN NOT BE SUBMITTED/.test(t)));
    await playToGameOver(page);
    texts = await sceneTexts(page, 'GameScene');
    check('at game over the result page says the run expired and offers PLAY AGAIN / MAIN MENU', texts.includes('RANKED RUN EXPIRED') && (await menuItems(page, 'result')).items.some((i) => i.id === 'play-again'));
    check('nothing was sent to the server for an expired run', submits.length === 0 && (await rankedState(page)).submission === 'expired');
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Phone: touch navigation and Assisted Flight ranked play (worker A, 844x390, touch emulation) ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await openTitle(ctx, GAME, { api: A.API });
    const cdp = await ctx.newCDPSession(page);
    const pts = new Map();
    const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })) });
    const finger = {
      async down(id, x, y) { pts.set(id, { x, y }); await send('touchStart'); },
      async move(id, x, y) { pts.set(id, { x, y }); await send('touchMove'); },
      async up(id) { const p = pts.get(id); pts.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); },
      async tap(x, y) { const id = 900 + Math.floor(Math.random() * 90); await finger.down(id, x, y); await sleep(70); await finger.up(id); await sleep(350); },
    };
    const tapItem = async (id, which) => { const p = await itemPoint(page, id, which); await finger.tap(p.x, p.y); };
    const centre = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; }, sel);

    const mode = await page.evaluate(() => document.body.classList.contains('tc-active'));
    check('a fresh phone starts in touch mode (on-screen controls), no query parameters', mode);
    const scale = await cssScale(page);
    const titleItems = await menuItems(page, 'title');
    const small = titleItems.items.filter((i) => Math.min(i.w, i.h) * scale < 44).map((i) => `${i.id} ${(Math.min(i.w, i.h) * scale).toFixed(1)}px`);
    check('title screen: every tap target is at least 44 CSS px (including RANKED and HIGH SCORES)', small.length === 0 && ['ranked', 'scores'].every((id) => titleItems.items.some((i) => i.id === id)), small.join(', '));
    check('title screen: no overlapping controls on a phone', layoutProblems(titleItems).length === 0, layoutProblems(titleItems).join('; '));
    check('the 1-player-only RANKED button is enabled in touch mode (touch play is one player)', titleItems.items.find((i) => i.id === 'ranked').enabled);

    await tapItem('scores', 'title');
    await sleep(1200);
    let snap = await menuItems(page, 'title');
    const small2 = snap.items.filter((i) => Math.min(i.w, i.h) * scale < 44 && !['prev', 'next'].includes(i.id)).map((i) => i.id);
    check('a finger opens HIGH SCORES; its controls are big enough and do not overlap', snap.page === 'scores' && small2.length === 0 && layoutProblems(snap).length === 0, small2.join(','));
    const zones = snap.items.find((i) => i.id === 'scope').zones;
    const tab = zones.find((z) => z.name === 'ALL TIME');
    const k = scale;
    const c = await centre('canvas');
    await finger.tap(c.left + (tab.x + tab.w / 2) * k, c.top + (tab.y + tab.h / 2) * k);
    await waitText(page, 'StartScene', /^SCORES FROM DIFFERENT VERSIONS MAY NOT BE DIRECTLY COMPARABLE\.$/);
    check('a finger switches THIS WEEK / ALL TIME', true);
    await tapItem('back', 'title');
    await tapItem('ranked', 'title');
    check('a finger opens RANKED PLAY', (await menuItems(page, 'title')).page === 'ranked');
    await tapItem('start', 'title');
    await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
    const movement = await page.evaluate(() => localStorage.getItem('asteroids.touchMovement'));
    check('ranked play on a fresh phone uses Assisted Flight (the default movement mode)', movement === null || movement === 'assisted', `stored=${movement}`);
    check('the on-screen controls are up during the ranked run, and the RANKED label is on screen', (await page.evaluate(() => document.querySelector('.tc-root').classList.contains('tc-play'))) && (await sceneTexts(page, 'GameScene')).includes('RANKED'));

    // Honest touch play: hold FIRE, sweep the steering thumb round the left zone, then let go and let the run end.
    const fire = await centre('.tc-fire');
    const zone = await centre('.tc-zone');
    const sx = zone.left + zone.w * 0.5;
    const sy = zone.top + zone.h * 0.55;
    await finger.down(1, sx, sy);
    await finger.down(2, fire.x, fire.y);
    const t0 = Date.now();
    let angle = 0;
    while (Date.now() - t0 < 14000 && !(await page.evaluate(() => window.__ASTEROIDS_REPLAY__.isGameOver()))) {
      angle += 0.5;
      await finger.move(1, sx + Math.cos(angle) * 46, sy + Math.sin(angle) * 46);
      await sleep(60);
    }
    for (const id of [...pts.keys()]) await finger.up(id).catch(() => undefined);
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true, null, { timeout: 120000, polling: 100 });
    await resultOpen(page, 15000);
    await sleep(800);
    const touchScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
    snap = await menuItems(page, 'result');
    const small3 = snap.items.filter((i) => Math.min(i.w, i.h) * scale < 44).map((i) => `${i.id} ${(Math.min(i.w, i.h) * scale).toFixed(1)}px`);
    check('result page on a phone: controls >= 44 CSS px, none overlapping', small3.length === 0 && layoutProblems(snap).length === 0, small3.concat(layoutProblems(snap)).join('; '));
    check('the casual RETRY / MAIN MENU buttons are not used for a ranked run', !(await sceneTexts(page, 'GameScene')).includes('RETRY'));

    const box = await page.locator('.nick-input').boundingBox();
    await finger.tap(box.x + box.width / 2, box.y + box.height / 2);
    check('tapping the name field focuses the real input (this is what opens the phone keyboard)', await page.evaluate(() => document.activeElement?.classList.contains('nick-input')));
    await page.keyboard.type('Phone Pilot');
    const typedValue = await page.evaluate(() => document.querySelector('.nick-input').value);
    check('typed text lands in the field', typedValue === 'Phone Pilot', typedValue);
    await page.setViewportSize({ width: 390, height: 844 }); // rotated upright: the "rotate your phone" prompt covers the screen
    await sleep(500);
    const portrait = await page.evaluate(() => ({ prompt: getComputedStyle(document.querySelector('.tc-rotate')).display, input: getComputedStyle(document.querySelector('.nick-input')).visibility, value: document.querySelector('.nick-input').value }));
    check('in portrait the rotate prompt covers the page, the field steps aside, and the typed name is kept', portrait.prompt === 'flex' && portrait.input === 'hidden' && portrait.value === 'Phone Pilot', JSON.stringify(portrait));
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(500);
    check('rotating back restores the field with the same name', (await page.evaluate(() => ({ v: document.querySelector('.nick-input').value, s: getComputedStyle(document.querySelector('.nick-input')).visibility }))).v === 'Phone Pilot');
    await page.evaluate(() => document.querySelector('.nick-input').blur());
    await tapItem('submit', 'result');
    await page.waitForFunction(() => ['accepted', 'rejected', 'failed'].includes(window.__ASTEROIDS_RANKED__?.phase), null, { timeout: 40000 });
    const ranked = await rankedState(page);
    check('the touch run was verified by the server', ranked.phase === 'accepted' && ranked.verifiedScore === touchScore, `${ranked.phase} server=${ranked.verifiedScore} browser=${touchScore}`);
    const row = A.sql("SELECT reported_controls, nickname FROM scores WHERE nickname = 'Phone Pilot'")?.[0];
    check('D1 recorded the control scheme as touch-assisted (untrusted metadata)', row?.reported_controls === 'touch-assisted', JSON.stringify(row));
    snap = await menuItems(page, 'result');
    check('verified page on a phone: controls fit and are touch sized', layoutProblems(snap).length === 0 && snap.items.every((i) => Math.min(i.w, i.h) * scale >= 44));
    await page.screenshot({ path: 'scripts/.smoke-output/ranked-result-phone.png' }).catch(() => undefined);
    await ctx.close();
  }
} finally {
  await game?.close();
  A.cleanup();
  B.cleanup();
}

console.log(`\n${state.total - state.failures}/${state.total} ranked player-facing checks passed\n`);
if (state.failures) console.log('Worker A log tail:\n' + A.log.slice(-1200) + '\nWorker B log tail:\n' + B.log.slice(-1200));
process.exit(state.failures ? 1 : 0);
