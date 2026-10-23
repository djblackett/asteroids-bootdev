// Autonomous evasion-and-combat bot that produces genuine, game-over-terminated replays for tests and benchmarks.
// The engine is injected ({ GameSim, ReplayRecorder, seededRng, toPlayerInput, toRecordedInput, FIXED_DT }) so the same
// bot runs against the TypeScript sources (vitest) and the built Node bundle (dist/node/index.js, plain Node scripts).
//
// This is test tooling. It is also exactly the kind of automated player the server cannot tell apart from a human; see
// "Remaining security limitations" in docs/leaderboard-backend.md.

const DEFAULT_CONFIG = { playerCount: 1, livesMode: 'independent', friendlyFire: false, speed: [1, 1] };

/**
 * @param engine injected replay engine
 * @param opts { seed, config?, stress?, maxTicks?, idle? }
 *   spin: sit still, sweep the cannon back and forth and fire (short games that still score)
 *   idle: skip all play so the ship is simply destroyed by the first asteroid (a very short, zero-ish score run)
 *   maxTicks: stop early; if game over was not reached the replay is an "abandoned" run
 */
export function generateBotReplay(engine, opts) {
  const { GameSim, ReplayRecorder, seededRng, toPlayerInput, toRecordedInput, FIXED_DT } = engine;
  const seed = opts.seed >>> 0;
  const config = opts.config ?? DEFAULT_CONFIG;
  const maxTicks = opts.maxTicks ?? 108000;
  const recorder = new ReplayRecorder(seed, config);
  const sim = new GameSim({ rng: seededRng(seed), config });

  for (let tick = 0; tick < maxTicks; tick++) {
    const rawInput = opts.idle
      ? { rotate: 0, move: 0, shoot: false }
      : opts.spin
        ? { rotate: tick % 240 < 120 ? 1 : -1, move: 0, shoot: true }
        : decide(sim, tick, !!opts.stress);
    const effective = toPlayerInput(toRecordedInput(rawInput));
    recorder.recordTick(tick, effective, sim);
    sim.step(FIXED_DT, effective);
    if (sim.isGameOver) {
      recorder.markGameOver(sim);
      break;
    }
  }
  return { replay: recorder.exportReplay(), score: sim.totalScore, gameOver: sim.isGameOver, ticks: recorder.ticks };
}

function decide(sim, tick, stress) {
  const px = sim.player.position.x;
  const py = sim.player.position.y;
  let dangerX = 0;
  let dangerY = 0;
  let anyDanger = false;
  let minD = Infinity;
  let closest = null;

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
        closest = a;
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
  if (px < 200) dangerX += (200 - px) / 40;
  if (px > 1080) dangerX -= (px - 1080) / 40;
  if (py < 150) dangerY += (150 - py) / 40;
  if (py > 570) dangerY -= (py - 570) / 40;

  let targetAngle = 0;
  let move = 0;
  let boost = false;
  let laser = false;
  if (minD < 120 && closest && sim.player.boost.cooldown <= 0 && tick % 2 === 0) {
    boost = true;
    move = 1;
    const rdx = closest.position.x - px;
    const rdy = closest.position.y - py;
    targetAngle = ((((Math.atan2(-rdx, rdy) * 180) / Math.PI) % 360) + 360) % 360;
  } else if (anyDanger) {
    targetAngle = ((((Math.atan2(-dangerX, dangerY) * 180) / Math.PI) % 360) + 360) % 360;
    move = 1;
    if (minD < 220 && (stress || tick % 2 === 0)) laser = true;
  }
  return { rotate: 0, move, shoot: stress ? true : tick % 4 === 0, boost, laser, steer: { mode: 'assist', heading: targetAngle } };
}
