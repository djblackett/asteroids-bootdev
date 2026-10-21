import { REFERENCE_FPS } from './constants';

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Pygame's `Vector2(0, 1).rotate(degrees)`.
 *
 * Screen coordinates (y points down). 0 deg = Down, 90 = Left, 180 = Up, 270 = Right.
 * Every piece of gameplay (thrust, shots, ship geometry) goes through this one function so the
 * conventions cannot drift apart.
 */
export function getForwardVector(degrees: number): Vec2 {
  const radians = degToRad(degrees);
  return { x: -Math.sin(radians), y: Math.cos(radians) };
}

/** Pygame's `Vector2.rotate(degrees)` for an arbitrary vector. */
export function rotateVec(v: Vec2, degrees: number): Vec2 {
  const r = degToRad(degrees);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

export function lengthOf(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = lengthOf(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Converts a per-frame multiplier tuned for 60 FPS (e.g. `velocity *= 0.85`) into the equivalent
 * multiplier for a frame of `dt` seconds. At dt = 1/60 this returns `perFrame` exactly.
 */
export function timeNormalizedDamping(perFrame: number, dt: number): number {
  return Math.pow(perFrame, dt * REFERENCE_FPS);
}

export interface Circle {
  position: Vec2;
  radius: number;
}

/** Same test as Python's `CircleShape.check_collision` (touching counts as a hit). */
export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy <= r * r;
}

export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Signed shortest rotation from `from` to `to`, in degrees, in (-180, 180]. Exactly opposite headings give +180 so the choice is stable. */
export function shortestAngleDelta(from: number, to: number): number {
  const d = wrap(to - from, 360);
  return d > 180 ? d - 360 : d;
}

/** Turns `current` toward `target` by the shortest way, by at most `maxStep` degrees. Never overshoots; the result is in [0, 360). */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, target);
  const step = Math.min(Math.abs(delta), Math.max(0, maxStep));
  return wrap(current + Math.sign(delta) * step, 360);
}

/**
 * The inverse of `getForwardVector`: the heading (degrees, 0 = Down, 90 = Left, 180 = Up, 270 = Right) of a screen-space direction
 * (y down). A zero vector has no direction and returns 0.
 */
export function directionToHeading(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  return wrap((Math.atan2(-x, y) * 180) / Math.PI, 360);
}
