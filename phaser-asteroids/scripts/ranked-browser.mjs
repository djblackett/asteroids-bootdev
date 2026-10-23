// End-to-end acceptance for the player-facing ranked experience: real Chromium -> the production build -> a real Cloudflare Worker
// runtime (workerd) -> a real local D1 database -> the public leaderboard API. Nothing about the backend is mocked.
//
//   npm run test:ranked          (builds first)
//
// The journey, exactly as a player takes it, with no query parameters:
//   title screen -> RANKED -> START RANKED RUN (the Worker issues the seed) -> play (pause and resume on the way) -> game over ->
//   type a nickname -> SUBMIT -> the Worker replays the recording itself -> D1 stores ITS score -> "SCORE VERIFIED!" ->
//   HIGH SCORES (this week, all time) -> reload -> the personal best is still there.
// Then: the backend goes away, and ranked play says so while a normal game still starts. More scenarios: scripts/ranked-ui.mjs.
import { playUntilScoredThenDie } from './lib/browserPlay.mjs';
import { clickItem, itemPoint, loadEngine, makeChecker, menuItems, openTitle, rankedState, requireBuild, sceneTexts, sleep, startGameAndBrowser, waitRanked, WorkerStack } from './lib/rankedStack.mjs';

const GAME_PORT = Number(process.env.RANKED_GAME_PORT ?? 4410); // must be in wrangler.toml ALLOWED_ORIGINS
const API_PORT = Number(process.env.RANKED_API_PORT ?? 8793);
const { check, state } = makeChecker();

requireBuild();
const { verifyReplay } = await loadEngine();
const stack = new WorkerStack({ port: API_PORT, gamePort: GAME_PORT });
const API = stack.API;
const migrated = stack.migrate();
check('local D1 migrated from the repository migration files (0001 + 0002)', migrated.ok, migrated.ok ? '' : migrated.output);
if (!migrated.ok) process.exit(1);

let game;
process.on('exit', () => {
  stack.cleanup();
});

/** Waits until some visible text of the scene matches. */
async function waitText(page, scene, re, timeout = 15000) {
  const source = re.source;
  const flags = re.flags;
  await page.waitForFunction(
    ([key, source, flags]) => {
      const rx = new RegExp(source, flags);
      const found = [];
      const walk = (list) => list.forEach((o) => (o.type === 'Container' ? o.visible && walk(o.list) : o.type === 'Text' && o.visible && found.push(o.text)));
      walk(window.__game.scene.getScene(key).children.list);
      return found.some((t) => rx.test(t));
    },
    [scene, source, flags],
    { timeout, polling: 100 },
  );
}

try {
  await stack.start();
  game = await startGameAndBrowser(GAME_PORT);
  const { GAME, browser } = game;

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Part 1: the whole player journey against the real Worker + D1 ---');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await openTitle(context, GAME, { api: API });
  const apiCalls = [];
  page.on('request', (r) => r.url().startsWith(API) && apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`));
  const submitCalls = () => apiCalls.filter((c) => /POST \/api\/v1\/runs\/[0-9a-f-]+\/submit/.test(c)).length;

  const title = await menuItems(page, 'title');
  check('the title screen has PLAY, RANKED and HIGH SCORES buttons, and nothing in the URL asked for ranked play', ['play', 'ranked', 'scores'].every((id) => title.items.some((i) => i.id === id)) && !new URL(page.url()).searchParams.has('ranked'));

  let attempt = 0;
  let browserScore = 0;
  let record = null;
  let maxCombo = 0;
  const NICK = 'Browser Ace';
  while (attempt < 4) {
    attempt++;
    if (attempt > 1) {
      console.log(`  attempt ${attempt - 1} scored 0; starting a fresh ranked run`);
      await clickItem(page, 'skip', 'result'); // nothing worth posting
      await clickItem(page, 'play-again', 'result');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
    } else {
      await clickItem(page, 'ranked', 'title');
      const rankedPage = await menuItems(page, 'title');
      check('RANKED opens the ranked page (rules, start, scores, back)', rankedPage.page === 'ranked' && ['start', 'scores', 'back'].every((id) => rankedPage.items.some((i) => i.id === id)));
      check('the ranked page states the time limit before the player starts', (await sceneTexts(page, 'StartScene')).some((t) => /ENDS AT 20:00/.test(t)));
      check('nothing has been requested from the server yet (the page is just information)', !apiCalls.includes('POST /api/v1/runs'));
      await clickItem(page, 'start', 'title');
      await page.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 15000 });
      await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isVerified === true, null, { timeout: 5000 });
    }

    const session = await page.evaluate(() => ({ ranked: window.__ASTEROIDS_RANKED__, seed: window.__ASTEROIDS_REPLAY__.seed }));
    if (attempt === 1) {
      check('the challenge came from the server before play (phase=playing, run id held)', session.ranked?.phase === 'playing' && /^[0-9a-f-]{36}$/.test(session.ranked.runId ?? ''));
      check('the challenge was requested with POST /api/v1/runs', apiCalls.includes('POST /api/v1/runs'));
      check('simulation seed is the server-issued seed (not a default, not from the URL)', Number.isInteger(session.seed) && session.seed > 1 && !new URL(page.url()).searchParams.has('seed'));
      check('the ranked indicator is on screen during play', (await sceneTexts(page, 'GameScene')).includes('RANKED'));

      // Pause and resume: the simulation stops, the recording stops with it, and play resumes where it left off.
      await sleep(700);
      await page.keyboard.press('KeyP');
      await sleep(250);
      const t1 = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks());
      await sleep(900);
      const t2 = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks());
      check('pausing freezes the simulation and its recording', t1 === t2 && t1 > 0, `ticks ${t1} -> ${t2}`);
      check('the same challenge is still held while paused (nothing submitted, nothing re-requested)', (await rankedState(page)).phase === 'playing' && submitCalls() === 0 && apiCalls.filter((c) => c === 'POST /api/v1/runs').length === 1);
      await page.keyboard.press('KeyP');
      await sleep(700);
      const t3 = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getTicks());
      check('resuming continues the same run from where it stopped', t3 > t2, `ticks ${t2} -> ${t3}`);
    }

    maxCombo = await playUntilScoredThenDie(page);
    await page.waitForFunction(() => window.__ASTEROIDS_REPLAY__?.isGameOver() === true, null, { timeout: 60000, polling: 50 });
    browserScore = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getScore());
    record = await page.evaluate(() => window.__ASTEROIDS_REPLAY__.getReplay());
    await page.waitForFunction(() => window.__game.scene.getScene('GameScene').resultMenuSnapshot()?.page === 'result', null, { timeout: 10000 });
    if (browserScore > 0) break;
  }
  check('the browser game reached game over with a nonzero score', browserScore > 0, `score=${browserScore} after ${attempt} attempt(s), max combo ${maxCombo}`);

  const result = await menuItems(page, 'result');
  check('game over shows the ranked result page: name field, SUBMIT and SKIP', ['nickname', 'submit', 'skip'].every((id) => result.items.some((i) => i.id === id)));
  check('the result page shows the run score and says it was a ranked run (not "verified" yet)', (await sceneTexts(page, 'GameScene')).some((t) => t === browserScore.toLocaleString('en-US')) && !(await sceneTexts(page, 'GameScene')).some((t) => /VERIFIED/.test(t) && !/NOT/.test(t)));
  check('nothing was sent to the server before the player chose to submit', submitCalls() === 0 && (await rankedState(page)).phase === 'finished');

  // Typing a nickname with the real keyboard. Keys typed in the field are text, not controls.
  await sleep(800); // the result page ignores keys for a moment after game over (a held cannon key must not press a button)
  await page.keyboard.press('Enter'); // activates the name field: the DOM input takes the focus
  await page.waitForFunction(() => document.activeElement?.classList.contains('nick-input'), null, { timeout: 3000 });
  check('Enter on the name field focuses the real text input', true);
  await page.keyboard.type('ab');
  await sleep(250);
  check('the field gives feedback while typing (too short)', (await sceneTexts(page, 'GameScene')).some((t) => /TOO SHORT/.test(t)));
  await page.keyboard.press('Enter'); // submit with an invalid nickname
  await sleep(400);
  check('an invalid nickname is refused locally: nothing is sent, the field stays editable', submitCalls() === 0 && (await rankedState(page)).phase === 'finished');
  await page.evaluate(() => document.querySelector('.nick-input').focus());
  await page.keyboard.press('Control+A');
  await page.keyboard.type(NICK);
  const typed = await page.evaluate(() => document.querySelector('.nick-input').value);
  check('typing into the field does not steer, pause or retry the game (value is exactly what was typed)', typed === NICK, typed);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // an impatient second press must not send a second request

  await waitRanked(page, "(r) => ['accepted','rejected','failed'].includes(r?.phase)");
  const ranked = await rankedState(page);
  check('the server accepted the recording', ranked.phase === 'accepted', `phase=${ranked.phase} ${ranked.message}`);
  check('the server-verified score equals the browser\'s own score', ranked.verifiedScore === browserScore, `server=${ranked.verifiedScore} browser=${browserScore}`);
  await sleep(500);
  check('the recording was POSTed exactly once, even after two Enter presses', submitCalls() === 1);

  const node = verifyReplay(record, { timeLimitTicks: 72000 });
  check('an independent Node replay agrees with the server\'s score', node.valid && node.calculatedScore === ranked.verifiedScore, `node=${node.calculatedScore}`);

  await waitText(page, 'GameScene', /^SCORE VERIFIED!$/);
  const texts = await sceneTexts(page, 'GameScene');
  check('the result page says SCORE VERIFIED! only now, with the nickname', texts.includes('SCORE VERIFIED!') && texts.includes(NICK));
  check('the result page shows the server\'s weekly and all-time ranks', texts.some((t) => /^WEEKLY RANK\s+#1$/.test(t)) && texts.some((t) => /^ALL-TIME RANK\s+#1$/.test(t)), texts.filter((t) => /RANK/.test(t)).join(' | '));
  check('first verified score on a fresh device is a new personal best', texts.includes('NEW PERSONAL BEST!'));

  const board = await (await fetch(`${API}/api/v1/leaderboard/all-time`)).json();
  const weekly = await (await fetch(`${API}/api/v1/leaderboard/weekly`)).json();
  const entry = board.entries.find((e) => e.id === ranked.outcome.score.id);
  check('GET /leaderboard/all-time returns that score and nickname', !!entry && entry.score === browserScore && entry.nickname === NICK, JSON.stringify(entry));
  check('GET /leaderboard/weekly returns it too', weekly.entries.some((e) => e.id === ranked.outcome.score.id));
  check('exactly one score row exists', board.total === 1);
  const row = stack.sql('SELECT s.score, s.end_reason, s.reported_controls, s.nickname, s.ticks, r.status, r.seed, r.time_limit_ticks FROM scores s JOIN runs r ON r.id = s.run_id')?.[0];
  check('D1 holds the authoritative score; the run is terminal (accepted) and ended in game over', row?.score === browserScore && row?.status === 'accepted' && row?.end_reason === 'game_over', JSON.stringify(row));
  check('D1 stored the server-issued seed the browser used, and the limit that was issued', row?.seed === record.header.seed && row?.time_limit_ticks === 72000);
  check('the reported control scheme was recorded as untrusted metadata (keyboard)', row?.reported_controls === 'keyboard');
  const stored = await page.evaluate(() => ({ scores: localStorage.getItem('asteroids.rankedScores'), nick: localStorage.getItem('asteroids.rankedNickname') }));
  check('the device remembers the accepted score id and the nickname (only after acceptance)', !!stored.scores && JSON.parse(stored.scores)[0].id === ranked.outcome.score.id && stored.nick === NICK);

  // High scores from the result page.
  await clickItem(page, 'scores', 'result');
  await waitText(page, 'GameScene', /^HIGH SCORES$/);
  await waitText(page, 'GameScene', new RegExp(`^${NICK}$`));
  const boardTexts = await sceneTexts(page, 'GameScene');
  check('HIGH SCORES (this week) lists the new entry with rank, nickname and score', boardTexts.includes('#1') && boardTexts.includes(NICK) && boardTexts.includes(browserScore.toLocaleString('en-US')));
  check('the entry is marked as this device\'s own (matched by score id, not by nickname)', boardTexts.includes('YOU'));
  check('the week shown is the server\'s Atlantic-time week', boardTexts.some((t) => /^WEEK OF [A-Z]{3} \d+ - [A-Z]{3} \d+/.test(t)), boardTexts.find((t) => /WEEK/.test(t)));
  const scopeZones = (await menuItems(page, 'result')).items.find((i) => i.id === 'scope').zones;
  const allTime = scopeZones.find((z) => z.name === 'ALL TIME');
  const cp = await page.evaluate(([x, y]) => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.left + (x * c.width) / 1280, y: c.top + (y * c.height) / 720 }; }, [allTime.x + allTime.w / 2, allTime.y + allTime.h / 2]);
  await page.mouse.click(cp.x, cp.y);
  await waitText(page, 'GameScene', /^BEST VERIFIED SCORES OF ALL TIME$/);
  await waitText(page, 'GameScene', new RegExp(`^${NICK}$`));
  check('switching to ALL TIME shows the same entry', true);
  check('the player\'s best verified score is shown under the table', (await sceneTexts(page, 'GameScene')).some((t) => t.startsWith('YOUR BEST VERIFIED SCORE:')));
  await page.keyboard.press('Escape');
  await sleep(400);
  check('Escape leaves the high scores and returns to the verified result', (await sceneTexts(page, 'GameScene')).includes('SCORE VERIFIED!'));

  // PLAY AGAIN asks the server for a brand-new challenge.
  const firstRun = ranked.runId;
  await clickItem(page, 'play-again', 'result');
  await page.waitForFunction(() => window.__game.scene.isActive('GameScene') && window.__ASTEROIDS_REPLAY__?.isVerified, null, { timeout: 15000 });
  const second = await rankedState(page);
  check('PLAY AGAIN starts a new ranked run with a new server challenge', second.phase === 'playing' && second.runId !== firstRun && apiCalls.filter((c) => c === 'POST /api/v1/runs').length === attempt + 1, `runs requested: ${apiCalls.filter((c) => c === 'POST /api/v1/runs').length}`);
  check('the finished run\'s credentials are useless: a guessed token cannot touch it (401)', (await fetch(`${API}/api/v1/runs/${firstRun}/submit`, { method: 'POST', headers: { authorization: 'Bearer guessed-token' }, body: '{}' })).status === 401);

  // Leaving a run in progress never records a score.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').pauseMenuSnapshot().items.some((i) => i.id === 'menu'), null, { timeout: 5000 });
  const unfinished = await page.evaluate(() => {
    const scene = window.__game.scene.getScene('GameScene');
    return { challenge: scene.rankedChallenge, replay: window.__ASTEROIDS_REPLAY__.getReplay() };
  });
  await clickItem(page, 'menu', 'pause'); // first press only arms it ("QUIT THIS RUN? PRESS OR TAP AGAIN")
  await waitText(page, 'GameScene', /QUIT THIS RUN\?/, 5000);
  check('the first quit press only asks for confirmation and keeps the unfinished run paused', await page.evaluate(() => window.__game.scene.getScene('GameScene').paused) && (await rankedState(page)).phase === 'playing' && submitCalls() === 1);
  await sleep(400); // a second contact inside 300 ms counts as the same accidental touch and is ignored
  await clickItem(page, 'menu', 'pause'); // second press confirms
  await page.waitForFunction(() => window.__game.scene.isActive('StartScene'), null, { timeout: 5000 });
  await sleep(500);
  check('quitting after PLAY AGAIN stays on the title screen without issuing another challenge', (await menuItems(page, 'title')).page === 'title' && await page.evaluate(() => window.__game.scene.isActive('StartScene') && !window.__game.scene.isActive('GameScene')) && apiCalls.filter((c) => c === 'POST /api/v1/runs').length === attempt + 1);
  check('the abandoned run has no submission flow, and its recorder is abandoned and removed from the browser API', (await rankedState(page)).phase === 'abandoned' && await page.evaluate(() => {
    const scene = window.__game.scene.getScene('GameScene');
    return scene.replayRecorder.abandoned && !scene.rankedFlow && !window.__ASTEROIDS_REPLAY__;
  }));
  const abandonedSubmit = await fetch(`${API}/api/v1/runs/${unfinished.challenge.runId}/submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${unfinished.challenge.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ replay: unfinished.replay, nickname: 'Abandoned Pilot', controls: { scheme: 'keyboard' } }),
  });
  const abandonedOutcome = await abandonedSubmit.json();
  check('even with its real token, the Worker refuses the unfinished recording', abandonedSubmit.status === 422 && abandonedOutcome.error?.reason === 'not_game_over', `status=${abandonedSubmit.status} reason=${abandonedOutcome.error?.reason}`);
  check('abandoning a ranked run leaves no score behind', (await (await fetch(`${API}/api/v1/leaderboard/all-time`)).json()).total === 1 && submitCalls() === 1);

  // Reload: the personal best is device-local and survives.
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(500);
  await clickItem(page, 'ranked', 'title');
  await waitText(page, 'StartScene', /^YOUR BEST VERIFIED SCORE:/);
  check('after a reload the ranked page still shows the verified personal best', (await sceneTexts(page, 'StartScene')).some((t) => t.includes(browserScore.toLocaleString('en-US')) && t.includes(NICK.toUpperCase())));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'), null, { timeout: 20000 });
  await sleep(500);
  await clickItem(page, 'ranked', 'title');
  await sleep(1200);
  check('with the browser storage cleared the personal best is gone (it is device-local, not an account)', !(await sceneTexts(page, 'StartScene')).some((t) => t.startsWith('YOUR BEST VERIFIED')));
  check('...while the score itself is still on the public leaderboard', (await (await fetch(`${API}/api/v1/leaderboard/all-time`)).json()).total === 1);
  check('no page errors during the journey', page.problems.length === 0, page.problems.join(' | '));
  await context.close();

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Part 2: the developer shortcut still works, through the same page ---');
  const dev = await openTitle(await browser.newContext({ viewport: { width: 1280, height: 720 } }), GAME, { api: API, query: 'ranked=1' });
  await dev.keyboard.press('Space');
  await dev.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 15000 });
  check('?ranked=1 + PLAY still asks the server for a challenge and starts a ranked run', (await rankedState(dev)).phase === 'playing');
  await dev.context().close();

  // ------------------------------------------------------------------------------------------------------------------------
  console.log('\n--- Part 3: backend offline ---');
  stack.stop();
  await sleep(1500);
  const offline = await fetch(`${API}/api/v1/health`).then(() => true, () => false);
  check('the backend is really down', offline === false);

  const offCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const down = await openTitle(offCtx, GAME, { api: API });
  const calls = [];
  down.on('request', (r) => /\/api\/v1\//.test(r.url()) && calls.push(r.url()));
  await clickItem(down, 'ranked', 'title');
  await clickItem(down, 'start', 'title');
  await down.waitForFunction(() => window.__ASTEROIDS_RANKED__?.phase === 'failed', null, { timeout: 15000 });
  await sleep(500);
  const downTexts = await sceneTexts(down, 'StartScene');
  check('ranked play with the backend down stays on the title screen and says so, in plain words', downTexts.includes('RANKED PLAY IS TEMPORARILY UNAVAILABLE.') && downTexts.includes('YOU CAN STILL PLAY NORMALLY.') && (await down.evaluate(() => !window.__game.scene.isActive('GameScene'))));
  const downItems = await menuItems(down, 'title');
  check('it offers TRY AGAIN, PLAY NORMALLY and BACK (never a dead end)', ['start', 'play-normally', 'back'].every((id) => downItems.items.some((i) => i.id === id)));
  await clickItem(down, 'back', 'title');
  await clickItem(down, 'scores', 'title');
  await waitText(down, 'StartScene', /COULD NOT REACH THE HIGH SCORES/);
  check('the High Scores screen says the leaderboard is unreachable (and offers TRY AGAIN)', (await menuItems(down, 'title')).items.some((i) => i.id === 'retry'));
  await down.keyboard.press('Escape');
  await sleep(400);
  await clickItem(down, 'ranked', 'title');
  await clickItem(down, 'start', 'title');
  await sleep(1200);
  await clickItem(down, 'play-normally', 'title');
  await down.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  const c1 = await down.evaluate(() => window.__game.scene.getScene('GameScene').sim.time);
  await sleep(1200);
  const c2 = await down.evaluate(() => window.__game.scene.getScene('GameScene').sim.time);
  check('PLAY NORMALLY starts a casual game that runs with the backend offline', c2 - c1 > 0.8, `sim clock advanced ${(c2 - c1).toFixed(2)} s`);
  check('that game is a casual one: no recording, no ranked indicator, no result page', await down.evaluate(() => !window.__ASTEROIDS_REPLAY__ && !window.__game.scene.getScene('GameScene').resultMenuSnapshot()));
  check('no ranked state claims a verified score', (await rankedState(down)).verifiedScore === null);
  await offCtx.close();

  const plain = await openTitle(await browser.newContext({ viewport: { width: 1280, height: 720 } }), GAME, { api: API });
  const plainCalls = [];
  plain.on('request', (r) => /\/api\/v1\//.test(r.url()) && plainCalls.push(r.url()));
  await plain.keyboard.press('Space');
  await plain.waitForFunction(() => window.__game.scene.isActive('GameScene'), null, { timeout: 5000 });
  await sleep(500);
  check('plain PLAY never contacts the leaderboard API', plainCalls.length === 0 && (await plain.evaluate(() => !window.__ASTEROIDS_REPLAY__)));
} finally {
  await game?.close();
  stack.cleanup();
}

console.log(`\n${state.total - state.failures}/${state.total} ranked browser-to-backend checks passed\n`);
if (state.failures) console.log('Worker log tail:\n' + stack.log.slice(-1500));
process.exit(state.failures ? 1 : 0);
