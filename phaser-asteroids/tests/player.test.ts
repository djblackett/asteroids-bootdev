import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_BOUNCE_FORCE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_TURN_SPEED,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from '../src/core/constants';
import { getForwardVector } from '../src/core/math';
import {
  createPlayer,
  NO_INPUT,
  respawnPlayer,
  shipTriangle,
  takeDamage,
  updatePlayer,
  type PlayerInput,
  type PlayerState,
} from '../src/core/player';

const FRAME = 1 / 60;
const drive = (overrides: Partial<PlayerInput>): PlayerInput => ({ ...NO_INPUT, ...overrides });

/** Runs `seconds` of simulation at the given frame rate and returns the player. */
function run(p: PlayerState, input: PlayerInput, seconds: number, fps = 60): PlayerState {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) updatePlayer(p, input, dt);
  return p;
}

describe('player rotation', () => {
  it('turns at 300 degrees per second', () => {
    const p = createPlayer(640, 360);
    run(p, drive({ rotate: 1 }), 0.2);
    expect(p.rotation).toBeCloseTo(0.2 * PLAYER_TURN_SPEED, 6);
  });

  it('turns the other way with negative input and wraps into [0, 360)', () => {
    const p = createPlayer(640, 360);
    run(p, drive({ rotate: -1 }), 0.1);
    expect(p.rotation).toBeCloseTo(360 - 30, 6);
    expect(p.rotation).toBeGreaterThanOrEqual(0);
    expect(p.rotation).toBeLessThan(360);
  });

  it('does not move the ship', () => {
    const p = createPlayer(640, 360);
    run(p, drive({ rotate: 1 }), 1);
    expect(p.position).toEqual({ x: 640, y: 360 });
  });
});

describe('player translation', () => {
  it.each([
    [0, 0, 1],
    [90, -1, 0],
    [180, 0, -1],
    [270, 1, 0],
  ])('facing %i degrees, forward thrust moves (%i, %i) at 300 px/s', (rotation, dx, dy) => {
    const p = createPlayer(640, 360);
    p.rotation = rotation;
    run(p, drive({ move: 1 }), 0.5);
    expect(p.position.x - 640).toBeCloseTo(dx * PLAYER_SPEED * 0.5, 4);
    expect(p.position.y - 360).toBeCloseTo(dy * PLAYER_SPEED * 0.5, 4);
  });

  it('reverse moves the opposite way at the same speed', () => {
    const p = createPlayer(640, 360);
    p.rotation = 180; // facing Up
    run(p, drive({ move: -1 }), 0.5);
    expect(p.position.x).toBeCloseTo(640, 4);
    expect(p.position.y).toBeCloseTo(360 + PLAYER_SPEED * 0.5, 4);
  });

  it('stops immediately when thrust is released (no inertia)', () => {
    const p = createPlayer(640, 360);
    p.rotation = 270;
    run(p, drive({ move: 1 }), 0.3);
    const stopped = { ...p.position };
    run(p, NO_INPUT, 1);
    expect(p.position).toEqual(stopped);
    expect(p.velocity).toEqual({ x: 0, y: 0 });
  });

  it('applies the speed multiplier', () => {
    const p = createPlayer(640, 360, 1, 2);
    p.rotation = 270;
    run(p, drive({ move: 1 }), 0.25);
    expect(p.position.x - 640).toBeCloseTo(PLAYER_SPEED * 2 * 0.25, 4);
  });

  it('covers the same distance at every frame rate', () => {
    for (const fps of [30, 60, 120, 144]) {
      const p = createPlayer(100, 360);
      p.rotation = 270;
      run(p, drive({ move: 1 }), 1, fps);
      expect(p.position.x - 100).toBeCloseTo(PLAYER_SPEED, 3);
    }
  });
});

describe('ship geometry', () => {
  it('puts the nose where the forward vector points, for all four cardinal headings', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const p = createPlayer(500, 300);
      p.rotation = rotation;
      const [nose] = shipTriangle(p);
      const f = getForwardVector(rotation);
      expect(nose.x).toBeCloseTo(500 + f.x * PLAYER_RADIUS, 6);
      expect(nose.y).toBeCloseTo(300 + f.y * PLAYER_RADIUS, 6);
    }
  });

  it('faces Down at the default rotation (as in the Python game)', () => {
    const [nose, a, b] = shipTriangle(createPlayer(500, 300));
    expect(nose.y).toBeGreaterThan(300);
    expect(a.y).toBeLessThan(300);
    expect(b.y).toBeLessThan(300);
  });
});

describe('boundary collision and bounce', () => {
  const wallCases: Array<[string, number, number, number, (p: PlayerState) => number, number]> = [
    // name, start x, start y, rotation, coordinate to check, expected clamped value
    ['left', 30, 360, 90, (p) => p.position.x, PLAYER_RADIUS],
    ['right', SCREEN_WIDTH - 30, 360, 270, (p) => p.position.x, SCREEN_WIDTH - PLAYER_RADIUS],
    ['top', 640, 30, 180, (p) => p.position.y, PLAYER_RADIUS],
    ['bottom', 640, SCREEN_HEIGHT - 30, 0, (p) => p.position.y, SCREEN_HEIGHT - PLAYER_RADIUS],
  ];

  it.each(wallCases)('clamps at the %s wall and reports a bounce', (_name, x, y, rotation, coord, expected) => {
    const p = createPlayer(x, y);
    p.rotation = rotation;
    let bounced = false;
    for (let i = 0; i < 30; i++) bounced ||= updatePlayer(p, drive({ move: 1 }), FRAME).bounce !== null;
    expect(bounced).toBe(true);
    // Each frame ends with the clamp, so a ship that keeps pushing sits exactly on the limit.
    expect(coord(p)).toBeCloseTo(expected, 9);
    expect(p.position.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
    expect(p.position.x).toBeLessThanOrEqual(SCREEN_WIDTH - PLAYER_RADIUS + 1e-9);
    expect(p.position.y).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
    expect(p.position.y).toBeLessThanOrEqual(SCREEN_HEIGHT - PLAYER_RADIUS + 1e-9);
  });

  it('sets a 150 px/s impulse pointing away from the wall', () => {
    const p = createPlayer(PLAYER_RADIUS + 1, 360);
    p.rotation = 90; // Left
    const result = updatePlayer(p, drive({ move: 1 }), FRAME);
    expect(result.bounce?.direction).toEqual({ x: 1, y: 0 });
    expect(p.position.x).toBe(PLAYER_RADIUS);
    expect(p.velocity.x).toBeCloseTo(BOUNDARY_BOUNCE_FORCE, 9);
    expect(p.velocity.y).toBeCloseTo(0, 9);
  });

  it('uses a normalised diagonal impulse in a corner', () => {
    const p = createPlayer(PLAYER_RADIUS + 1, PLAYER_RADIUS + 1);
    p.rotation = 135; // Up-Left
    const result = updatePlayer(p, drive({ move: 1 }), FRAME);
    expect(result.bounce).not.toBeNull();
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(BOUNDARY_BOUNCE_FORCE, 6);
    expect(p.velocity.x).toBeGreaterThan(0);
    expect(p.velocity.y).toBeGreaterThan(0);
  });

  it('keeps sliding briefly after the key is released, then comes to rest', () => {
    const p = createPlayer(PLAYER_RADIUS + 1, 360);
    p.rotation = 90;
    updatePlayer(p, drive({ move: 1 }), FRAME);
    const atWall = p.position.x;

    updatePlayer(p, NO_INPUT, FRAME);
    expect(p.position.x).toBeGreaterThan(atWall); // still recovering

    run(p, NO_INPUT, 3);
    expect(p.velocity).toEqual({ x: 0, y: 0 });
    const rest = { ...p.position };
    run(p, NO_INPUT, 1);
    expect(p.position).toEqual(rest);
  });

  it('matches the Python 60 FPS bounce recovery distance (~16.7 px)', () => {
    const p = createPlayer(PLAYER_RADIUS + 1, 360);
    p.rotation = 90;
    updatePlayer(p, drive({ move: 1 }), FRAME);
    const atWall = p.position.x;
    run(p, NO_INPUT, 5);
    // sum of 150/60 * 0.85^k for k = 0.. = 2.5 / 0.15
    expect(p.position.x - atWall).toBeCloseTo(2.5 / 0.15, 1);
  });

  it('recovers a similar distance at 30, 120 and 144 FPS (frame-rate independent damping)', () => {
    const distanceAt = (fps: number): number => {
      const p = createPlayer(PLAYER_RADIUS + 1, 360);
      p.rotation = 90;
      updatePlayer(p, drive({ move: 1 }), 1 / fps);
      const atWall = p.position.x;
      run(p, NO_INPUT, 5, fps);
      return p.position.x - atWall;
    };
    const reference = distanceAt(60);
    for (const fps of [30, 120, 144, 240]) {
      expect(Math.abs(distanceAt(fps) - reference) / reference).toBeLessThan(0.1);
    }
  });

  it('does not check walls while the ship is not being driven (Python quirk)', () => {
    const p = createPlayer(5, 360); // already overlapping the left wall
    run(p, NO_INPUT, 0.5);
    expect(p.position.x).toBe(5);
  });
});

describe('shooting', () => {
  it('fires a shot from the ship in its facing direction at 500 px/s', () => {
    const p = createPlayer(640, 360);
    p.rotation = 270;
    const { shots } = updatePlayer(p, drive({ shoot: true }), FRAME);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.velocity.x).toBeCloseTo(500, 6);
    expect(shots[0]?.velocity.y).toBeCloseTo(0, 6);
    expect(shots[0]?.owner).toBe(1);
  });

  it('enforces the 0.3 s cooldown', () => {
    const p = createPlayer(640, 360);
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += updatePlayer(p, drive({ shoot: true }), FRAME).shots.length;
    // One second of held fire = shots at t=0, ~0.3, ~0.6, ~0.9.
    expect(fired).toBe(4);
  });

  it('fires at the same rate regardless of frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const p = createPlayer(640, 360);
      let fired = 0;
      for (let i = 0; i < fps * 3; i++) fired += updatePlayer(p, drive({ shoot: true }), 1 / fps).shots.length;
      expect(fired).toBeGreaterThanOrEqual(9);
      expect(fired).toBeLessThanOrEqual(10);
    }
  });

  it('cannot fire while the start grace period is active', () => {
    const p = createPlayer(640, 360);
    p.canShoot = false;
    expect(updatePlayer(p, drive({ shoot: true }), FRAME).shots).toHaveLength(0);
    p.canShoot = true;
    expect(updatePlayer(p, drive({ shoot: true }), FRAME).shots).toHaveLength(1);
  });
});

describe('damage and respawn', () => {
  it('loses a life when hit', () => {
    const p = createPlayer(640, 360);
    expect(takeDamage(p)).toBe('life_lost');
    expect(p.lives).toBe(2);
  });

  it('respawn places the ship, resets heading and grants 2 s of invulnerability', () => {
    const p = createPlayer(900, 100);
    p.rotation = 123;
    p.velocity = { x: 50, y: 50 };
    respawnPlayer(p, 320, 360);
    expect(p.position).toEqual({ x: 320, y: 360 });
    expect(p.rotation).toBe(0);
    expect(p.velocity).toEqual({ x: 0, y: 0 });
    expect(p.isRespawning).toBe(true);

    expect(takeDamage(p)).toBe('invulnerable');
    expect(p.lives).toBe(3);

    run(p, NO_INPUT, 1.9);
    expect(p.isRespawning).toBe(true);
    run(p, NO_INPUT, 0.2);
    expect(p.isRespawning).toBe(false);
    expect(takeDamage(p)).toBe('life_lost');
  });

  it('invulnerability lasts 2 s of real time at any frame rate', () => {
    for (const fps of [30, 144]) {
      const p = createPlayer(0, 0);
      respawnPlayer(p, 320, 360);
      run(p, NO_INPUT, 1.95, fps);
      expect(p.isRespawning).toBe(true);
      run(p, NO_INPUT, 0.1, fps);
      expect(p.isRespawning).toBe(false);
    }
  });

  it('a dead ship cannot respawn or act', () => {
    const p = createPlayer(640, 360);
    p.lives = 0;
    respawnPlayer(p, 320, 360);
    expect(p.position).toEqual({ x: 640, y: 360 });
    const result = updatePlayer(p, drive({ move: 1, shoot: true }), FRAME);
    expect(result.shots).toHaveLength(0);
    expect(p.position).toEqual({ x: 640, y: 360 });
  });
});
