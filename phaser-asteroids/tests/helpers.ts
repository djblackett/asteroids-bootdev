import { createAsteroid, type Asteroid } from '../src/core/asteroid';
import type { AsteroidArchetype } from '../src/core/constants';
import { GameSim, type SimEvent } from '../src/core/game';
import type { GameConfig } from '../src/core/gameConfig';
import type { Vec2 } from '../src/core/math';
import { NO_INPUT, type PlayerInput, type PlayerState } from '../src/core/player';
import { createPowerUp, type PowerUp, type PowerUpType } from '../src/core/powerup';
import { seededRng, type Rng } from '../src/core/rng';
import type { Shot } from '../src/core/shot';
import type { Ufo, UfoShot, UfoType } from '../src/core/ufo';

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
 * A sim with the random asteroid spawner and the UFO schedule switched off, so tests control exactly what is on
 * screen (add enemies with `sim.spawnUfo`). Random power-up drops are off too unless `drops` is true.
 */
export function quietSim(seed = 1, rng: Rng = seededRng(seed)): GameSim {
  const sim = new GameSim({ rng, startCooldown: 0, ufos: false });
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

/** A stationary player shot of the normal size. */
export function shotAt(x: number, y: number, vx = 0, vy = 0): Shot {
  return { position: { x, y }, velocity: { x: vx, y: vy }, radius: 5, owner: 1, alive: true };
}

/** A resting enemy projectile. */
export function ufoShotAt(x: number, y: number, vx = 0, vy = 0): UfoShot {
  return { position: { x, y }, velocity: { x: vx, y: vy }, radius: 6, alive: true };
}

/**
 * Queues one kill: a small (radius-20, so it never splits) asteroid with a shot on top of it. Positions cycle through
 * twelve columns far from the ship so consecutive kills never overlap a rock that is still dying.
 */
export function queueKill(sim: GameSim, index: number, archetype: AsteroidArchetype = 'standard'): Asteroid {
  const x = 60 + (index % 12) * 100;
  const target = rock(x, 100, 20, archetype);
  sim.asteroids.push(target);
  sim.shots.push(shotAt(x, 100));
  return target;
}

/** Steps one frame with a kill queued first, and returns that frame's events. */
export function killOne(sim: GameSim, index: number): SimEvent[] {
  queueKill(sim, index);
  return sim.step(FRAME);
}

export function eventsOfType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Array<Extract<SimEvent, { type: T }>> {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Collects every event over several frames. */
export function collectEvents(sim: GameSim, seconds: number, input: PlayerInput = NO_INPUT, fps = 60): SimEvent[] {
  const all: SimEvent[] = [];
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) all.push(...sim.step(1 / fps, input));
  return all;
}

/** A UFO that stays put and stays quiet, for collision and audio tests. */
export function parkedUfoFor(sim: GameSim, type: UfoType, x: number, y: number): Ufo {
  const ufo = sim.spawnUfo(type, x, y);
  ufo.shootTimer = 1e9;
  ufo.movementTimer = -1e9;
  ufo.targetVelocity = { x: 0, y: 0 };
  return ufo;
}

/** A two-player sim with the asteroid spawner and UFO schedule off (see `quietSim`). */
export function quietCoop(config: Partial<GameConfig> = {}, seed = 1, rng: Rng = seededRng(seed)): GameSim {
  const sim = new GameSim({ rng, startCooldown: 0, ufos: false, config: { playerCount: 2, ...config } });
  sim.spawner.spawnTimer = -1e9;
  return sim;
}

/** A resting player shot fired by player `owner`. */
export function shotBy(owner: number, x: number, y: number, vx = 0, vy = 0): Shot {
  return { position: { x, y }, velocity: { x: vx, y: vy }, radius: 5, owner, alive: true };
}

/** A stationary pickup of `type` at a point. */
export function pickupAt(sim: GameSim, type: PowerUpType, x: number, y: number): PowerUp {
  const p = createPowerUp(x, y, type, seededRng(3));
  p.velocity = { x: 0, y: 0 };
  sim.powerups.push(p);
  return p;
}

/** Drops a small rock on `player` and steps one frame: one asteroid hit (shield / protection / life, as the rules say). */
export function crashInto(sim: GameSim, player: PlayerState): SimEvent[] {
  sim.asteroids.push(rock(player.position.x, player.position.y, 20));
  return sim.step(FRAME);
}

/** Removes respawn protection so the next hit counts, then hits. */
export function hitUnprotected(sim: GameSim, player: PlayerState): SimEvent[] {
  player.isRespawning = false;
  player.shieldActive = false;
  return crashInto(sim, player);
}

/** Hits `player` until they are out of lives (or the run ends). */
export function knockOut(sim: GameSim, player: PlayerState): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < 20 && player.lives > 0 && !sim.isGameOver; i++) all.push(...hitUnprotected(sim, player));
  return all;
}
