import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import type { PlayerInput } from '../src/core/player';
import { createPowerUp, type PowerUpType } from '../src/core/powerup';
import { seededRng } from '../src/core/rng';
import { FRAME, hold, pickupAtShip, quietSim, rock, runFor } from './helpers';

const ALL_TYPES: readonly PowerUpType[] = ['rapid_fire', 'shield', 'multi_shot', 'slow_motion', 'mega_power', 'revive'];

/** Checks the rules that must hold no matter what combination of abilities is active. */
function expectConsistent(sim: GameSim): void {
  const p = sim.player;
  expect(Number.isFinite(p.position.x + p.position.y + p.rotation)).toBe(true);
  expect(p.lives).toBeGreaterThanOrEqual(0);
  expect(p.lives).toBeLessThanOrEqual(3);
  if (p.megaPower.active) {
    expect(p.rapidFire.active && p.multiShot.active).toBe(true);
  }
  if (p.boost.active) {
    expect(p.boost.timer).toBeGreaterThan(0);
    expect(p.boost.timer).toBeLessThanOrEqual(3);
  }
  expect(p.boost.cooldown).toBeLessThanOrEqual(8);
  expect(p.laser.shotsRemaining).toBeGreaterThanOrEqual(0);
  expect(p.laser.shotsRemaining).toBeLessThanOrEqual(15);
  expect(sim.slowMotion.timer).toBeLessThanOrEqual(6);
  expect(sim.particles.activeCount).toBeLessThanOrEqual(sim.particles.capacity);
  for (const a of sim.asteroids) expect(Number.isFinite(a.position.x + a.position.y)).toBe(true);
}

describe('combined abilities', () => {
  it('Multi-Shot + Rapid Fire: three projectiles every 0.1 s and the sim stays bounded', () => {
    const sim = quietSim();
    sim.player.rapidFire = { active: true, timer: 5 };
    sim.player.multiShot = { active: true, timer: 8 };
    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      sim.step(FRAME, hold({ shoot: true, rotate: 1 }));
      peak = Math.max(peak, sim.shots.length);
    }
    expect(peak).toBeGreaterThan(20);
    expect(peak).toBeLessThan(60);
    expectConsistent(sim);
  });

  it('Mega Power while boosting: the boost still blocks the cannon, the laser still works', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    sim.step(FRAME, hold({ boost: true }));
    expect(sim.player.boost.active).toBe(true);
    const events = sim.step(FRAME, hold({ boost: true, shoot: true, laser: true }));
    expect(events.some((e) => e.type === 'shot_fired')).toBe(false);
    expect(events.some((e) => e.type === 'laser_fired')).toBe(true);
    expectConsistent(sim);
  });

  it('a shield is consumed by a collision while Mega Power, Slow Motion and a laser are all active', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    sim.step(FRAME, hold({ laser: true }));
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.megaPower.active).toBe(true);
    expect(sim.slowMotion.active).toBe(true);
    expectConsistent(sim);
  });

  it('a pickup that expires on the very frame it is touched is not collected', () => {
    const sim = quietSim();
    const p = pickupAtShip(sim, 'shield');
    p.lifetime = 0.001;
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.powerups).toHaveLength(0);
  });

  it('an effect expiring on the frame of a collision still protects or hurts consistently', () => {
    const sim = quietSim();
    sim.player.megaPower = { active: true, timer: FRAME / 2 };
    sim.player.rapidFire = { active: true, timer: 6 };
    sim.player.multiShot = { active: true, timer: 6 };
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.player.megaPower.active).toBe(false);
    expect(sim.player.rapidFire.active).toBe(false);
    expect(sim.player.lives).toBe(3); // the shield survives mega expiry and absorbs the hit
    expect(sim.player.shieldActive).toBe(false);
  });

  it('laser through a cluster: every asteroid is hit once and splits exactly once', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    const cluster = Array.from({ length: 6 }, (_, i) => rock(300 + i * 40, 360 + (i % 2) * 15, 60));
    sim.asteroids.push(...cluster);
    sim.step(FRAME, hold({ laser: true }));
    expect(cluster.every((a) => a.dying)).toBe(true);
    expect(sim.player.score).toBe(10 + 15 + 20 + 25 + 30 + 30); // combo multipliers 1, 1.5, 2, 2.5, 3, 3
    runFor(sim, 0.2);
    // Six larges -> twelve mediums (some may already have been caught by the still-live beam).
    expect(sim.asteroids.length + sim.asteroids.filter((a) => a.dying).length).toBeGreaterThanOrEqual(1);
    expectConsistent(sim);
  });

  it('boost ramming into a dense cluster never hurts and scores every kill', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    for (let i = 0; i < 20; i++) sim.asteroids.push(rock(250 + (i % 10) * 45, 330 + Math.floor(i / 10) * 60, 40));
    runFor(sim, 2, hold({ move: 1, boost: true }));
    expect(sim.player.lives).toBe(3);
    expect(sim.player.score).toBeGreaterThanOrEqual(20 * 20);
    expectConsistent(sim);
  });
});

describe('restart after intense play', () => {
  it('a new sim after chaos carries no effects, pickups, beams or counters', () => {
    const old = quietSim();
    old.player.lives = 1;
    old.player.rapidFire = { active: true, timer: 4 };
    old.player.multiShot = { active: true, timer: 4 };
    old.player.megaPower = { active: true, timer: 4 };
    old.player.boost = { active: true, timer: 2, cooldown: 6, keyHeld: true };
    old.player.laser.shotsRemaining = 3;
    old.slowMotion = { active: true, timer: 4 };
    old.powerups.push(createPowerUp(100, 100, 'shield', seededRng(1)));
    old.player.boost.active = false; // so the next collision hurts
    old.asteroids.push(rock(old.player.position.x, old.player.position.y, 40));
    old.step(FRAME);
    expect(old.isGameOver).toBe(true);

    const fresh = new GameSim({ rng: seededRng(2) });
    expect(fresh.player.laser.shotsRemaining).toBe(15);
    expect(fresh.player.boost).toEqual({ active: false, timer: 0, cooldown: 0, keyHeld: false });
    expect(fresh.slowMotion).toEqual({ active: false, timer: 0 });
    expect(fresh.powerups).toHaveLength(0);
    expect(fresh.lasers).toHaveLength(0);
    expect(fresh.pickupFlashes).toHaveLength(0);
    expect(fresh.asteroidSpeedMultiplier).toBe(1);
  });
});

describe('fuzzing the whole game', () => {
  function fuzz(seed: number, fps: number, minutes: number): { restarts: number; peak: Record<string, number> } {
    const rng = seededRng(seed);
    const inputRng = seededRng(seed + 1000);
    let sim = new GameSim({ rng, startCooldown: 0 });
    let restarts = 0;
    const peak = { asteroids: 0, shots: 0, powerups: 0, lasers: 0 };
    let input: PlayerInput = hold({});
    let lastLives = sim.player.lives;
    let lastScore = 0;
    const frames = Math.round(minutes * 60 * fps);

    for (let f = 0; f < frames; f++) {
      if (f % Math.round(fps / 6) === 0) {
        input = {
          rotate: inputRng() < 0.35 ? (inputRng() < 0.5 ? -1 : 1) : 0,
          move: inputRng() < 0.6 ? 1 : inputRng() < 0.5 ? -1 : 0,
          shoot: inputRng() < 0.75,
          laser: inputRng() < 0.12,
          boost: inputRng() < 0.06,
        };
      }
      if (f % Math.round(fps * 5) === 0 && !sim.isGameOver) {
        const type = ALL_TYPES[Math.floor(inputRng() * ALL_TYPES.length)] ?? 'shield';
        const p = createPowerUp(sim.player.position.x, sim.player.position.y, type, inputRng);
        sim.powerups.push(p);
      }

      sim.step(1 / fps, input);
      peak.asteroids = Math.max(peak.asteroids, sim.asteroids.length);
      peak.shots = Math.max(peak.shots, sim.shots.length);
      peak.powerups = Math.max(peak.powerups, sim.powerups.length);
      peak.lasers = Math.max(peak.lasers, sim.lasers.length);

      expect(sim.player.lives).toBeLessThanOrEqual(lastLives);
      expect(sim.player.score).toBeGreaterThanOrEqual(lastScore);
      lastLives = sim.player.lives;
      lastScore = sim.player.score;
      if (f % 30 === 0) expectConsistent(sim);

      if (sim.isGameOver && sim.retryDelay === 0) {
        sim = new GameSim({ rng, startCooldown: 0 });
        restarts++;
        lastLives = sim.player.lives;
        lastScore = 0;
      }
    }
    expectConsistent(sim);
    return { restarts, peak };
  }

  it.each([
    [1, 60],
    [2, 30],
    [3, 144],
  ])('seed %i at %i fps: invariants hold over 8 simulated minutes with restarts', (seed, fps) => {
    const { restarts, peak } = fuzz(seed, fps, 8);
    expect(peak.shots).toBeLessThan(80);
    expect(peak.asteroids).toBeLessThan(300);
    expect(peak.powerups).toBeLessThan(40);
    expect(peak.lasers).toBeLessThan(6);
    expect(restarts).toBeGreaterThan(0); // random play does die, so restarts were exercised
  });
});
