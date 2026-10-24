import {
  ASSIST_TRAVEL_TURN_SPEED,
  CHAIN_LIGHTNING_DURATION,
  BOOST_COOLDOWN,
  BOOST_DURATION,
  BOOST_SPEED_MULTIPLIER,
  BOUNCE_DAMPING_PER_FRAME,
  BOUNCE_STOP_SPEED,
  BOUNDARY_BOUNCE_FORCE,
  EXHAUST_PARTICLE_SPAWN_RATE,
  LASER_BEAM_COOLDOWN,
  LASER_BEAM_MAX_SHOTS,
  MEGA_POWER_DURATION,
  MULTI_SHOT_ANGLE_SPREAD,
  MULTI_SHOT_DURATION,
  PLAYER_LIVES,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_INVULNERABILITY,
  PLAYER_SHOOT_COOLDOWN,
  PLAYER_SPEED,
  PLAYER_TURN_SPEED,
  RAPID_FIRE_COOLDOWN,
  RAPID_FIRE_DURATION,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TOUCH_STEER_TURN_SPEED,
} from './constants';
import { createLaser, type LaserBeam } from './laser';
import { getForwardVector, lengthOf, normalize, timeNormalizedDamping, turnToward, wrap, type Vec2 } from './math';
import { createShot, type Shot } from './shot';

/**
 * Per-frame control state. `rotate`/`move` are in [-1, 1]; +1 = D / W. `laser` and `boost` are
 * "key is held" flags; the player turns them into one activation per key press.
 */
export interface PlayerInput {
  rotate: number;
  move: number;
  shoot: boolean;
  laser?: boolean;
  boost?: boolean;
  /**
   * Touch joystick "point" request (Point-to-Fly / Assisted Flight). Absent for the keyboard, gamepads and the Classic D-pad, which
   * leaves the ship's movement exactly as it always was. See `SteerRequest`.
   */
  steer?: SteerRequest;
}

/**
 * "Turn toward this heading" instead of "rotate left / right". The ship turns by the shortest way at TOUCH_STEER_TURN_SPEED and flies
 * (`move` > 0) at its normal speed:
 *   point:  along its nose, so it curves while it turns (Point-to-Fly).
 *   assist: along a travel direction that chases the heading at ASSIST_TRAVEL_TURN_SPEED, ahead of the nose (Assisted Flight).
 * `rotate` from another device wins: a pressed key beats the stick for the nose.
 */
export interface SteerRequest {
  /** Desired heading in degrees, Pygame convention (0 = Down, 90 = Left, 180 = Up, 270 = Right). */
  heading: number;
  mode: 'point' | 'assist';
}

export const NO_INPUT: Readonly<PlayerInput> = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };

/** A power-up effect with a countdown. */
export interface TimedEffect {
  active: boolean;
  timer: number;
}

export interface PlayerState {
  playerNumber: number;
  position: Vec2;
  /** Residual boundary-bounce velocity (px/s). Normal flight never touches this. */
  velocity: Vec2;
  /** Degrees, Pygame convention: 0 = Down, 90 = Left, 180 = Up, 270 = Right. */
  rotation: number;
  radius: number;
  lives: number;
  score: number;
  speedMultiplier: number;

  shootTimer: number;
  shootCooldown: number;
  canShoot: boolean;

  isRespawning: boolean;
  respawnTimer: number;

  isMoving: boolean;
  exhaustTimer: number;
  /**
   * Assisted Flight's direction of travel (same convention as `rotation`), while the stick is engaged; null otherwise. Cleared the
   * moment the stick is released, so the next push starts from the stick's own direction. Unused by every other control.
   */
  travelHeading: number | null;

  rapidFire: TimedEffect;
  multiShot: TimedEffect;
  chainLightning: TimedEffect;
  /** While active, Rapid Fire and Multi-Shot are held on by it and their own timers are paused. */
  megaPower: TimedEffect;
  /** Absorbs exactly one hit; has no duration. */
  shieldActive: boolean;

  boost: TimedEffect & { cooldown: number; keyHeld: boolean };
  laser: { shotsRemaining: number; cooldown: number; keyHeld: boolean };

  /** Distance the ship actually travelled during the last update, per second (drives parallax). */
  motion: Vec2;
}

export interface BounceInfo {
  /** Ship position after the clamp. */
  position: Vec2;
  /** Unit vector pointing away from the wall(s) that were hit. */
  direction: Vec2;
}

export interface ExhaustInfo {
  position: Vec2;
  /** Unit vector pointing backwards out of the ship. */
  direction: Vec2;
}

export interface PlayerUpdateResult {
  shots: Shot[];
  bounce: BounceInfo | null;
  exhaust: ExhaustInfo | null;
  laser: LaserBeam | null;
  boostStarted: boolean;
}

export function createPlayer(x: number, y: number, playerNumber = 1, speedMultiplier = 1, lives = PLAYER_LIVES): PlayerState {
  return {
    playerNumber,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    radius: PLAYER_RADIUS,
    lives,
    score: 0,
    speedMultiplier,
    shootTimer: 0,
    shootCooldown: PLAYER_SHOOT_COOLDOWN,
    canShoot: true,
    isRespawning: false,
    respawnTimer: 0,
    isMoving: false,
    exhaustTimer: 0,
    travelHeading: null,
    rapidFire: { active: false, timer: 0 },
    multiShot: { active: false, timer: 0 },
    chainLightning: { active: false, timer: 0 },
    megaPower: { active: false, timer: 0 },
    shieldActive: false,
    boost: { active: false, timer: 0, cooldown: 0, keyHeld: false },
    laser: { shotsRemaining: LASER_BEAM_MAX_SHOTS, cooldown: 0, keyHeld: false },
    motion: { x: 0, y: 0 },
  };
}

/**
 * Ship outline as three world-space vertices (nose, then the two rear corners). Mirrors the
 * Python `Player.triangle()` so rendering and gameplay share one definition of "forward".
 */
export function shipTriangle(p: Pick<PlayerState, 'position' | 'rotation' | 'radius'>): [Vec2, Vec2, Vec2] {
  const forward = getForwardVector(p.rotation);
  const side = getForwardVector(p.rotation + 90);
  const sideScale = p.radius / 1.5;
  const fx = forward.x * p.radius;
  const fy = forward.y * p.radius;
  const rx = side.x * sideScale;
  const ry = side.y * sideScale;
  return [
    { x: p.position.x + fx, y: p.position.y + fy },
    { x: p.position.x - fx - rx, y: p.position.y - fy - ry },
    { x: p.position.x - fx + rx, y: p.position.y - fy + ry },
  ];
}

/**
 * Clamps the ship inside the playfield and, if a wall was hit, sets the bounce velocity.
 * Direct port of `Player.check_boundary_collision`.
 */
export function applyBoundaryCollision(p: PlayerState): BounceInfo | null {
  const dir = { x: 0, y: 0 };
  let bounced = false;

  if (p.position.x - p.radius < 0) {
    p.position.x = p.radius;
    dir.x = 1;
    bounced = true;
  }
  if (p.position.x + p.radius > SCREEN_WIDTH) {
    p.position.x = SCREEN_WIDTH - p.radius;
    dir.x = -1;
    bounced = true;
  }
  if (p.position.y - p.radius < 0) {
    p.position.y = p.radius;
    dir.y = 1;
    bounced = true;
  }
  if (p.position.y + p.radius > SCREEN_HEIGHT) {
    p.position.y = SCREEN_HEIGHT - p.radius;
    dir.y = -1;
    bounced = true;
  }

  if (!bounced) return null;
  const n = normalize(dir);
  p.velocity = { x: n.x * BOUNDARY_BOUNCE_FORCE, y: n.y * BOUNDARY_BOUNCE_FORCE };
  return { position: { x: p.position.x, y: p.position.y }, direction: n };
}

/** Shot headings for one trigger pull: a single shot, or a -15 / 0 / +15 degree fan with Multi-Shot. */
export function shotAngleOffsets(multiShot: boolean): readonly number[] {
  return multiShot ? [-MULTI_SHOT_ANGLE_SPREAD, 0, MULTI_SHOT_ANGLE_SPREAD] : [0];
}

function tryShoot(p: PlayerState): Shot[] {
  if (p.shootTimer > 0 || !p.canShoot) return [];
  if (p.boost.active) return []; // no shooting while boosting
  // Python spawns shots at the ship's centre, not its nose.
  const shots = shotAngleOffsets(p.multiShot.active).map((offset) =>
    createShot(p.position, p.rotation + offset, p.playerNumber, p.chainLightning.active),
  );
  p.shootTimer = p.rapidFire.active ? RAPID_FIRE_COOLDOWN : p.shootCooldown;
  return shots;
}

export function activateRapidFire(p: PlayerState): void {
  p.rapidFire = { active: true, timer: RAPID_FIRE_DURATION };
}

export function activateMultiShot(p: PlayerState): void {
  p.multiShot = { active: true, timer: MULTI_SHOT_DURATION };
}

export function activateShield(p: PlayerState): void {
  p.shieldActive = true;
}

export function activateChainLightning(p: PlayerState): void {
  p.chainLightning = { active: true, timer: CHAIN_LIGHTNING_DURATION };
}

/** MEGA POWER: Rapid Fire + Multi-Shot + Shield, all for the mega duration. (The caller adds Slow Motion.) */
export function activateMegaPower(p: PlayerState): void {
  p.megaPower = { active: true, timer: MEGA_POWER_DURATION };
  p.rapidFire = { active: true, timer: MEGA_POWER_DURATION };
  p.multiShot = { active: true, timer: MEGA_POWER_DURATION };
  p.shieldActive = true;
}

/** Starts a boost if one is not already running or cooling down. The cooldown starts immediately. */
export function activateBoost(p: PlayerState): boolean {
  if (p.boost.cooldown > 0 || p.boost.active) return false;
  p.boost.active = true;
  p.boost.timer = BOOST_DURATION;
  p.boost.cooldown = BOOST_COOLDOWN;
  return true;
}

/** Fires the laser from the ship's nose if it has charges and is off cooldown. */
export function fireLaser(p: PlayerState): LaserBeam | null {
  if (p.laser.cooldown > 0 || p.laser.shotsRemaining <= 0) return null;
  const forward = getForwardVector(p.rotation);
  const tip = { x: p.position.x + forward.x * p.radius, y: p.position.y + forward.y * p.radius };
  p.laser.cooldown = LASER_BEAM_COOLDOWN;
  p.laser.shotsRemaining -= 1;
  return createLaser(tip, p.rotation, p.playerNumber);
}

/**
 * Advances the player by `dt` seconds. Order matches Python's `Player.update`:
 * timers -> residual bounce -> power-up timers -> rotate -> translate (+ wall check) -> shoot -> laser -> boost.
 */
export function updatePlayer(p: PlayerState, input: PlayerInput, dt: number): PlayerUpdateResult {
  const result: PlayerUpdateResult = { shots: [], bounce: null, exhaust: null, laser: null, boostStarted: false };
  if (p.lives <= 0) return result;

  const startX = p.position.x;
  const startY = p.position.y;

  p.shootTimer -= dt;
  p.exhaustTimer -= dt;
  if (p.laser.cooldown > 0) p.laser.cooldown -= dt;

  if (p.boost.active) {
    p.boost.timer -= dt;
    if (p.boost.timer <= 0) p.boost.active = false;
  }
  if (p.boost.cooldown > 0) p.boost.cooldown -= dt;

  if (p.isRespawning) {
    p.respawnTimer -= dt;
    if (p.respawnTimer <= 0) p.isRespawning = false;
  }

  // Residual bounce: Euler step, then time-normalised decay (Python: velocity *= 0.85 per frame).
  if (p.velocity.x !== 0 || p.velocity.y !== 0) {
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    const damping = timeNormalizedDamping(BOUNCE_DAMPING_PER_FRAME, dt);
    p.velocity.x *= damping;
    p.velocity.y *= damping;
    if (lengthOf(p.velocity) < BOUNCE_STOP_SPEED) p.velocity = { x: 0, y: 0 };
  }

  // MEGA POWER ending switches Rapid Fire and Multi-Shot off whatever else was going on; the shield stays.
  if (p.megaPower.active) {
    p.megaPower.timer -= dt;
    if (p.megaPower.timer <= 0) {
      p.megaPower.active = false;
      p.rapidFire.active = false;
      p.multiShot.active = false;
    }
  }
  if (p.rapidFire.active && !p.megaPower.active) {
    p.rapidFire.timer -= dt;
    if (p.rapidFire.timer <= 0) p.rapidFire.active = false;
  }
  if (p.multiShot.active && !p.megaPower.active) {
    p.multiShot.timer -= dt;
    if (p.multiShot.timer <= 0) p.multiShot.active = false;
  }
  if (p.chainLightning.active) {
    p.chainLightning.timer = Math.max(0, p.chainLightning.timer - dt);
    if (p.chainLightning.timer <= 0) p.chainLightning.active = false;
  }

  p.isMoving = false;

  // A pressed key (or any other rotate command) beats the touch stick's heading request.
  const steer = input.rotate === 0 ? input.steer : undefined;
  if (steer) {
    p.rotation = turnToward(p.rotation, steer.heading, TOUCH_STEER_TURN_SPEED * dt);
  } else if (input.rotate !== 0) {
    p.rotation = wrap(p.rotation + input.rotate * dt * PLAYER_TURN_SPEED, 360);
  }

  // Assisted Flight: the direction of travel chases the stick, faster than the nose can. A push from rest (or after a release) starts
  // already pointing the stick's way; there is no momentum to keep. Any frame without an engaged assist request forgets it.
  if (steer?.mode === 'assist' && input.move > 0) {
    p.travelHeading =
      p.travelHeading === null ? steer.heading : turnToward(p.travelHeading, steer.heading, ASSIST_TRAVEL_TURN_SPEED * dt);
  } else {
    p.travelHeading = null;
  }

  if (input.move !== 0) {
    // Non-inertial: displacement only exists while the key is held.
    const forward = getForwardVector(p.travelHeading ?? p.rotation);
    const step = PLAYER_SPEED * p.speedMultiplier * (p.boost.active ? BOOST_SPEED_MULTIPLIER : 1) * input.move * dt;
    p.position.x += forward.x * step;
    p.position.y += forward.y * step;
    p.isMoving = true;
    // Python only checks the walls while the ship is being driven.
    result.bounce = applyBoundaryCollision(p);
  }

  if (input.shoot) result.shots = tryShoot(p);

  // Laser and boost fire once per key press; a press that is refused (cooldown, no charges) is still
  // "used up", so the key has to be released and pressed again.
  if (input.laser && !p.laser.keyHeld) {
    result.laser = fireLaser(p);
    p.laser.keyHeld = true;
  } else if (!input.laser) {
    p.laser.keyHeld = false;
  }

  if (input.boost && !p.boost.keyHeld) {
    result.boostStarted = activateBoost(p);
    p.boost.keyHeld = true;
  } else if (!input.boost) {
    p.boost.keyHeld = false;
  }

  if (p.isMoving && p.exhaustTimer <= 0) {
    p.exhaustTimer = EXHAUST_PARTICLE_SPAWN_RATE;
    const forward = getForwardVector(p.rotation);
    const backward = { x: -forward.x, y: -forward.y };
    result.exhaust = {
      position: { x: p.position.x + backward.x * p.radius, y: p.position.y + backward.y * p.radius },
      direction: backward,
    };
  }

  p.motion = dt > 0 ? { x: (p.position.x - startX) / dt, y: (p.position.y - startY) / dt } : { x: 0, y: 0 };
  return result;
}

/** `invulnerable`: respawn protection (shield untouched). `shield`: shield consumed. `life_lost`: a life is gone. */
export type DamageResult = 'invulnerable' | 'shield' | 'life_lost';

/** Python `take_damage`, in the same order: respawn invulnerability first, then the shield, then a life. */
export function takeDamage(p: PlayerState): DamageResult {
  if (p.isRespawning) return 'invulnerable';
  if (p.shieldActive) {
    p.shieldActive = false;
    return 'shield';
  }
  p.lives -= 1;
  return 'life_lost';
}

/** Moves the ship to the spawn point with 2 s of invulnerability and clears every power-up and any boost. */
export function respawnPlayer(p: PlayerState, x: number, y: number): void {
  if (p.lives <= 0) return;
  p.position = { x, y };
  p.rotation = 0;
  p.velocity = { x: 0, y: 0 };
  p.motion = { x: 0, y: 0 };
  p.travelHeading = null;
  p.isRespawning = true;
  p.respawnTimer = PLAYER_RESPAWN_INVULNERABILITY;

  p.rapidFire = { active: false, timer: 0 };
  p.multiShot = { active: false, timer: 0 };
  p.chainLightning = { active: false, timer: 0 };
  p.megaPower = { active: false, timer: 0 };
  p.shieldActive = false;
  // Boost stops but its cooldown keeps running; laser charges are not refilled.
  p.boost.active = false;
  p.boost.timer = 0;
}

/**
 * A ship that has lost its last life while its teammate plays on. It stops acting and is not drawn; everything timed is
 * cleared so no stale shield, boost or power-up shows (or counts) while it is out. Score, laser charges and the boost
 * cooldown are kept for a possible Revive.
 */
export function eliminatePlayer(p: PlayerState): void {
  p.velocity = { x: 0, y: 0 };
  p.motion = { x: 0, y: 0 };
  p.travelHeading = null;
  p.isRespawning = false;
  p.respawnTimer = 0;
  p.isMoving = false;
  p.rapidFire = { active: false, timer: 0 };
  p.multiShot = { active: false, timer: 0 };
  p.chainLightning = { active: false, timer: 0 };
  p.megaPower = { active: false, timer: 0 };
  p.shieldActive = false;
  p.boost.active = false;
  p.boost.timer = 0;
}
