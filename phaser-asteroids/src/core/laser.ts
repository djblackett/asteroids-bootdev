import { LASER_BEAM_LIFETIME, SCREEN_HEIGHT, SCREEN_WIDTH } from './constants';
import { getForwardVector, lengthOf, type Circle, type Vec2 } from './math';

/**
 * A short-lived ray from the ship's nose to the screen edge. It pierces everything on its path and
 * hits each target at most once (tracked by object identity, as Python tracks `id()`).
 */
export interface LaserBeam {
  start: Vec2;
  end: Vec2;
  /** Degrees, Pygame convention. */
  direction: number;
  /** Player number that fired it. */
  owner: number;
  timer: number;
  lifetime: number;
  hit: Set<object>;
}

/** Where a ray from `start` along `direction` degrees first reaches the screen boundary. */
export function laserEndPosition(start: Vec2, direction: number): Vec2 {
  const d = getForwardVector(direction);
  const ts: number[] = [];

  if (d.x > 0) {
    const t = (SCREEN_WIDTH - start.x) / d.x;
    if (t > 0) ts.push(t);
  } else if (d.x < 0) {
    const t = -start.x / d.x;
    if (t > 0) ts.push(t);
  }
  if (d.y > 0) {
    const t = (SCREEN_HEIGHT - start.y) / d.y;
    if (t > 0) ts.push(t);
  } else if (d.y < 0) {
    const t = -start.y / d.y;
    if (t > 0) ts.push(t);
  }

  const reach = ts.length > 0 ? Math.min(...ts) : Math.max(SCREEN_WIDTH, SCREEN_HEIGHT);
  return { x: start.x + d.x * reach, y: start.y + d.y * reach };
}

export function createLaser(start: Vec2, direction: number, owner: number): LaserBeam {
  return {
    start: { x: start.x, y: start.y },
    end: laserEndPosition(start, direction),
    direction,
    owner,
    timer: 0,
    lifetime: LASER_BEAM_LIFETIME,
    hit: new Set(),
  };
}

/** Advances the beam; returns false once it has expired (the expiring frame does no damage). */
export function updateLaser(laser: LaserBeam, dt: number): boolean {
  laser.timer += dt;
  return laser.timer < laser.lifetime;
}

/** Shortest distance from `point` to the beam segment (the projection is clamped to the segment). */
export function distanceToBeam(laser: Pick<LaserBeam, 'start' | 'end'>, point: Vec2): number {
  const lx = laser.end.x - laser.start.x;
  const ly = laser.end.y - laser.start.y;
  const length = lengthOf({ x: lx, y: ly });
  if (length === 0) return Math.hypot(point.x - laser.start.x, point.y - laser.start.y);

  const nx = lx / length;
  const ny = ly / length;
  const projection = Math.max(0, Math.min(length, (point.x - laser.start.x) * nx + (point.y - laser.start.y) * ny));
  const cx = laser.start.x + nx * projection;
  const cy = laser.start.y + ny * projection;
  return Math.hypot(point.x - cx, point.y - cy);
}

/** True the first time the beam touches `target`; later calls for the same target return false. */
export function laserHits(laser: LaserBeam, target: Circle & object): boolean {
  if (laser.hit.has(target)) return false;
  if (distanceToBeam(laser, target.position) <= target.radius) {
    laser.hit.add(target);
    return true;
  }
  return false;
}
