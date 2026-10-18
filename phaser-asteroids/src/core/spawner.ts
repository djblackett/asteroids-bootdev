import {
  ASTEROID_ARCHETYPE_SPAWN_WEIGHTS,
  ASTEROID_ARCHETYPE_TIME_UNLOCKS,
  ASTEROID_KINDS,
  ASTEROID_MAX_RADIUS,
  ASTEROID_MIN_RADIUS,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type AsteroidArchetype,
} from './constants';
import { createAsteroid, type Asteroid } from './asteroid';
import { rotateVec, type Vec2 } from './math';
import { pick, randint, uniform, type Rng } from './rng';

export interface SpawnEdge {
  /** Direction asteroids travel when entering from this edge (before the +/-30 degree jitter). */
  direction: Vec2;
  /** Spawn point for a position `t` in [0, 1] along the edge. Always `ASTEROID_MAX_RADIUS` outside. */
  point: (t: number) => Vec2;
}

export const SPAWN_EDGES: readonly SpawnEdge[] = [
  { direction: { x: 1, y: 0 }, point: (t) => ({ x: -ASTEROID_MAX_RADIUS, y: t * SCREEN_HEIGHT }) },
  { direction: { x: -1, y: 0 }, point: (t) => ({ x: SCREEN_WIDTH + ASTEROID_MAX_RADIUS, y: t * SCREEN_HEIGHT }) },
  { direction: { x: 0, y: 1 }, point: (t) => ({ x: t * SCREEN_WIDTH, y: -ASTEROID_MAX_RADIUS }) },
  { direction: { x: 0, y: -1 }, point: (t) => ({ x: t * SCREEN_WIDTH, y: SCREEN_HEIGHT + ASTEROID_MAX_RADIUS }) },
];

export interface SpawnerState {
  spawnTimer: number;
  /** Seconds of active play; gates which archetypes may spawn. */
  gameplayTimer: number;
}

export function createSpawner(): SpawnerState {
  return { spawnTimer: 0, gameplayTimer: 0 };
}

export function availableArchetypes(gameplayTimer: number): AsteroidArchetype[] {
  const available = (Object.keys(ASTEROID_ARCHETYPE_SPAWN_WEIGHTS) as AsteroidArchetype[]).filter(
    (a) => ASTEROID_ARCHETYPE_SPAWN_WEIGHTS[a] > 0 && gameplayTimer >= ASTEROID_ARCHETYPE_TIME_UNLOCKS[a],
  );
  return available.length > 0 ? available : ['standard'];
}

/** Weighted pick among the currently unlocked archetypes. */
export function chooseArchetype(gameplayTimer: number, rng: Rng): AsteroidArchetype {
  const available = availableArchetypes(gameplayTimer);
  const total = available.reduce((sum, a) => sum + ASTEROID_ARCHETYPE_SPAWN_WEIGHTS[a], 0);
  const roll = uniform(rng, 0, total);
  let running = 0;
  for (const archetype of available) {
    running += ASTEROID_ARCHETYPE_SPAWN_WEIGHTS[archetype];
    if (roll <= running) return archetype;
  }
  return available[available.length - 1] ?? 'standard';
}

/** One attempt: random edge, speed 40-100 px/s, +/-30 degree jitter, radius 20/40/60. */
export function spawnEdgeAsteroid(gameplayTimer: number, rng: Rng): Asteroid {
  const edge = pick(rng, SPAWN_EDGES);
  const speed = randint(rng, 40, 100);
  const velocity = rotateVec({ x: edge.direction.x * speed, y: edge.direction.y * speed }, randint(rng, -30, 30));
  const position = edge.point(uniform(rng, 0, 1));
  const kind = randint(rng, 1, ASTEROID_KINDS);
  return createAsteroid(position.x, position.y, ASTEROID_MIN_RADIUS * kind, chooseArchetype(gameplayTimer, rng), velocity);
}

/**
 * Continuous-mode spawner: at most one asteroid per call, once `spawnRate` seconds have elapsed
 * (the timer resets rather than carrying over, as in Python).
 *
 * Faithful quirk: edge spawn points sit exactly `ASTEROID_MAX_RADIUS` outside the screen, so a
 * radius-20 or radius-40 spawn is already past the "fully off-screen" cull test on its first
 * update and vanishes. In practice only large asteroids enter the field, at roughly a third of the
 * nominal spawn rate. This is preserved because it defines the original game's difficulty.
 */
export function updateSpawner(state: SpawnerState, dt: number, spawnRate: number, rng: Rng): Asteroid[] {
  state.gameplayTimer += dt;
  state.spawnTimer += dt;
  if (state.spawnTimer > spawnRate) {
    state.spawnTimer = 0;
    return [spawnEdgeAsteroid(state.gameplayTimer, rng)];
  }
  return [];
}
