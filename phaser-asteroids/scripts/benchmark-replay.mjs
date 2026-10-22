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
 * Uses `toPlayerInput(toRecordedInput(input))` to ensure 100% bit-for-bit floating-point parity
 * with the replay verifier.
 */
function generateCombatReplay({ seed, forceTicks, untilGameOver = true, stressMode = false }) {
  const maxTicks = forceTicks ?? 72000;
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

  for (let tick = 0; tick < maxTicks; tick++) {
    if (!sim.isGameOver) {
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
      // Stress mode fires on every single tick, generating continuous shots and collision checks
      const shoot = stressMode ? true : tick % 4 === 0;

      const rawInput = { rotate: 0, move, shoot, boost, laser, steer };
      const effectiveInput = toPlayerInput(toRecordedInput(rawInput));

      recorder.recordTick(tick, effectiveInput, sim);
      sim.step(FIXED_DT, effectiveInput);

      if (sim.isGameOver) {
        recorder.markGameOver(sim);
        if (untilGameOver && !forceTicks) break;
      }
    } else {
      // If forceTicks is set, game over already occurred; keep ticking simulation without new inputs
      sim.step(FIXED_DT, { rotate: 0, move: 0, shoot: false });
    }
  }

  const record = recorder.exportReplay();
  if (forceTicks) {
    record.totalTicks = maxTicks;
    if (record.claimedResult) {
      record.claimedResult.totalTicks = maxTicks;
    }
  }
  return JSON.stringify(record);
}

function benchmarkRun(name, replayGenOptions) {
  console.log(`\nGenerating recording for: ${name}...`);
  const json = generateCombatReplay(replayGenOptions);
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
    const result = verifyReplay(parsed, { requireGameOver: !replayGenOptions.forceTicks });
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

console.log('========================================================================');
console.log('       Phaser Asteroids — Independent Replay Performance Benchmark      ');
console.log('========================================================================');
console.log(`Node: ${process.version} | OS: ${process.platform} ${process.arch}`);
console.log(`Simulation tick rate: ${FIXED_TICK_RATE} Hz (FIXED_DT = ${(1 / FIXED_TICK_RATE).toFixed(4)} s)`);
console.log(`Iterations per benchmark: ${ITERATIONS}\n`);

const benchmarks = [
  benchmarkRun('2-minute game', { seed: 54321, untilGameOver: true }),
  benchmarkRun('5-minute game', { seed: 98765, untilGameOver: true }),
  benchmarkRun('10-minute game', { seed: 4018, untilGameOver: true }),
  benchmarkRun('20-minute game', { seed: 4018, forceTicks: 72000 }),
  benchmarkRun('2-minute STRESS (high entity/combat count)', { seed: 54321, forceTicks: 7200, stressMode: true }),
];

console.log('\n=============================================================================================================================');
console.log('| Scenario        | Sim Time | Ticks  | Score  | JSON (Raw / Gz) | Parse | Sim Exec | Wall Avg (Min-Max) | CPU Time | Speedup |');
console.log('=============================================================================================================================');
for (const b of benchmarks) {
  const name = b.name.padEnd(15);
  const sim = `${b.durationMinutes}m`.padEnd(8);
  const ticks = String(b.totalTicks).padEnd(6);
  const score = String(b.score).padEnd(6);
  const size = `${b.rawKb}K / ${b.gzipKb}K`.padEnd(15);
  const parse = `${b.avgParseMs}ms`.padEnd(6);
  const exec = `${b.avgSimMs}ms`.padEnd(8);
  const wall = `${b.avgWallMs}ms (${b.minWallMs}-${b.maxWallMs})`.padEnd(18);
  const cpu = `${b.avgCpuMs}ms`.padEnd(8);
  const speed = b.speedup.padEnd(7);
  console.log(`| ${name} | ${sim} | ${ticks} | ${score} | ${size} | ${parse} | ${exec} | ${wall} | ${cpu} | ${speed} |`);
}
console.log('=============================================================================================================================\n');

// Output raw markdown table for docs
console.log('Markdown Table for Documentation:');
console.log('| Scenario | Simulated Time | Ticks | Verified Score | Replay Size (Raw / Gzip) | Parse Time | Sim Execution | Wall Time (Avg / Min-Max) | CPU Time | Real-Time Factor |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
for (const b of benchmarks) {
  console.log(`| **${b.name}** | ${b.durationMinutes} min | ${b.totalTicks.toLocaleString()} | ${b.score.toLocaleString()} | ${b.rawKb} KB / ${b.gzipKb} KB | ${b.avgParseMs} ms | ${b.avgSimMs} ms | ${b.avgWallMs} ms (${b.minWallMs}-${b.maxWallMs} ms) | ${b.avgCpuMs} ms | **${b.speedup} real-time** |`);
}
