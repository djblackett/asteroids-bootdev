import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  UFO_BLINK_INTERVAL,
  UFO_CONTINUOUS_RESPAWN_TIME,
  UFO_CONTINUOUS_SPAWN_TIME,
  UFO_DIRECTION_CHANGE_MAX,
  UFO_DIRECTION_CHANGE_MIN,
  UFO_ENABLED,
  UFO_FIRST_SHOT_MAX,
  UFO_FIRST_SHOT_MIN,
  UFO_LARGE_POINTS,
  UFO_LARGE_RADIUS,
  UFO_LARGE_SHOOT_ACCURACY,
  UFO_LARGE_SHOOT_COOLDOWN,
  UFO_LARGE_SPEED,
  UFO_MAX_ACTIVE,
  UFO_SHOT_RADIUS,
  UFO_SHOT_SPEED,
  UFO_SMALL_HORIZONTAL_CHANCE,
  UFO_SMALL_POINTS,
  UFO_SMALL_RADIUS,
  UFO_SMALL_SHOOT_ACCURACY,
  UFO_SMALL_PROGRESSION,
  UFO_SMALL_SHOOT_COOLDOWN,
  UFO_SMALL_SPAWN_CHANCE,
  UFO_SMALL_SPEED,
  UFO_SMALL_WAVE_START,
  UFO_SPAWN_EDGE_MAX,
  UFO_SPAWN_EDGE_MIN,
  UFO_VELOCITY_EASE_RATE,
} from './constants';
import { getForwardVector, type Vec2 } from './math';
import { pick, uniform, type Rng } from './rng';
import { SPAWN_EDGES } from './spawner';

export type UfoType = 'large' | 'small';

export interface UfoStats {
  radius: number;
  speed: number;
  shootCooldown: number;
  /** See `UFO_LARGE_SHOOT_ACCURACY`. */
  accuracy: number;
  points: number;
}

export const UFO_STATS: Readonly<Record<UfoType, UfoStats>> = {
  large: {
    radius: UFO_LARGE_RADIUS,
    speed: UFO_LARGE_SPEED,
    shootCooldown: UFO_LARGE_SHOOT_COOLDOWN,
    accuracy: UFO_LARGE_SHOOT_ACCURACY,
    points: UFO_LARGE_POINTS,
  },
  small: {
    radius: UFO_SMALL_RADIUS,
    speed: UFO_SMALL_SPEED,
    shootCooldown: UFO_SMALL_SHOOT_COOLDOWN,
    accuracy: UFO_SMALL_SHOOT_ACCURACY,
    points: UFO_SMALL_POINTS,
  },
};

export interface Ufo {
  type: UfoType;
  position: Vec2;
  velocity: Vec2;
  /** The velocity it is easing towards; replaced every 2-4 s. */
  targetVelocity: Vec2;
  radius: number;
  speed: number;
  shootCooldown: number;
  accuracy: number;
  movementTimer: number;
  directionChangeInterval: number;
  /** Seconds until the next shot. */
  shootTimer: number;
  /** Purely cosmetic: flips every 0.3 s and drives the colour / light flicker. */
  blinkTimer: number;
  blinkState: boolean;
  /** False once destroyed. */
  alive: boolean;
  /**
   * Seconds of grace left per player (index = player number - 1) after a shield absorbed this UFO's body: while that
   * ship keeps touching the UFO it is not hit again. Reset to 0 as soon as they separate. See `UFO_SHIELD_CONTACT_GRACE`.
   */
  contactGrace: [number, number];
}

/**
 * An enemy projectile. Deliberately a different type from the player's `Shot` (and kept in its own list on the
 * sim): it never hurts UFOs, it does hurt the ship (even a boosting one) and it destroys asteroids without paying
 * anyone, exactly as in Python where UFO shots were `Shot`s owned by a UFO.
 */
export interface UfoShot {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  alive: boolean;
}

/** Python `UFO._set_random_movement`: a random heading at full speed; small UFOs often go straight left or right. */
function chooseHeading(ufo: Ufo, rng: Rng): void {
  const dir = getForwardVector(uniform(rng, 0, 360));
  ufo.targetVelocity = { x: dir.x * ufo.speed, y: dir.y * ufo.speed };
  if (ufo.type === 'small' && rng() < UFO_SMALL_HORIZONTAL_CHANCE) {
    ufo.targetVelocity = { x: pick(rng, [-1, 1]) * ufo.speed, y: 0 };
  }
}

/** The random draws happen in the Python order: direction-change interval, heading, first-shot delay. */
export function createUfo(x: number, y: number, type: UfoType, rng: Rng): Ufo {
  const stats = UFO_STATS[type];
  const ufo: Ufo = {
    type,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    targetVelocity: { x: 0, y: 0 },
    radius: stats.radius,
    speed: stats.speed,
    shootCooldown: stats.shootCooldown,
    accuracy: stats.accuracy,
    movementTimer: 0,
    directionChangeInterval: uniform(rng, UFO_DIRECTION_CHANGE_MIN, UFO_DIRECTION_CHANGE_MAX),
    shootTimer: 0,
    blinkTimer: 0,
    blinkState: false,
    alive: true,
    contactGrace: [0, 0],
  };
  chooseHeading(ufo, rng);
  ufo.shootTimer = uniform(rng, UFO_FIRST_SHOT_MIN, UFO_FIRST_SHOT_MAX);
  return ufo;
}

/**
 * Direction of a UFO shot in the Pygame convention (0 = down), aimed at `target` and then spoiled by up to
 * `180 * (1 - accuracy)` degrees either way. This is the whole of the "70 % accuracy": a small UFO (0.7) strays at
 * most 54 degrees, uniformly, and a large UFO (0.0) at most 180, i.e. it fires in a uniformly random direction.
 */
export function aimAngle(from: Vec2, target: Vec2, accuracy: number, rng: Rng): number {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return uniform(rng, 0, 360);
  const toTarget = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  const maxDeviation = 180 * (1 - accuracy);
  return toTarget + uniform(rng, -maxDeviation, maxDeviation);
}

export function createUfoShot(origin: Vec2, angleDegrees: number): UfoShot {
  const dir = getForwardVector(angleDegrees);
  return {
    position: { x: origin.x, y: origin.y },
    velocity: { x: dir.x * UFO_SHOT_SPEED, y: dir.y * UFO_SHOT_SPEED },
    radius: UFO_SHOT_RADIUS,
    alive: true,
  };
}

/**
 * Advances a UFO by `dt` seconds and returns the shot it fired, if any. `target` is where the nearest living,
 * non-respawning player is (null when there is none, in which case the UFO fires at a random point of the screen).
 * Order as in Python `UFO.update`: heading timer -> ease velocity -> move -> wrap -> shoot -> blink.
 * UFOs wrap around the screen (unlike asteroids) once they are a full radius outside it.
 */
export function updateUfo(ufo: Ufo, dt: number, target: Vec2 | null, rng: Rng): UfoShot | null {
  ufo.movementTimer += dt;
  if (ufo.movementTimer >= ufo.directionChangeInterval) {
    ufo.movementTimer = 0;
    ufo.directionChangeInterval = uniform(rng, UFO_DIRECTION_CHANGE_MIN, UFO_DIRECTION_CHANGE_MAX);
    chooseHeading(ufo, rng);
  }

  const ease = 1 - Math.exp(-UFO_VELOCITY_EASE_RATE * dt);
  ufo.velocity.x += (ufo.targetVelocity.x - ufo.velocity.x) * ease;
  ufo.velocity.y += (ufo.targetVelocity.y - ufo.velocity.y) * ease;

  const p = ufo.position;
  p.x += ufo.velocity.x * dt;
  p.y += ufo.velocity.y * dt;
  if (p.x < -ufo.radius) p.x = SCREEN_WIDTH + ufo.radius;
  else if (p.x > SCREEN_WIDTH + ufo.radius) p.x = -ufo.radius;
  if (p.y < -ufo.radius) p.y = SCREEN_HEIGHT + ufo.radius;
  else if (p.y > SCREEN_HEIGHT + ufo.radius) p.y = -ufo.radius;

  let shot: UfoShot | null = null;
  ufo.shootTimer -= dt;
  if (ufo.shootTimer <= 0) {
    ufo.shootTimer = ufo.shootCooldown;
    const aimAt = target ?? { x: uniform(rng, 0, SCREEN_WIDTH), y: uniform(rng, 0, SCREEN_HEIGHT) };
    shot = createUfoShot(p, aimAngle(p, aimAt, ufo.accuracy, rng));
  }

  ufo.blinkTimer += dt;
  if (ufo.blinkTimer >= UFO_BLINK_INTERVAL) {
    ufo.blinkTimer = 0;
    ufo.blinkState = !ufo.blinkState;
  }
  return shot;
}

// --- spawning ------------------------------------------------------------------------------------------------

export interface UfoSpawnerState {
  /** Off switch (Python `UFO_ENABLED`); tests use it to get a field with only the enemies they place. */
  enabled: boolean;
  /** Gameplay-clock time (see `SpawnerState.gameplayTimer`) of the next spawn attempt. */
  nextSpawnTime: number;
}

export function createUfoSpawner(enabled: boolean = UFO_ENABLED): UfoSpawnerState {
  return { enabled, nextSpawnTime: UFO_CONTINUOUS_SPAWN_TIME };
}

/** Python `spawn_ufo` (wave mode): from `UFO_SMALL_WAVE_START` on, 40 % small; the random draw is skipped before that. */
export function chooseUfoType(wave: number, rng: Rng): UfoType {
  return wave >= UFO_SMALL_WAVE_START && rng() < UFO_SMALL_SPAWN_CHANCE ? 'small' : 'large';
}

/** Probability that a continuous-mode spawn is a small UFO at this difficulty level (see `UFO_SMALL_PROGRESSION`). */
export function smallUfoChance(difficultyLevel: number): number {
  let chance = 0;
  for (const step of UFO_SMALL_PROGRESSION) if (difficultyLevel >= step.level) chance = step.chance;
  return chance;
}

/** Continuous-mode type roll. No random number is drawn while the chance is 0, so early games are unchanged. */
export function chooseContinuousUfoType(difficultyLevel: number, rng: Rng): UfoType {
  const chance = smallUfoChance(difficultyLevel);
  return chance > 0 && rng() < chance ? 'small' : 'large';
}

/**
 * Continuous-mode UFO schedule: the first attempt after 5 s of play, then one every 15 s counted from the moment the
 * previous attempt was made. An attempt made while `UFO_MAX_ACTIVE` UFOs are alive is simply skipped (not retried).
 * The UFO appears on a random edge, 20-80 % along it, exactly as far outside the screen as an asteroid spawn
 * (Python reuses the asteroid edge table), so it spends a moment wrapping from side to side before it flies in.
 * Neither difficulty scaling nor Slow Motion affects the timing. The *type* does follow the difficulty level: large UFOs
 * only at first, small ones from level 2 on and more and more often (`UFO_SMALL_PROGRESSION`).
 */
export function updateUfoSpawner(
  state: UfoSpawnerState,
  gameplayTimer: number,
  activeUfos: number,
  rng: Rng,
  difficultyLevel = 0,
): Ufo | null {
  if (!state.enabled || gameplayTimer < state.nextSpawnTime) return null;
  state.nextSpawnTime = gameplayTimer + UFO_CONTINUOUS_RESPAWN_TIME;
  if (activeUfos >= UFO_MAX_ACTIVE) return null;

  const type = chooseContinuousUfoType(difficultyLevel, rng);
  const edge = pick(rng, SPAWN_EDGES);
  const at = edge.point(uniform(rng, UFO_SPAWN_EDGE_MIN, UFO_SPAWN_EDGE_MAX));
  return createUfo(at.x, at.y, type, rng);
}
