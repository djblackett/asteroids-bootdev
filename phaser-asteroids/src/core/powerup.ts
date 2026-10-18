import {
  MEGA_POWER_SPAWN_CHANCE,
  POWERUP_LIFETIME,
  POWERUP_RADIUS,
  POWERUP_SPAWN_CHANCE,
  POWERUP_SPEED,
  REVIVE_LIFETIME,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from './constants';
import { getForwardVector, type Vec2 } from './math';
import { pick, uniform, type Rng } from './rng';

export type PowerUpType = 'rapid_fire' | 'shield' | 'multi_shot' | 'slow_motion' | 'mega_power' | 'revive';

/**
 * The four ordinary drops. MEGA POWER has its own, rarer roll, and REVIVE never drops in the Python
 * game (its spawn chance constant is unused); it can only be created explicitly.
 */
export const ORDINARY_POWERUPS: readonly PowerUpType[] = ['rapid_fire', 'shield', 'multi_shot', 'slow_motion'];

export interface PowerUp {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  type: PowerUpType;
  /** Seconds left before it disappears. */
  lifetime: number;
  alive: boolean;
}

export function createPowerUp(x: number, y: number, type: PowerUpType, rng: Rng, lifetime?: number): PowerUp {
  const dir = getForwardVector(uniform(rng, 0, 360));
  return {
    position: { x, y },
    velocity: { x: dir.x * POWERUP_SPEED, y: dir.y * POWERUP_SPEED },
    radius: POWERUP_RADIUS,
    type,
    lifetime: lifetime ?? (type === 'revive' ? REVIVE_LIFETIME : POWERUP_LIFETIME),
    alive: true,
  };
}

/**
 * Drop roll for a destroyed asteroid (Python `maybe_spawn_powerup`): first a 1.5 % chance of MEGA POWER,
 * otherwise an 8 % chance of one of the four ordinary power-ups, chosen uniformly (~9.4 % overall).
 */
export function maybeSpawnPowerUp(x: number, y: number, rng: Rng): PowerUp | null {
  if (rng() < MEGA_POWER_SPAWN_CHANCE) return createPowerUp(x, y, 'mega_power', rng);
  if (rng() < POWERUP_SPAWN_CHANCE) return createPowerUp(x, y, pick(rng, ORDINARY_POWERUPS), rng);
  return null;
}

/** Drifts, ages, and wraps around the screen edges (unlike asteroids, pickups never leave the playfield). */
export function updatePowerUp(p: PowerUp, dt: number): void {
  p.position.x += p.velocity.x * dt;
  p.position.y += p.velocity.y * dt;
  p.lifetime -= dt;
  if (p.lifetime <= 0) p.alive = false;

  if (p.position.x < 0) p.position.x = SCREEN_WIDTH;
  else if (p.position.x > SCREEN_WIDTH) p.position.x = 0;
  if (p.position.y < 0) p.position.y = SCREEN_HEIGHT;
  else if (p.position.y > SCREEN_HEIGHT) p.position.y = 0;
}
