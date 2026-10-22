// Replay performance benchmarking in Node: measures independent replay verification
// throughput, CPU time, memory usage, and serialized replay sizes for representative
// runs (2 min, 5 min, 10 min, 20 min) and stressful combat scenarios.
//
// Usage:
//   node scripts/benchmark-replay.mjs

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  FIXED_DT,
  FIXED_TICK_RATE,
  GameSim,
  ReplayRecorder,
  seededRng,
  toPlayerInput,
  toRecordedInput,
  validateReplayStructure,
  verifyReplay,
} from '../dist/node/index.js';

const ITERATIONS = 3;

/**
 * Generates an authentic gameplay recording using an autonomous evasion and combat bot.
 * Runs until `sim.isGameOver` becomes true and immediately finalizes recording.
 */
function generateCombatReplay({ seed, stressMode = false, targetTicks }) {
  const config = {
    playerCount: 1,
    livesMode: 'independent',
    friendlyFire: false,
    speed: [1, 1],
  };

  const recorder = new ReplayRecorder(seed, config);
  const sim = new GameSim({
    rng: seededRng(seed),
    config,
  });

  const maxTicks = targetTicks ?? 108000;

  for (let tick = 0; tick < maxTicks; tick++) {
    const px = sim.player.position.x;
    const py = sim.player.position.y;
    let dangerX = 0;
    let dangerY = 0;
    let anyDanger = false;
    let minD = Infinity;
    let closestAst = null;

    for (const a of sim.asteroids) {
      if (!a.alive || a.dying) continue;
      const dx = px - a.position.x;
      const dy = py - a.position.y;
      const d = Math.hypot(dx, dy);
      if (d < 300) {
        anyDanger = true;
        const force = (300 - d) / (d + 1);
        dangerX += (dx / d) * force;
        dangerY += (dy / d) * force;
        if (d < minD) {
          minD = d;
          closestAst = a;
        }
      }
    }

    for (const u of sim.ufos) {
      if (!u.alive) continue;
      const dx = px - u.position.x;
      const dy = py - u.position.y;
      const d = Math.hypot(dx, dy);
      if (d < 300) {
        anyDanger = true;
        dangerX += (dx / d) * 2;
        dangerY += (dy / d) * 2;
        if (d < minD) minD = d;
      }
    }

    for (const s of sim.ufoShots) {
      if (!s.alive) continue;
      const dx = px - s.position.x;
      const dy = py - s.position.y;
      const d = Math.hypot(dx, dy);
      if (d < 150) {
        anyDanger = true;
        dangerX += (dx / d) * 4;
        dangerY += (dy / d) * 4;
      }
    }

    // Screen boundary repulsion
    if (px < 200) dangerX += (200 - px) / 40;
    if (px > 1080) dangerX -= (px - 1080) / 40;
    if (py < 150) dangerY += (150 - py) / 40;
    if (py > 570) dangerY -= (py - 570) / 40;

    let targetAngle = 0;
    let move = 0;
    let boost = false;
    let laser = false;

    if (minD < 120 && closestAst && sim.player.boost.cooldown <= 0 && tick % 2 === 0) {
      // Boost ram
      boost = true;
      move = 1.0;
      const rdx = closestAst.position.x - px;
      const rdy = closestAst.position.y - py;
      targetAngle = ((((Math.atan2(-rdx, rdy) * 180) / Math.PI) % 360) + 360) % 360;
    } else if (anyDanger) {
      targetAngle = ((((Math.atan2(-dangerX, dangerY) * 180) / Math.PI) % 360) + 360) % 360;
      move = 1.0;
      if (minD < 220 && (stressMode || tick % 2 === 0)) laser = true;
    }

    const steer = { mode: 'assist', heading: targetAngle };
    const shoot = stressMode ? true : tick % 4 === 0;

    const rawInput = { rotate: 0, move, shoot, boost, laser, steer };
    const effectiveInput = toPlayerInput(toRecordedInput(rawInput));

    recorder.recordTick(tick, effectiveInput, sim);
    sim.step(FIXED_DT, effectiveInput);

    if (sim.isGameOver) {
      recorder.markGameOver(sim);
      break;
    }
  }

  return { json: JSON.stringify(recorder.exportReplay()), gameOverTick: recorder.ticks - 1 };
}

function benchmarkCompletedGame(name, options) {
  console.log(`\nGenerating authentic recording for: ${name}...`);
  const { json, gameOverTick } = generateCombatReplay(options);
  const rawBytes = Buffer.byteLength(json, 'utf8');
  const gzipBytes = zlib.gzipSync(Buffer.from(json, 'utf8')).byteLength;

  const wallTimes = [];
  const cpuTimes = [];
  const parseTimes = [];
  const simTimes = [];
  let finalResult = null;
  let heapDeltaMb = 0;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    if (global.gc) global.gc();

    const memBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const t0 = performance.now();

    // 1. Parse & validate
    const parsed = JSON.parse(json);
    const struct = validateReplayStructure(parsed);
    if (!struct.ok) throw new Error(`Validation failed: ${struct.error}`);
    const t1 = performance.now();

    // 2. Simulate & verify
    const result = verifyReplay(parsed, { requireGameOver: true });
    if (!result.valid) {
      throw new Error(`Verification failed: ${result.error}`);
    }
    const t2 = performance.now();

    const cpuDiff = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage().heapUsed;

    const wallTotal = t2 - t0;
    const cpuTotalMs = (cpuDiff.user + cpuDiff.system) / 1000;
    const parseMs = t1 - t0;
    const simMs = t2 - t1;

    wallTimes.push(wallTotal);
    cpuTimes.push(cpuTotalMs);
    parseTimes.push(parseMs);
    simTimes.push(simMs);
    finalResult = result;
    heapDeltaMb = Math.max(0, (memAfter - memBefore) / (1024 * 1024));
  }

  const avgWall = wallTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
  const minWall = Math.min(...wallTimes);
  const maxWall = Math.max(...wallTimes);
  const avgCpu = cpuTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
  const avgParse = parseTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
  const avgSim = simTimes.reduce((a, b) => a + b, 0) / ITERATIONS;

  const simulatedSeconds = finalResult.totalTicks / FIXED_TICK_RATE;
  const realTimeMultiplier = Math.round(simulatedSeconds / (avgWall / 1000));

  return {
    name,
    category: 'Authentic Game (Completed)',
    durationMinutes: (simulatedSeconds / 60).toFixed(1),
    totalTicks: finalResult.totalTicks,
    score: finalResult.calculatedScore,
    rawKb: (rawBytes / 1024).toFixed(1),
    gzipKb: (gzipBytes / 1024).toFixed(1),
    avgWallMs: avgWall.toFixed(1),
    minWallMs: minWall.toFixed(1),
    maxWallMs: maxWall.toFixed(1),
    avgCpuMs: avgCpu.toFixed(1),
    avgParseMs: avgParse.toFixed(2),
    avgSimMs: avgSim.toFixed(1),
    speedup: `${realTimeMultiplier}x`,
    heapDeltaMb: heapDeltaMb.toFixed(2),
  };
}

/**
 * Benchmarks a pure 72,000-tick (20-minute) synthetic simulation workload to measure
 * engine execution throughput, CPU consumption, and memory stability at scale without
 * falsely presenting it as a completed game run.
 */
function benchmarkSyntheticWorkload(name, totalTicks = 72000, seed = 4018) {
  console.log(`\nRunning synthetic simulation benchmark: ${name} (${totalTicks} ticks)...`);
  const wallTimes = [];
  const cpuTimes = [];
  let heapDeltaMb = 0;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    if (global.gc) global.gc();

    const memBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const t0 = performance.now();

    const sim = new GameSim({ rng: seededRng(seed) });
    for (let t = 0; t < totalTicks; t++) {
      const raw = { rotate: Math.sin(t * 0.01), move: 0.5, shoot: t % 4 === 0 };
      const inp = toPlayerInput(toRecordedInput(raw));
      sim.step(FIXED_DT, inp);
    }

    const t1 = performance.now();
    const cpuDiff = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage().heapUsed;

    const wallTotal = t1 - t0;
    const cpuTotalMs = (cpuDiff.user + cpuDiff.system) / 1000;
    wallTimes.push(wallTotal);
    cpuTimes.push(cpuTotalMs);
    heapDeltaMb = Math.max(0, (memAfter - memBefore) / (1024 * 1024));
  }

  const avgWall = wallTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
  const minWall = Math.min(...wallTimes);
  const maxWall = Math.max(...wallTimes);
  const avgCpu = cpuTimes.reduce((a, b) => a + b, 0) / ITERATIONS;

  const simulatedSeconds = totalTicks / FIXED_TICK_RATE;
  const realTimeMultiplier = Math.round(simulatedSeconds / (avgWall / 1000));

  return {
    name,
    category: 'Synthetic Workload',
    durationMinutes: (simulatedSeconds / 60).toFixed(1),
    totalTicks,
    score: 'N/A (Synthetic)',
    rawKb: 'N/A',
    gzipKb: 'N/A',
    avgWallMs: avgWall.toFixed(1),
    minWallMs: minWall.toFixed(1),
    maxWallMs: maxWall.toFixed(1),
    avgCpuMs: avgCpu.toFixed(1),
    avgParseMs: '0.00',
    avgSimMs: avgWall.toFixed(1),
    speedup: `${realTimeMultiplier}x`,
    heapDeltaMb: heapDeltaMb.toFixed(2),
  };
}

console.log('========================================================================');
console.log('       Phaser Asteroids — Independent Replay Performance Benchmark      ');
console.log('========================================================================');
console.log(`Node: ${process.version} | OS: ${process.platform} ${process.arch}`);
console.log(`Simulation tick rate: ${FIXED_TICK_RATE} Hz (FIXED_DT = ${(1 / FIXED_TICK_RATE).toFixed(4)} s)`);
console.log(`Iterations per benchmark: ${ITERATIONS}\n`);

const benchmarks = [
  benchmarkCompletedGame('2-minute game', { seed: 54321 }),
  benchmarkCompletedGame('5-minute game', { seed: 98765 }),
  benchmarkCompletedGame('10-minute game', { seed: 4018 }),
  benchmarkCompletedGame('2-minute STRESS (high entity/combat count)', { seed: 54321, stressMode: true }),
  benchmarkSyntheticWorkload('20-minute SYNTHETIC (72k active sim ticks)', 72000, 4018),
];

console.log('\n=======================================================================================================================================');
console.log('| Scenario                                  | Type      | Sim Time | Ticks  | Score  | JSON (Raw / Gz) | Sim Exec | Wall Avg (Min-Max) | Speedup |');
console.log('=======================================================================================================================================');
for (const b of benchmarks) {
  const name = b.name.padEnd(41);
  const type = (b.category.includes('Authentic') ? 'Authentic' : 'Synthetic').padEnd(9);
  const sim = `${b.durationMinutes}m`.padEnd(8);
  const ticks = String(b.totalTicks).padEnd(6);
  const score = String(b.score).padEnd(6);
  const size = (b.rawKb === 'N/A' ? 'N/A (In-memory)' : `${b.rawKb}K / ${b.gzipKb}K`).padEnd(17);
  const exec = `${b.avgSimMs}ms`.padEnd(8);
  const wall = `${b.avgWallMs}ms (${b.minWallMs}-${b.maxWallMs})`.padEnd(18);
  const speed = b.speedup.padEnd(7);
  console.log(`| ${name} | ${type} | ${sim} | ${ticks} | ${score} | ${size} | ${exec} | ${wall} | ${speed} |`);
}
console.log('=======================================================================================================================================\n');

// Output raw markdown table for docs
console.log('Markdown Table for Documentation:');
console.log('| Scenario | Category | Simulated Time | Ticks | Verified Score | Replay Size (Raw / Gzip) | Parse Time | Sim Execution | Wall Time (Avg / Min-Max) | CPU Time | Real-Time Factor |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
for (const b of benchmarks) {
  const size = b.rawKb === 'N/A' ? 'N/A (Synthetic in-memory)' : `${b.rawKb} KB / ${b.gzipKb} KB`;
  console.log(`| **${b.name}** | ${b.category} | ${b.durationMinutes} min | ${b.totalTicks.toLocaleString()} | ${b.score.toLocaleString()} | ${size} | ${b.avgParseMs} ms | ${b.avgSimMs} ms | ${b.avgWallMs} ms (${b.minWallMs}-${b.maxWallMs} ms) | ${b.avgCpuMs} ms | **${b.speedup} real-time** |`);
}
