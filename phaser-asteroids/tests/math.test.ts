import { describe, expect, it } from 'vitest';
import { circlesOverlap, getForwardVector, rotateVec, timeNormalizedDamping, wrap } from '../src/core/math';

describe('getForwardVector (Pygame convention: Vector2(0, 1).rotate(angle))', () => {
  // Screen coordinates: +x is right, +y is down.
  it.each([
    [0, 0, 1, 'Down'],
    [90, -1, 0, 'Left'],
    [180, 0, -1, 'Up'],
    [270, 1, 0, 'Right'],
  ])('%i degrees points %s', (degrees, x, y) => {
    const v = getForwardVector(degrees);
    expect(v.x).toBeCloseTo(x, 10);
    expect(v.y).toBeCloseTo(y, 10);
  });

  it('agrees with rotating the Pygame unit vector (0, 1) for arbitrary angles', () => {
    for (const angle of [-725, -30, 13.5, 45, 200, 359, 1000]) {
      const a = getForwardVector(angle);
      const b = rotateVec({ x: 0, y: 1 }, angle);
      expect(a.x).toBeCloseTo(b.x, 10);
      expect(a.y).toBeCloseTo(b.y, 10);
    }
  });

  it('always returns a unit vector', () => {
    for (let angle = 0; angle < 360; angle += 7) {
      const v = getForwardVector(angle);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 10);
    }
  });

  it('turning in the positive direction rotates Down -> Left (clockwise on screen)', () => {
    const before = getForwardVector(0);
    const after = getForwardVector(10);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeGreaterThan(0);
  });
});

describe('timeNormalizedDamping', () => {
  it('equals the original per-frame factor at 60 FPS', () => {
    expect(timeNormalizedDamping(0.85, 1 / 60)).toBeCloseTo(0.85, 12);
    expect(timeNormalizedDamping(0.95, 1 / 60)).toBeCloseTo(0.95, 12);
  });

  it.each([30, 60, 120, 144, 240])('decays by the same amount per real second at %i FPS', (fps) => {
    let v = 1;
    for (let i = 0; i < fps; i++) v *= timeNormalizedDamping(0.85, 1 / fps);
    expect(v).toBeCloseTo(Math.pow(0.85, 60), 12);
  });

  it('does not decay when no time passes', () => {
    expect(timeNormalizedDamping(0.85, 0)).toBe(1);
  });
});

describe('circlesOverlap', () => {
  const c = (x: number, y: number, radius: number) => ({ position: { x, y }, radius });

  it('detects overlap and separation', () => {
    expect(circlesOverlap(c(0, 0, 10), c(15, 0, 10))).toBe(true);
    expect(circlesOverlap(c(0, 0, 10), c(25, 0, 10))).toBe(false);
  });

  it('counts exactly touching circles as colliding (Python uses <=)', () => {
    expect(circlesOverlap(c(0, 0, 10), c(20, 0, 10))).toBe(true);
    expect(circlesOverlap(c(0, 0, 10), c(20.001, 0, 10))).toBe(false);
  });

  it('works diagonally', () => {
    expect(circlesOverlap(c(0, 0, 5), c(3, 4, 0))).toBe(true); // distance exactly 5
    expect(circlesOverlap(c(0, 0, 5), c(4, 4, 0))).toBe(false);
  });
});

describe('wrap', () => {
  it('wraps negatives into range like Python %', () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(11, 10)).toBe(1);
    expect(wrap(0, 10)).toBe(0);
  });
});
