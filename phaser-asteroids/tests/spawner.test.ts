import { describe, expect, it } from 'vitest';
import { updateAsteroid, type Asteroid } from '../src/core/asteroid';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/core/constants';
import { seededRng } from '../src/core/rng';
import { availableArchetypes, chooseArchetype, createSpawner, spawnEdgeAsteroid, updateSpawner } from '../src/core/spawner';

describe('edge spawning', () => {
  it('spawns outside the screen and heads inward (within the +/-30 degree jitter)', () => {
    const rng = seededRng(11);
    for (let i = 0; i < 400; i++) {
      const a = spawnEdgeAsteroid(0, rng);
      const { x, y } = a.position;
      const outside = x < 0 || x > SCREEN_WIDTH || y < 0 || y > SCREEN_HEIGHT;
      expect(outside).toBe(true);

      const speed = Math.hypot(a.velocity.x, a.velocity.y);
      expect(speed).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(speed).toBeLessThanOrEqual(100 + 1e-9);
      expect([20, 40, 60]).toContain(a.radius);

      // Moving inward on the axis of the edge it came from.
      if (x < 0) expect(a.velocity.x).toBeGreaterThan(0);
      else if (x > SCREEN_WIDTH) expect(a.velocity.x).toBeLessThan(0);
      else if (y < 0) expect(a.velocity.y).toBeGreaterThan(0);
      else expect(a.velocity.y).toBeLessThan(0);
    }
  });

  it('uses all four edges', () => {
    const rng = seededRng(2);
    const edges = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { x, y } = spawnEdgeAsteroid(0, rng).position;
      edges.add(x < 0 ? 'left' : x > SCREEN_WIDTH ? 'right' : y < 0 ? 'top' : 'bottom');
    }
    expect(edges.size).toBe(4);
  });

  it('reproduces the original quirk: only large asteroids survive their first update', () => {
    const rng = seededRng(99);
    const survivors = new Map<number, number>();
    const spawned = new Map<number, number>();
    for (let i = 0; i < 600; i++) {
      const a = spawnEdgeAsteroid(0, rng);
      spawned.set(a.radius, (spawned.get(a.radius) ?? 0) + 1);
      updateAsteroid(a, 1 / 60, 1 / 60, rng);
      if (a.alive) survivors.set(a.radius, (survivors.get(a.radius) ?? 0) + 1);
    }
    expect(spawned.get(20)).toBeGreaterThan(100);
    expect(spawned.get(40)).toBeGreaterThan(100);
    expect([...survivors.keys()]).toEqual([60]);
    expect(survivors.get(60)).toBe(spawned.get(60));
  });
});

describe('spawn timing', () => {
  const spawnsOver = (seconds: number, fps: number, rate = 0.5): number => {
    const state = createSpawner();
    const rng = seededRng(4);
    let count = 0;
    for (let i = 0; i < seconds * fps; i++) count += updateSpawner(state, 1 / fps, rate, rng).length;
    return count;
  };

  it('spawns at most one asteroid per frame, about one per spawn interval', () => {
    expect(spawnsOver(10, 60)).toBeGreaterThanOrEqual(18);
    expect(spawnsOver(10, 60)).toBeLessThanOrEqual(20);
  });

  it('keeps roughly the same spawn rate at 30, 60, 120 and 144 FPS', () => {
    const reference = spawnsOver(30, 60);
    for (const fps of [30, 120, 144]) {
      expect(Math.abs(spawnsOver(30, fps) - reference)).toBeLessThanOrEqual(reference * 0.08);
    }
  });

  it('spawns faster when the spawn interval shrinks', () => {
    expect(spawnsOver(10, 60, 0.2)).toBeGreaterThan(spawnsOver(10, 60, 0.5) * 2);
  });

  it('tracks play time for archetype unlocks', () => {
    const state = createSpawner();
    updateSpawner(state, 0.25, 10, seededRng(1));
    updateSpawner(state, 0.25, 10, seededRng(1));
    expect(state.gameplayTimer).toBeCloseTo(0.5, 9);
  });
});

describe('archetypes', () => {
  it('only standard asteroids exist before 45 s', () => {
    expect(availableArchetypes(0)).toEqual(['standard']);
    expect(availableArchetypes(44.9)).toEqual(['standard']);
  });

  it('armored asteroids unlock at 45 s; volatile never spawns (weight 0)', () => {
    expect(availableArchetypes(45)).toEqual(['standard', 'armored']);
    expect(availableArchetypes(10_000)).toEqual(['standard', 'armored']);
  });

  it('armored makes up about 0.35 / 1.35 of spawns once unlocked', () => {
    const rng = seededRng(8);
    let armored = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (chooseArchetype(60, rng) === 'armored') armored++;
    expect(armored / n).toBeCloseTo(0.35 / 1.35, 1);
  });

  it('never picks armored before it unlocks', () => {
    const rng = seededRng(8);
    for (let i = 0; i < 2000; i++) expect(chooseArchetype(30, rng)).toBe('standard');
  });
});

describe('integration with updateAsteroid', () => {
  it('large edge spawns eventually cross the screen and despawn', () => {
    const rng = seededRng(21);
    let a: Asteroid | undefined;
    for (let i = 0; i < 200 && !a; i++) {
      const candidate = spawnEdgeAsteroid(0, rng);
      updateAsteroid(candidate, 1 / 60, 1 / 60, rng);
      if (candidate.alive) a = candidate;
    }
    if (!a) throw new Error('no surviving asteroid');
    for (let i = 0; i < 60 * 60 && a.alive; i++) updateAsteroid(a, 1 / 60, 1 / 60, rng);
    expect(a.alive).toBe(false);
  });
});
