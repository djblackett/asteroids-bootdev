import { createAsteroid, type Asteroid } from '../src/core/asteroid';
import type { AsteroidArchetype } from '../src/core/constants';
import { GameSim } from '../src/core/game';
import type { Vec2 } from '../src/core/math';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { createPowerUp, type PowerUp, type PowerUpType } from '../src/core/powerup';
import { seededRng, type Rng } from '../src/core/rng';

export const FRAME = 1 / 60;

/** A seeded RNG whose next few results can be forced, for exercising probability branches. */
export interface QueueRng extends Rng {
  queue(...values: number[]): void;
}

export function queueRng(seed = 1): QueueRng {
  const base = seededRng(seed);
  const pending: number[] = [];
  const rng = (() => (pending.length > 0 ? (pending.shift() as number) : base())) as QueueRng;
  rng.queue = (...values) => {
    pending.push(...values);
  };
  return rng;
}

/**
 * A sim with the random asteroid spawner switched off, so tests control exactly what is on screen.
 * Random power-up drops are off too unless `drops` is true.
 */
export function quietSim(seed = 1, rng: Rng = seededRng(seed)): GameSim {
  const sim = new GameSim({ rng, startCooldown: 0 });
  sim.spawner.spawnTimer = -1e9;
  return sim;
}

export function runFor(sim: GameSim, seconds: number, input: PlayerInput = NO_INPUT, fps = 60): void {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) sim.step(1 / fps, input);
}

export function rock(
  x: number,
  y: number,
  radius = 60,
  archetype: AsteroidArchetype = 'standard',
  velocity: Vec2 = { x: 0, y: 0 },
): Asteroid {
  return createAsteroid(x, y, radius, archetype, velocity);
}

/** Puts a pickup of `type` under the ship. */
export function pickupAtShip(sim: GameSim, type: PowerUpType): PowerUp {
  const p = createPowerUp(sim.player.position.x, sim.player.position.y, type, seededRng(3));
  p.velocity = { x: 0, y: 0 };
  sim.powerups.push(p);
  return p;
}

export const hold = (overrides: Partial<PlayerInput>): PlayerInput => ({ ...NO_INPUT, ...overrides });
