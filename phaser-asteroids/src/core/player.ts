import {
  BOUNCE_DAMPING_PER_FRAME,
  BOUNCE_STOP_SPEED,
  BOUNDARY_BOUNCE_FORCE,
  EXHAUST_PARTICLE_SPAWN_RATE,
  PLAYER_LIVES,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_INVULNERABILITY,
  PLAYER_SHOOT_COOLDOWN,
  PLAYER_SPEED,
  PLAYER_TURN_SPEED,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from './constants';
import { getForwardVector, lengthOf, normalize, timeNormalizedDamping, wrap, type Vec2 } from './math';
import { createShot, type Shot } from './shot';

/** Per-frame control state. `rotate`/`move` are in [-1, 1]; +1 = D / W. */
export interface PlayerInput {
  rotate: number;
  move: number;
  shoot: boolean;
}

export const NO_INPUT: Readonly<PlayerInput> = { rotate: 0, move: 0, shoot: false };

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
}

export function createPlayer(x: number, y: number, playerNumber = 1, speedMultiplier = 1): PlayerState {
  return {
    playerNumber,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    radius: PLAYER_RADIUS,
    lives: PLAYER_LIVES,
    score: 0,
    speedMultiplier,
    shootTimer: 0,
    shootCooldown: PLAYER_SHOOT_COOLDOWN,
    canShoot: true,
    isRespawning: false,
    respawnTimer: 0,
    isMoving: false,
    exhaustTimer: 0,
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

function tryShoot(p: PlayerState): Shot[] {
  if (p.shootTimer > 0 || !p.canShoot) return [];
  p.shootTimer = p.shootCooldown;
  // Python spawns shots at the ship's centre, not its nose.
  return [createShot(p.position, p.rotation, p.playerNumber)];
}

/**
 * Advances the player by `dt` seconds. Order matches Python's `Player.update`:
 * timers -> residual bounce -> rotate -> translate (+ wall check) -> shoot.
 */
export function updatePlayer(p: PlayerState, input: PlayerInput, dt: number): PlayerUpdateResult {
  const result: PlayerUpdateResult = { shots: [], bounce: null, exhaust: null };
  if (p.lives <= 0) return result;

  const startX = p.position.x;
  const startY = p.position.y;

  p.shootTimer -= dt;
  p.exhaustTimer -= dt;

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

  p.isMoving = false;

  if (input.rotate !== 0) {
    p.rotation = wrap(p.rotation + input.rotate * dt * PLAYER_TURN_SPEED, 360);
  }

  if (input.move !== 0) {
    // Non-inertial: displacement only exists while the key is held.
    const forward = getForwardVector(p.rotation);
    const step = PLAYER_SPEED * p.speedMultiplier * input.move * dt;
    p.position.x += forward.x * step;
    p.position.y += forward.y * step;
    p.isMoving = true;
    // Python only checks the walls while the ship is being driven.
    result.bounce = applyBoundaryCollision(p);
  }

  if (input.shoot) result.shots = tryShoot(p);

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

export type DamageResult = 'invulnerable' | 'life_lost';

/** Python `take_damage`: respawn invulnerability absorbs the hit, otherwise a life is lost. */
export function takeDamage(p: PlayerState): DamageResult {
  if (p.isRespawning) return 'invulnerable';
  p.lives -= 1;
  return 'life_lost';
}

export function respawnPlayer(p: PlayerState, x: number, y: number): void {
  if (p.lives <= 0) return;
  p.position = { x, y };
  p.rotation = 0;
  p.velocity = { x: 0, y: 0 };
  p.motion = { x: 0, y: 0 };
  p.isRespawning = true;
  p.respawnTimer = PLAYER_RESPAWN_INVULNERABILITY;
}
