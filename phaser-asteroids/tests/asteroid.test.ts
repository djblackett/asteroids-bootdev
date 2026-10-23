import { describe, expect, it } from 'vitest';
import {
  beginDeath,
  createAsteroid,
  getPoints,
  sizeCategoryOf,
  spawnChildren,
  takeHit,
  updateAsteroid,
} from '../src/core/asteroid';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/core/constants';
import { lengthOf } from '../src/core/math';
import { seededRng } from '../src/core/rng';

const angleBetween = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  (Math.acos((a.x * b.x + a.y * b.y) / (lengthOf(a) * lengthOf(b))) * 180) / Math.PI;

describe('asteroid sizes and scoring', () => {
  it.each([
    [60, 'large'],
    [50, 'large'],
    [40, 'medium'],
    [30, 'medium'],
    [20, 'small'],
  ])('radius %i is %s', (radius, category) => {
    expect(sizeCategoryOf(radius)).toBe(category);
  });

  it.each([
    [60, 'standard', 10],
    [40, 'standard', 20],
    [20, 'standard', 50],
    // int(base * 1.5 + 10)
    [60, 'armored', 25],
    [40, 'armored', 40],
    [20, 'armored', 85],
    // Volatile points remain int(base * 1.75 + 20); blast kills use the same formula.
    [60, 'volatile', 37],
    [40, 'volatile', 55],
    [20, 'volatile', 107],
  ] as const)('radius %i %s asteroid is worth %i points', (radius, archetype, points) => {
    expect(getPoints(createAsteroid(0, 0, radius, archetype))).toBe(points);
  });
});

describe('hits and armor', () => {
  it('a standard asteroid is destroyed by one hit', () => {
    const a = createAsteroid(0, 0, 40);
    expect(takeHit(a)).toEqual({ destroyed: true, effect: null });
  });

  it('an armored asteroid survives the first hit (with a flash and sparks) and dies on the second', () => {
    const a = createAsteroid(100, 100, 60, 'armored');
    const first = takeHit(a);
    expect(first.destroyed).toBe(false);
    expect(first.effect).toMatchObject({ particleCount: 4, shakeAmount: 1 });
    expect(a.hitFlashTimer).toBeGreaterThan(0);
    expect(takeHit(a).destroyed).toBe(true);
  });

  it('ignores hits on an asteroid that is already dying', () => {
    const a = createAsteroid(0, 0, 40);
    beginDeath(a);
    expect(takeHit(a)).toEqual({ destroyed: false, effect: null });
  });

  it('beginDeath only fires once', () => {
    const a = createAsteroid(0, 0, 60);
    expect(beginDeath(a)).toMatchObject({ particleCount: 12, shakeAmount: 8 });
    expect(beginDeath(a)).toBeNull();
  });
});

describe('splitting', () => {
  const parentVelocity = { x: 60, y: 0 };

  it('a large asteroid splits into two medium ones', () => {
    const kids = spawnChildren(createAsteroid(500, 300, 60, 'standard', parentVelocity), seededRng(1));
    expect(kids.map((k) => k.radius)).toEqual([40, 40]);
  });

  it('a medium asteroid splits into two small ones', () => {
    const kids = spawnChildren(createAsteroid(500, 300, 40, 'standard', parentVelocity), seededRng(1));
    expect(kids.map((k) => k.radius)).toEqual([20, 20]);
  });

  it('a small asteroid does not split', () => {
    expect(spawnChildren(createAsteroid(500, 300, 20, 'standard', parentVelocity), seededRng(1))).toEqual([]);
  });

  it('fans the children out by the same 20-50 degree angle either side, 1.2x faster', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const [a, b] = spawnChildren(createAsteroid(500, 300, 60, 'standard', parentVelocity), seededRng(seed));
      if (!a || !b) throw new Error('expected two children');
      const spread = angleBetween(a.velocity, parentVelocity);
      expect(spread).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(spread).toBeLessThanOrEqual(50 + 1e-9);
      expect(angleBetween(b.velocity, parentVelocity)).toBeCloseTo(spread, 6);
      expect(angleBetween(a.velocity, b.velocity)).toBeCloseTo(2 * spread, 6);
      expect(lengthOf(a.velocity)).toBeCloseTo(60 * 1.2, 6);
      expect(lengthOf(b.velocity)).toBeCloseTo(60 * 1.2, 6);
    }
  });

  it('places each child 1.5 child-radii from the parent along its own heading', () => {
    const [a] = spawnChildren(createAsteroid(500, 300, 60, 'standard', parentVelocity), seededRng(7));
    if (!a) throw new Error('expected a child');
    const offset = { x: a.position.x - 500, y: a.position.y - 300 };
    expect(lengthOf(offset)).toBeCloseTo(40 * 1.5, 6);
    expect(angleBetween(offset, a.velocity)).toBeCloseTo(0, 5);
  });

  it('armored parents leave standard children; other archetypes are inherited', () => {
    const rng = seededRng(3);
    expect(spawnChildren(createAsteroid(0, 0, 60, 'armored', parentVelocity), rng).map((k) => k.archetype)).toEqual([
      'standard',
      'standard',
    ]);
    expect(spawnChildren(createAsteroid(0, 0, 60, 'volatile', parentVelocity), rng).map((k) => k.archetype)).toEqual([
      'volatile',
      'volatile',
    ]);
  });

  it('children arrive only after the 0.15 s death animation, and the parent stops moving meanwhile', () => {
    const rng = seededRng(5);
    const a = createAsteroid(500, 300, 60, 'standard', parentVelocity);
    beginDeath(a);

    let kids = updateAsteroid(a, 0.1, 0.1, rng);
    expect(kids).toEqual([]);
    expect(a.alive).toBe(true);
    expect(a.position).toEqual({ x: 500, y: 300 });

    kids = updateAsteroid(a, 0.06, 0.06, rng);
    expect(kids).toHaveLength(2);
    expect(a.alive).toBe(false);
  });

  it('the animation is capped by real time even when game time is slowed', () => {
    const a = createAsteroid(500, 300, 60, 'standard', parentVelocity);
    beginDeath(a);
    // Game time barely advances (slow motion) but 0.2 real seconds pass.
    expect(updateAsteroid(a, 0.01, 0.2, seededRng(2))).toHaveLength(2);
  });
});

describe('asteroid movement and despawn', () => {
  it('moves by velocity * dt', () => {
    const a = createAsteroid(100, 100, 40, 'standard', { x: 50, y: -20 });
    updateAsteroid(a, 0.5, 0.5, seededRng(1));
    expect(a.position).toEqual({ x: 125, y: 90 });
  });

  it.each([
    ['left', { x: -61, y: 300 }],
    ['right', { x: SCREEN_WIDTH + 61, y: 300 }],
    ['top', { x: 600, y: -61 }],
    ['bottom', { x: 600, y: SCREEN_HEIGHT + 61 }],
  ])('is removed once fully past the %s edge', (_edge, position) => {
    const a = createAsteroid(position.x, position.y, 60);
    updateAsteroid(a, 0.016, 0.016, seededRng(1));
    expect(a.alive).toBe(false);
  });

  it('survives while partially on screen', () => {
    const a = createAsteroid(-30, 300, 60);
    updateAsteroid(a, 0.016, 0.016, seededRng(1));
    expect(a.alive).toBe(true);
  });
});
