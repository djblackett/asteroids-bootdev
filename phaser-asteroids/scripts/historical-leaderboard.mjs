// Focused regression: production build + real local Worker/D1 + Chromium. No production data or services are used.
// Run after building: node scripts/historical-leaderboard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settleTitleInput } from './lib/menuWaits.mjs';
import { clickItem, menuItems, openTitle, rankedState, requireBuild, sceneTexts, sleep, startGameAndBrowser, WorkerStack } from './lib/rankedStack.mjs';

const GAME_PORT = Number(process.env.HISTORY_GAME_PORT ?? 4420);
const worker = new WorkerStack({ port: Number(process.env.HISTORY_API_PORT ?? 8798), gamePort: GAME_PORT, vars: { RANKED_TIME_LIMIT_SECONDS: '8' } });
const caption = 'SCORES FROM DIFFERENT VERSIONS MAY NOT BE DIRECTLY COMPARABLE.';
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const api = async (path) => {
  const res = await fetch(`${worker.API}/api/v1${path}`);
  assert.equal(res.status, 200);
  return res.json();
};
async function waitText(page, scene, text) {
  await page.waitForFunction(([key, expected]) => {
    const walk = (list) => list.some((o) => o.visible && (o.type === 'Container' ? walk(o.list) : o.type === 'Text' && o.text === expected));
    return walk(window.__game.scene.getScene(key).children.list);
  }, [scene, text], { timeout: 15000 });
}
async function allTime(page) {
  const zone = (await menuItems(page)).items.find((i) => i.id === 'scope').zones.find((z) => z.name === 'ALL TIME');
  const point = await page.evaluate(([x, y]) => {
    const c = document.querySelector('canvas').getBoundingClientRect();
    return { x: c.left + x * c.width / 1280, y: c.top + y * c.height / 720 };
  }, [zone.x + zone.w / 2, zone.y + zone.h / 2]);
  await page.mouse.click(point.x, point.y);
  await waitText(page, 'StartScene', 'Past Week');
}

requireBuild();
let game;
process.on('exit', () => worker.cleanup());
try {
  const migration = worker.migrate();
  assert.ok(migration.ok, migration.output);
  await worker.start();
  const now = Date.now();
  const rows = [
    ['Old Champ_99!', 20000, '1.0.0', now, 'visible'], // historical rules, inside the current week
    ['Current Pilot', 1000, '1.2.0', now, 'visible'],
    ['Past Week', 30000, '1.2.0', now - 9 * 86400000, 'visible'],
    ['Hidden Pilot', 99999, '1.0.0', now, 'hidden'],
    ['Unknown Pilot', 99998, '9.0.0', now, 'visible'],
    ['Zero Pilot', 0, '1.0.0', now, 'visible'],
  ];
  assert.ok(worker.exec(rows.map(([name, score, version, at, visibility], i) => {
    const run = id(i + 100);
    return `INSERT INTO runs (id, token_hash, seed, rules_version, config_json, created_at, expires_at, status, finished_at, score_id)
      VALUES ('${run}', 'x', 1, '${version}', '{}', ${at - 60000}, ${at + 3600000}, 'accepted', ${at}, '${id(i)}');
      INSERT INTO scores (id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms, visibility)
      VALUES ('${id(i)}', '${run}', ${score}, '${name}', ${at}, '${version}', 3600, 60000, '${visibility}');`;
  }).join('\n')));
  const board = await api('/leaderboard/all-time');
  assert.equal(board.total, 3);
  assert.deepEqual(board.entries.map((e) => [e.id, e.rank, e.rulesVersion]), [[id(2), 1, '1.2.0'], [id(0), 2, '1.0.0'], [id(1), 3, '1.2.0']]);
  const weekly = await api('/leaderboard/weekly');
  assert.equal(weekly.total, 1);
  assert.equal(weekly.entries[0].id, id(1));
  assert.deepEqual((await api(`/scores/${id(0)}`)).ranks, { allTime: 2, weekly: null });
  console.log('PASS real Worker: mixed-era ordering, counts, exclusions and historical detail ranks');

  game = await startGameAndBrowser(GAME_PORT);
  const context = await game.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((best) => localStorage.setItem('asteroids.rankedScores', JSON.stringify([best])), {
    id: id(0), score: 20000, at: new Date(now).toISOString(), nickname: 'Old Champ_99!', // legacy cache: no rulesVersion
  });
  const page = await openTitle(context, game.GAME, { api: worker.API });
  await clickItem(page, 'scores');
  await waitText(page, 'StartScene', 'Current Pilot');
  const bestLine = 'YOUR BEST VERIFIED SCORE: 20,000  V1  (Old Champ_99!)';
  await waitText(page, 'StartScene', bestLine);
  let texts = await sceneTexts(page, 'StartScene');
  assert.ok(!texts.includes('Old Champ_99!') && texts.includes('V3'));
  await allTime(page);
  texts = await sceneTexts(page, 'StartScene');
  assert.ok(texts.includes(caption) && texts.includes('V1') && texts.includes('V3') && texts.includes('YOU'));
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('asteroids.rankedScores')));
  assert.equal(cached[0].rulesVersion, '1.0.0');
  fs.mkdirSync('scripts/.smoke-output', { recursive: true });
  await page.screenshot({ path: 'scripts/.smoke-output/historical-leaderboard-desktop.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: 'scripts/.smoke-output/historical-leaderboard-phone.png' });
  console.log('PASS browser: weekly/current era, mixed labels, comparison note, YOU highlight and legacy personal-best refresh');

  await page.setViewportSize({ width: 1280, height: 720 });
  await settleTitleInput(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.getScene('StartScene').menuSnapshot()?.page === 'title');
  await settleTitleInput(page);
  await clickItem(page, 'ranked');
  await page.waitForFunction(() => window.__game.scene.getScene('StartScene').menuSnapshot()?.page === 'ranked');
  await settleTitleInput(page);
  await clickItem(page, 'start');
  await page.waitForFunction(() => window.__game.scene.getScene('GameScene').resultMenuSnapshot()?.page === 'result', null, { timeout: 30000 });
  await sleep(900); // the result menu ignores input briefly after the run ends
  await page.locator('.nick-input').fill('New Pilot');
  await clickItem(page, 'submit', 'result');
  await waitText(page, 'GameScene', 'SCORE VERIFIED!');
  texts = await sceneTexts(page, 'GameScene');
  assert.ok(texts.includes('V3') && texts.includes('YOUR BEST: 20,000  V1') && !texts.includes('NEW PERSONAL BEST!'));
  const accepted = (await rankedState(page)).outcome;
  assert.equal(accepted.score.rulesVersion, '1.2.0');
  assert.deepEqual((await api(`/scores/${accepted.score.id}`)).ranks, accepted.ranks);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('asteroids.rankedScores'))))[0].id, id(0));
  assert.deepEqual(page.problems, []);
  console.log('PASS verified V3 submission: result labels, historical personal best and consistent server ranks');
  await context.close();
} finally {
  await game?.close();
  worker.cleanup();
}
