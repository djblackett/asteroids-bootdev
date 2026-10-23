// Focused real-canvas check; no gameplay or backend required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { root, findChrome, waitFor } from './lib/rankedStack.mjs';
import path from 'node:path';
const url = 'http://127.0.0.1:5191/';
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5191', '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  await waitFor(url);
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(url + '?debug=1');
  await page.waitForFunction(() => window.__game?.scene.isActive('StartScene'));
  const results = await page.evaluate(async () => {
    const { PageKit } = await import('/src/ui/menu/widgets.ts');
    const { buildScoresPage } = await import('/src/ui/menu/pages/scores.ts');
    const { buildRankedPage } = await import('/src/ui/menu/pages/ranked.ts');
    const { buildRankedResultPage } = await import('/src/ui/menu/pages/rankedResult.ts');
    const scene = window.__game.scene.getScene('StartScene');
    const rows = [];
    const noop = () => {};
    for (const name of ['HolyMoo$3', "O'Connor", 'Renée', '李小龍', 'q\u0301bc', 'Ｗ'.repeat(16), '<img src=x onerror="window.__xss=1">']) {
      const best = () => ({ best: { nickname: name, score: 999999999 } });
      for (const kind of ['scores', 'ranked', 'result']) {
        const kit = new PageKit(scene, 999);
        if (kind === 'scores') buildScoresPage(kit, { inputMode: { isTouch: false }, best, highlightIds: () => new Set(), model: { scope: 'all-time', status: 'ready', pageNumber: 1, pageCount: 1, page: { entries: [{ nickname: name, score: 99, rank: 1, id: '1' }] } } }, { back: noop });
        if (kind === 'ranked') buildRankedPage(kit, { inputMode: { isTouch: false }, best, inputAvailable: () => true, status: () => ({ kind: 'idle' }), timeLimitLabel: '20:00', actions: {} }, {});
        if (kind === 'result') buildRankedResultPage(kit, { flow: { state: { kind: 'accepted', score: { nickname: name, score: 99 }, ranks: {} } }, inputMode: { isTouch: false }, input: { hide: noop, announce: noop }, actions: {}, priorBest: null }, {});
        const texts = kit.container.list.filter((o) => o.type === 'Text');
        const targets = texts.filter((o) => o.text === name || o.text.startsWith('YOUR BEST VERIFIED SCORE:'));
        if (!targets.length) throw new Error('Missing literal nickname');
        for (const t of targets) {
          const limit = t.text.startsWith('YOUR BEST') ? 1120 : kind === 'scores' ? 470 : 700;
          if (t.displayWidth > limit + 0.1) throw new Error('Nickname overflow');
        }
        rows.push(`${kind}: ${name}`);
        kit.destroy();
      }
    }
    if (window.__xss || document.querySelector('img[src="x"]')) throw new Error('HTML executed');
    return rows;
  });
  assert.equal(results.length, 21);
  console.log('PASS 21 real Phaser canvas nickname render/width checks across leaderboard, verified result and personal best; HTML-like input stays text.');
} finally {
  await browser?.close();
  vite.kill();
}
