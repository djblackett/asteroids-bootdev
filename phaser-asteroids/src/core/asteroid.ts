import {
  ASTEROID_ARCHETYPES,
  ASTEROID_ARMORED_HIT_FLASH_DURATION,
  ASTEROID_ARMORED_HIT_PARTICLES,
  ASTEROID_ARMORED_HIT_SHAKE,
  ASTEROID_DEATH_DURATION,
  ASTEROID_DEATH_DURATION_MAX,
  ASTEROID_MIN_RADIUS,
  ASTEROID_SHAKE_INTENSITY,
  PARTICLE_COUNT_LARGE,
  PARTICLE_COUNT_MEDIUM,
  PARTICLE_COUNT_SMALL,
  POINTS_LARGE_ASTEROID,
  POINTS_MEDIUM_ASTEROID,
  POINTS_SMALL_ASTEROID,
  SCREEN_HEIGHT,
  SCREEN_SHAKE_LARGE,
  SCREEN_SHAKE_MEDIUM,
  SCREEN_SHAKE_SMALL,
  SCREEN_WIDTH,
  type ArchetypeConfig,
  type AsteroidArchetype,
} from './constants';
import { normalize, rotateVec, type Vec2 } from './math';
import { uniform, type Rng } from './rng';

export type SizeCategory = 'large' | 'medium' | 'small';

export interface Asteroid {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  archetype: AsteroidArchetype;
  sizeCategory: SizeCategory;
  maxHitPoints: number;
  hitPoints: number;
  /** True during the short shake animation between "destroyed" and "splits into children". */
  dying: boolean;
  deathTimer: number;
  deathTimerReal: number;
  hitFlashTimer: number;
  /** Random jitter applied when drawing a dying asteroid. */
  shakeOffset: Vec2;
  /** False once removed from play (off-screen, or its death animation finished). */
  alive: boolean;
}

export interface DeathEffect {
  position: Vec2;
  particleCount: number;
  shakeAmount: number;
}

export interface HitResult {
  destroyed: boolean;
  /** Present for non-lethal hits (armored asteroids). */
  effect: DeathEffect | null;
}

export function sizeCategoryOf(radius: number): SizeCategory {
  if (radius >= 50) return 'large';
  if (radius >= 30) return 'medium';
  return 'small';
}

export function createAsteroid(
  x: number,
  y: number,
  radius: number,
  archetype: AsteroidArchetype = 'standard',
  velocity: Vec2 = { x: 0, y: 0 },
): Asteroid {
  const config = ASTEROID_ARCHETYPES[archetype];
  return {
    position: { x, y },
    velocity: { x: velocity.x, y: velocity.y },
    radius,
    archetype,
    sizeCategory: sizeCategoryOf(radius),
    maxHitPoints: config.hitPoints,
    hitPoints: config.hitPoints,
    dying: false,
    deathTimer: 0,
    deathTimerReal: 0,
    hitFlashTimer: 0,
    shakeOffset: { x: 0, y: 0 },
    alive: true,
  };
}

export function archetypeConfig(a: Pick<Asteroid, 'archetype'>): ArchetypeConfig {
  return ASTEROID_ARCHETYPES[a.archetype];
}

/** Score for destroying this asteroid: `int(base * archetype multiplier + archetype bonus)`. */
export function getPoints(a: Pick<Asteroid, 'sizeCategory' | 'archetype'>): number {
  const base =
    a.sizeCategory === 'large'
      ? POINTS_LARGE_ASTEROID
      : a.sizeCategory === 'medium'
        ? POINTS_MEDIUM_ASTEROID
        : POINTS_SMALL_ASTEROID;
  const config = ASTEROID_ARCHETYPES[a.archetype];
  return Math.trunc(base * config.pointsMultiplier + config.pointsBonus);
}

export function getParticleCount(a: Pick<Asteroid, 'sizeCategory'>): number {
  if (a.sizeCategory === 'large') return PARTICLE_COUNT_LARGE;
  if (a.sizeCategory === 'medium') return PARTICLE_COUNT_MEDIUM;
  return PARTICLE_COUNT_SMALL;
}

export function getScreenShakeAmount(a: Pick<Asteroid, 'sizeCategory'>): number {
  if (a.sizeCategory === 'large') return SCREEN_SHAKE_LARGE;
  if (a.sizeCategory === 'medium') return SCREEN_SHAKE_MEDIUM;
  return SCREEN_SHAKE_SMALL;
}

/**
 * Applies one hit. Armored asteroids absorb the first hit (flash + sparks, no points);
 * everything else is destroyed. Hits on an already-dying asteroid are ignored.
 */
export function takeHit(a: Asteroid): HitResult {
  if (a.dying) return { destroyed: false, effect: null };
  a.hitPoints -= 1;
  if (a.hitPoints <= 0) return { destroyed: true, effect: null };
  a.hitFlashTimer = ASTEROID_ARMORED_HIT_FLASH_DURATION;
  return {
    destroyed: false,
    effect: {
      position: { x: a.position.x, y: a.position.y },
      particleCount: ASTEROID_ARMORED_HIT_PARTICLES,
      shakeAmount: ASTEROID_ARMORED_HIT_SHAKE,
    },
  };
}

/** Python `Asteroid.split()`: starts the death animation. Returns null if already dying. */
export function beginDeath(a: Asteroid): DeathEffect | null {
  if (a.dying) return null;
  a.dying = true;
  a.deathTimer = 0;
  return {
    position: { x: a.position.x, y: a.position.y },
    particleCount: getParticleCount(a),
    shakeAmount: getScreenShakeAmount(a),
  };
}

/**
 * Two children at `radius - 20`, fanned out +/- a random 20-50 degrees with a 1.2x speed boost.
 * Armored parents produce standard children. Asteroids at minimum size do not split.
 */
export function spawnChildren(a: Asteroid, rng: Rng): Asteroid[] {
  if (a.radius <= ASTEROID_MIN_RADIUS) return [];

  const spread = uniform(rng, 20, 50);
  const v1 = rotateVec(a.velocity, spread);
  const v2 = rotateVec(a.velocity, -spread);

  const newRadius = a.radius - ASTEROID_MIN_RADIUS;
  // Offset along each child's heading so the pair does not spawn overlapping its parent.
  const offsetDistance = newRadius * 1.5;
  const o1 = normalize(v1);
  const o2 = normalize(v2);
  const archetype: AsteroidArchetype = a.archetype === 'armored' ? 'standard' : a.archetype;

  return [
    createAsteroid(
      a.position.x + o1.x * offsetDistance,
      a.position.y + o1.y * offsetDistance,
      newRadius,
      archetype,
      { x: v1.x * 1.2, y: v1.y * 1.2 },
    ),
    createAsteroid(
      a.position.x + o2.x * offsetDistance,
      a.position.y + o2.y * offsetDistance,
      newRadius,
      archetype,
      { x: v2.x * 1.2, y: v2.y * 1.2 },
    ),
  ];
}

/**
 * Advances an asteroid.
 *
 * @param dt     Game-time seconds (already scaled by difficulty / slow motion by the caller).
 * @param realDt Real seconds; caps how long the death animation can last when game time is slowed.
 * @returns Children created if the death animation finished this call.
 */
export function updateAsteroid(a: Asteroid, dt: number, realDt: number, rng: Rng): Asteroid[] {
  if (a.hitFlashTimer > 0) a.hitFlashTimer = Math.max(0, a.hitFlashTimer - dt);

  if (a.dying) {
    a.deathTimer += dt;
    a.deathTimerReal += realDt;
    a.shakeOffset = {
      x: uniform(rng, -ASTEROID_SHAKE_INTENSITY, ASTEROID_SHAKE_INTENSITY),
      y: uniform(rng, -ASTEROID_SHAKE_INTENSITY, ASTEROID_SHAKE_INTENSITY),
    };
    if (a.deathTimer >= ASTEROID_DEATH_DURATION || a.deathTimerReal >= ASTEROID_DEATH_DURATION_MAX) {
      a.alive = false;
      return spawnChildren(a, rng);
    }
    return [];
  }

  a.position.x += a.velocity.x * dt;
  a.position.y += a.velocity.y * dt;

  // Asteroids are removed once fully past any edge (they do not wrap).
  if (
    a.position.x < -a.radius ||
    a.position.x > SCREEN_WIDTH + a.radius ||
    a.position.y < -a.radius ||
    a.position.y > SCREEN_HEIGHT + a.radius
  ) {
    a.alive = false;
  }
  return [];
}
