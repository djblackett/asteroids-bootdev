// Benchmarks replay verification inside the real Workers runtime (workerd via `wrangler dev --local`).
// Measures end-to-end request time from outside the isolate (in-isolate clocks do not advance during CPU work).
//
//   npm run build            (in ..)   # builds dist/node for the bot
//   node scripts/bench-workerd.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateBotReplay } from '../testing/bot.mjs';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(serverDir, '..', 'dist', 'node', 'index.js')).href);
const PORT = Number(process.env.BENCH_PORT ?? 8791);
const ITER = 7;

const wrangler = spawn(process.execPath, [path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--local', '-c', 'wrangler.bench.toml', '--port', String(PORT)], {
  cwd: serverDir,
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
wrangler.stdout.on('data', (d) => (log += d));
wrangler.stderr.on('data', (d) => (log += d));
const stop = () => wrangler.kill();
process.on('exit', stop);

async function waitReady() {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body: '{}' });
      if (r.status) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('wrangler dev did not start:\n' + log);
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

try {
  await waitReady();
  console.log(`workerd via wrangler ${process.env.npm_package_version ?? ''} | node ${process.version} | ${process.platform} ${process.arch}\n`);
  const cases = [
    ['2-min game', { seed: 54321 }],
    ['10-min game', { seed: 4018 }],
    ['2-min stress', { seed: 54321, stress: true }],
  ];
  console.log('| scenario | ticks | score | raw JSON | workerd median | min | max | node median |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, opts] of cases) {
    const run = generateBotReplay(engine, opts);
    const body = JSON.stringify(run.replay);
    const times = [];
    let last;
    for (let i = 0; i < ITER; i++) {
      const t = performance.now();
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body });
      last = await res.json();
      times.push(performance.now() - t);
    }
    if (!last.valid || last.score !== run.score) throw new Error(`workerd result mismatch for ${name}: ${JSON.stringify(last)} vs node ${run.score}`);
    const nodeTimes = [];
    for (let i = 0; i < ITER; i++) {
      const t = performance.now();
      engine.verifyReplay(JSON.parse(body));
      nodeTimes.push(performance.now() - t);
    }
    console.log(`| ${name} | ${last.ticks} | ${last.score} | ${(body.length / 1024).toFixed(0)} KB | ${median(times).toFixed(0)} ms | ${Math.min(...times).toFixed(0)} | ${Math.max(...times).toFixed(0)} | ${median(nodeTimes).toFixed(0)} ms |`);
  }

  // Worst case for memory: the largest structurally valid body the ranked limits allow (72,000 input changes), parsed and validated
  // in full, then simulated up to the point where the ship dies and the extra inputs are found to be impossible.
  const big = generateBotReplay(engine, { seed: 4018 }).replay;
  const maxTicks = 72000;
  big.totalTicks = maxTicks;
  delete big.claimedResult;
  const lastTick = big.inputs[big.inputs.length - 1].tick;
  for (let t = lastTick + 1; t < maxTicks; t++) big.inputs.push({ tick: t, input: { rotate: (t % 7) / 7, move: 1, shoot: t % 3 === 0, steer: { heading: (t * 3.17) % 360, mode: 'assist' } } });
  const bigBody = JSON.stringify(big);
  const bigTimes = [];
  let bigLast;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body: bigBody });
    bigLast = await res.json();
    bigTimes.push(performance.now() - t);
  }
  console.log(
    `\nmax-size body: ${big.inputs.length} input changes, ${(bigBody.length / 1024 / 1024).toFixed(1)} MiB raw (ranked limit 8 MiB), ` +
      `workerd median ${median(bigTimes).toFixed(0)} ms, max ${Math.max(...bigTimes).toFixed(0)} ms, isolate survived; verdict valid=${bigLast.valid} (${bigLast.error})`,
  );
} finally {
  stop();
}
