import {
  MEGA_POWER_SPAWN_CHANCE,
  POWERUP_LIFETIME,
  POWERUP_RADIUS,
  POWERUP_SPAWN_CHANCE,
  POWERUP_SPEED,
  REVIVE_LIFETIME,
  REVIVE_SPAWN_CHANCE,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from './constants';
import { getForwardVector, type Vec2 } from './math';
import { pick, uniform, type Rng } from './rng';

export type PowerUpType = 'rapid_fire' | 'shield' | 'multi_shot' | 'slow_motion' | 'chain_lightning' | 'mega_power' | 'revive';

/**
 * The five ordinary drops. MEGA POWER has its own, rarer roll. REVIVE never dropped in the Python game (its spawn chance
 * constant is unused); here it replaces an ordinary drop only while a player is out of lives (see `chooseOrdinaryDrop`).
 */
export const ORDINARY_POWERUPS: readonly PowerUpType[] = ['rapid_fire', 'shield', 'multi_shot', 'slow_motion', 'chain_lightning'];

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
 * otherwise a 12 % chance of one of the five ordinary power-ups, chosen uniformly (~13.3 % overall).
 */
export function maybeSpawnPowerUp(x: number, y: number, rng: Rng, reviveEligible = false): PowerUp | null {
  if (rng() < MEGA_POWER_SPAWN_CHANCE) return createPowerUp(x, y, 'mega_power', rng);
  if (rng() < POWERUP_SPAWN_CHANCE) return createPowerUp(x, y, chooseOrdinaryDrop(rng, reviveEligible), rng);
  return null;
}

/**
 * The type of an ordinary drop (an asteroid's ordinary roll, or the guaranteed UFO drop): one of the five ordinary
 * power-ups, or, while a Revive is useful (`reviveEligible`), a Revive in `REVIVE_SPAWN_CHANCE` of the cases. Nothing
 * extra is drawn from `rng` when it is not eligible, so single-player games and two-player games with nobody down play
 * out exactly as before.
 */
export function chooseOrdinaryDrop(rng: Rng, reviveEligible: boolean): PowerUpType {
  const type = pick(rng, ORDINARY_POWERUPS);
  return reviveEligible && rng() < REVIVE_SPAWN_CHANCE ? 'revive' : type;
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
