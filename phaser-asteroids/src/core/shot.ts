import { PLAYER_SHOOT_SPEED, SCREEN_HEIGHT, SCREEN_WIDTH, SHOT_CULL_MARGIN, SHOT_RADIUS } from './constants';
import { getForwardVector, type Vec2 } from './math';

export interface Shot {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  /** Player number that fired the shot. UFO shots are a separate type (`UfoShot`) kept in their own list. */
  owner: number;
  /** Frozen at firing time. Absent on legacy/test projectiles means an ordinary bullet. */
  charged?: boolean;
  alive: boolean;
}

/** `rotationDegrees` uses the Pygame convention (0 = Down). */
export function createShot(origin: Vec2, rotationDegrees: number, owner: number, charged = false): Shot {
  const dir = getForwardVector(rotationDegrees);
  return {
    position: { x: origin.x, y: origin.y },
    velocity: { x: dir.x * PLAYER_SHOOT_SPEED, y: dir.y * PLAYER_SHOOT_SPEED },
    radius: SHOT_RADIUS,
    owner,
    charged,
    alive: true,
  };
}

export function isOutsidePlayfield(position: Vec2, margin: number): boolean {
  return (
    position.x < -margin ||
    position.x > SCREEN_WIDTH + margin ||
    position.y < -margin ||
    position.y > SCREEN_HEIGHT + margin
  );
}

/**
 * Advances a shot. Unlike the Python original, shots that leave the playfield are despawned
 * (otherwise they fly forever and stay in the collision loops).
 */
export function updateShot(shot: Pick<Shot, 'position' | 'velocity' | 'alive'>, dt: number): void {
  shot.position.x += shot.velocity.x * dt;
  shot.position.y += shot.velocity.y * dt;
  if (isOutsidePlayfield(shot.position, SHOT_CULL_MARGIN)) shot.alive = false;
}
