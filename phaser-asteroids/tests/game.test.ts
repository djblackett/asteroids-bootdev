import { describe, expect, it } from 'vitest';
import { createAsteroid } from '../src/core/asteroid';
import {
  ASTEROID_SPAWN_RATE,
  DIFFICULTY_SPAWN_RATE_MIN,
  PLAYER_LIVES,
  PLAYER_RESPAWN_X,
  PLAYER_RESPAWN_Y,
  PLAYER_START_X,
  PLAYER_START_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { seededRng } from '../src/core/rng';
import { createShot, updateShot } from '../src/core/shot';

const FRAME = 1 / 60;

/** A sim with the random asteroid spawner switched off, so tests control exactly what is on screen. */
function quietSim(seed = 1): GameSim {
  const sim = new GameSim({ rng: seededRng(seed), startCooldown: 0 });
  sim.spawner.spawnTimer = -1e9;
  return sim;
}

function runFor(sim: GameSim, seconds: number, input: PlayerInput = NO_INPUT, fps = 60): void {
  for (let i = 0; i < Math.round(seconds * fps); i++) sim.step(1 / fps, input);
}

describe('projectiles', () => {
  it('move at 500 px/s in the direction the ship faces', () => {
    const shot = createShot({ x: 100, y: 100 }, 270, 1); // facing Right
    updateShot(shot, 0.2);
    expect(shot.position.x).toBeCloseTo(200, 6);
    expect(shot.position.y).toBeCloseTo(100, 6);
  });

  it.each([
    [0, 'bottom'],
    [90, 'left'],
    [180, 'top'],
    [270, 'right'],
  ])('a shot fired at %i degrees despawns after leaving the %s edge', (rotation) => {
    const shot = createShot({ x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 }, rotation, 1);
    for (let i = 0; i < 60 * 5 && shot.alive; i++) updateShot(shot, FRAME);
    expect(shot.alive).toBe(false);
  });

  it('despawns only once it is more than 50 px outside the playfield', () => {
    const inside = createShot({ x: SCREEN_WIDTH + 49, y: 300 }, 270, 1);
    updateShot(inside, 0);
    expect(inside.alive).toBe(true);
    const outside = createShot({ x: SCREEN_WIDTH + 51, y: 300 }, 270, 1);
    updateShot(outside, 0);
    expect(outside.alive).toBe(false);
  });

  it('are removed from the simulation, so holding fire into empty space does not accumulate shots', () => {
    const sim = quietSim();
    let peak = 0;
    for (let i = 0; i < 60 * 20; i++) {
      sim.step(FRAME, { rotate: 0, move: 0, shoot: true });
      peak = Math.max(peak, sim.shots.length);
    }
    // Shots live for at most ~1.5 s on this 1280x720 field and are fired every 0.3 s.
    expect(peak).toBeLessThanOrEqual(6);
    expect(sim.shots.length).toBeLessThanOrEqual(6);
  });

  it('cannot tunnel through a small asteroid on a long frame', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 500 };
    sim.shots.push(createShot({ x: 400, y: 100 }, 270, 1));
    const small = createAsteroid(445, 100, 20); // the shot would jump from x=400 to x=450 in one 0.1 s frame
    sim.asteroids.push(small);
    sim.step(0.1);
    expect(small.dying).toBe(true);
  });
});

describe('shooting asteroids', () => {
  it('destroys a large asteroid, scores 10 and splits it into two medium ones after the death animation', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    const target = createAsteroid(PLAYER_START_X + 200, PLAYER_START_Y, 60);
    sim.asteroids.push(target);

    runFor(sim, 0.6, { rotate: 0, move: 0, shoot: true });
    expect(sim.player.score).toBe(10);
    expect(target.alive).toBe(false);
    const mediums = sim.asteroids.filter((a) => a.radius === 40);
    expect(mediums).toHaveLength(2);
    expect(sim.shots.every((s) => s.alive)).toBe(true);
  });

  it('removes the projectile that scored a hit', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.asteroids.push(createAsteroid(PLAYER_START_X + 80, PLAYER_START_Y, 40));
    const events = sim.step(FRAME, { rotate: 0, move: 0, shoot: true });
    expect(events.some((e) => e.type === 'shot_fired')).toBe(true);
    expect(sim.shots).toHaveLength(1);
    runFor(sim, 0.3);
    expect(sim.shots).toHaveLength(0);
  });

  it('a small asteroid gives 50 points and vanishes without children', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.asteroids.push(createAsteroid(PLAYER_START_X + 150, PLAYER_START_Y, 20));
    runFor(sim, 0.8, { rotate: 0, move: 0, shoot: true });
    expect(sim.player.score).toBe(50);
    expect(sim.asteroids).toHaveLength(0);
  });

  it('armored asteroids need two hits and are worth 25 points when large', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    const armored = createAsteroid(PLAYER_START_X + 200, PLAYER_START_Y, 60, 'armored');
    sim.asteroids.push(armored);

    runFor(sim, 0.45, { rotate: 0, move: 0, shoot: true });
    // First shot hits at ~0.3 s after firing (200 - 60 - 5 px at 500 px/s = 0.28 s).
    expect(sim.player.score).toBe(0);
    expect(armored.hitPoints).toBe(1);
    expect(armored.dying).toBe(false);

    // Keep firing until the second hit lands, then stop so the medium children are not shot too.
    for (let i = 0; i < 90 && !armored.dying; i++) sim.step(FRAME, { rotate: 0, move: 0, shoot: true });
    expect(armored.dying).toBe(true);
    expect(sim.player.score).toBe(25);
  });

  it('a dying asteroid cannot be shot again for extra points', () => {
    const sim = quietSim();
    const a = createAsteroid(300, 300, 60);
    sim.asteroids.push(a);
    sim.shots.push(createShot({ x: 300, y: 300 }, 0, 1), createShot({ x: 300, y: 300 }, 0, 1));
    sim.step(FRAME);
    expect(sim.player.score).toBe(10);
    expect(sim.shots).toHaveLength(1); // the second shot was not consumed by the corpse
  });

  it('fires at most one shot per cooldown and respects the start grace period', () => {
    const sim = new GameSim({ rng: seededRng(1) });
    sim.spawner.spawnTimer = -1e9;
    sim.step(FRAME, { rotate: 0, move: 0, shoot: true });
    expect(sim.shots).toHaveLength(0); // still inside the 0.2 s grace period
    runFor(sim, 0.25, { rotate: 0, move: 0, shoot: true });
    expect(sim.shots.length).toBeGreaterThanOrEqual(1);
  });
});

describe('player damage, respawn and game over', () => {
  it('ramming loses a life, respawns the ship at (320, 360) and destroys the rock without scoring', () => {
    const sim = quietSim();
    const rock = createAsteroid(PLAYER_START_X, PLAYER_START_Y, 40);
    sim.asteroids.push(rock);
    const events = sim.step(FRAME);

    expect(sim.player.lives).toBe(PLAYER_LIVES - 1);
    expect(sim.player.position).toEqual({ x: PLAYER_RESPAWN_X, y: PLAYER_RESPAWN_Y });
    expect(sim.player.isRespawning).toBe(true);
    expect(sim.player.score).toBe(0);
    expect(rock.dying).toBe(true);
    expect(events).toContainEqual({ type: 'player_hit', livesLeft: 2, source: 'asteroid', player: 1 });
    expect(sim.phase).toBe('playing');
  });

  it('is invulnerable for 2 s after respawning (rocks still break, but no life is lost)', () => {
    const sim = quietSim();
    sim.asteroids.push(createAsteroid(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);

    const second = createAsteroid(PLAYER_RESPAWN_X, PLAYER_RESPAWN_Y, 40);
    sim.asteroids.push(second);
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(second.dying).toBe(true);

    runFor(sim, 2.1);
    expect(sim.player.isRespawning).toBe(false);
    sim.asteroids.push(createAsteroid(PLAYER_RESPAWN_X, PLAYER_RESPAWN_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(1);
  });

  it('only one life is lost when several rocks overlap the ship on the same frame', () => {
    const sim = quietSim();
    sim.asteroids.push(
      createAsteroid(PLAYER_START_X, PLAYER_START_Y, 40),
      createAsteroid(PLAYER_START_X + 5, PLAYER_START_Y, 40),
      createAsteroid(PLAYER_START_X - 5, PLAYER_START_Y, 20),
    );
    sim.step(FRAME);
    expect(sim.player.lives).toBe(PLAYER_LIVES - 1);
  });

  it('ends the game when the last life is lost', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    sim.player.score = 340;
    sim.asteroids.push(createAsteroid(PLAYER_START_X, PLAYER_START_Y, 60));
    const events = sim.step(FRAME);

    expect(sim.player.lives).toBe(0);
    expect(sim.phase).toBe('gameOver');
    expect(sim.isGameOver).toBe(true);
    expect(events).toContainEqual({ type: 'game_over', score: 340, scores: [340], reason: 'all_eliminated' });
    expect(sim.retryDelay).toBeCloseTo(1.5, 6);
  });

  it('freezes the action after game over but lets the retry countdown run', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    sim.asteroids.push(createAsteroid(PLAYER_START_X, PLAYER_START_Y, 60));
    sim.step(FRAME);
    const frozen = sim.time;

    sim.asteroids.push(createAsteroid(900, 300, 60, 'standard', { x: -100, y: 0 }));
    const before = { ...sim.asteroids[sim.asteroids.length - 1]!.position };
    runFor(sim, 1);
    expect(sim.time).toBe(frozen);
    expect(sim.asteroids[sim.asteroids.length - 1]!.position).toEqual(before);
    expect(sim.retryDelay).toBeGreaterThan(0);
    expect(sim.retryDelay).toBeLessThan(0.6);

    runFor(sim, 1);
    expect(sim.retryDelay).toBe(0);
  });

  it('ignores controls after game over', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    sim.asteroids.push(createAsteroid(PLAYER_START_X, PLAYER_START_Y, 60));
    sim.step(FRAME);
    const shotsBefore = sim.shots.length;
    runFor(sim, 0.5, { rotate: 1, move: 1, shoot: true });
    expect(sim.shots.length).toBe(shotsBefore);
  });

  it('a new GameSim is a clean restart: full lives, zero score, empty field, running clock', () => {
    const old = quietSim();
    old.player.lives = 1;
    old.player.score = 999;
    old.asteroids.push(createAsteroid(PLAYER_START_X, PLAYER_START_Y, 60));
    old.step(FRAME);
    expect(old.isGameOver).toBe(true);

    const fresh = new GameSim({ rng: seededRng(2) });
    expect(fresh.phase).toBe('playing');
    expect(fresh.player.lives).toBe(PLAYER_LIVES);
    expect(fresh.player.score).toBe(0);
    expect(fresh.asteroids).toHaveLength(0);
    expect(fresh.shots).toHaveLength(0);
    expect(fresh.time).toBe(0);
    expect(fresh.asteroidSpeedMultiplier).toBe(1);
    expect(fresh.asteroidSpawnRate).toBe(ASTEROID_SPAWN_RATE);
    expect(fresh.player.position).toEqual({ x: PLAYER_START_X, y: PLAYER_START_Y });
    fresh.step(FRAME);
    expect(fresh.time).toBeCloseTo(FRAME, 9);
  });
});

describe('difficulty progression', () => {
  it('every 30 s asteroids are 15% faster and spawn 0.05 s sooner', () => {
    const sim = quietSim();
    sim.player.lives = 99;
    runFor(sim, 30.1);
    expect(sim.asteroidSpeedMultiplier).toBeCloseTo(1.15, 6);
    expect(sim.asteroidSpawnRate).toBeCloseTo(0.45, 6);
    runFor(sim, 30);
    expect(sim.asteroidSpeedMultiplier).toBeCloseTo(1.3, 6);
    expect(sim.asteroidSpawnRate).toBeCloseTo(0.4, 6);
  });

  it('the spawn interval never drops below 0.2 s', () => {
    const sim = quietSim();
    sim.player.lives = 99;
    sim.asteroidSpawnRate = 0.21;
    runFor(sim, 95);
    expect(sim.asteroidSpawnRate).toBe(DIFFICULTY_SPAWN_RATE_MIN);
  });

  it('progresses on real time regardless of frame rate', () => {
    for (const fps of [30, 144]) {
      const sim = quietSim();
      runFor(sim, 31, NO_INPUT, fps);
      expect(sim.asteroidSpeedMultiplier).toBeCloseTo(1.15, 6);
    }
  });

  it('faster asteroids really move faster', () => {
    const sim = quietSim();
    sim.asteroidSpeedMultiplier = 2;
    const a = createAsteroid(100, 100, 60, 'standard', { x: 50, y: 0 });
    sim.asteroids.push(a);
    sim.step(0.1);
    expect(a.position.x).toBeCloseTo(100 + 50 * 0.1 * 2, 6);
  });
});

describe('frame time handling', () => {
  it('ignores zero and negative frame times', () => {
    const sim = quietSim();
    sim.step(0);
    sim.step(-1);
    expect(sim.time).toBe(0);
  });

  it('clamps huge frames (e.g. after a stalled tab) to 0.1 s', () => {
    const sim = quietSim();
    sim.step(30);
    expect(sim.time).toBeCloseTo(0.1, 9);
  });

  it('a single long frame matches many short ones for player movement', () => {
    const a = quietSim();
    const b = quietSim();
    a.player.rotation = 270;
    b.player.rotation = 270;
    a.step(0.1, { rotate: 0, move: 1, shoot: false });
    for (let i = 0; i < 6; i++) b.step(0.1 / 6, { rotate: 0, move: 1, shoot: false });
    expect(a.player.position.x).toBeCloseTo(b.player.position.x, 6);
  });
});

describe('starfield parallax', () => {
  it('stays still while the ship is stationary', () => {
    const sim = quietSim();
    runFor(sim, 1);
    expect(sim.starfield.cameraOffset).toEqual({ x: 0, y: 0 });
  });

  it('scrolls with normal flight (the Python version only reacted to wall bounces)', () => {
    const sim = quietSim();
    sim.player.rotation = 270; // Right
    runFor(sim, 1, { rotate: 0, move: 1, shoot: false });
    expect(sim.starfield.cameraOffset.x).toBeCloseTo(300, 3);
    expect(sim.starfield.cameraOffset.y).toBeCloseTo(0, 6);
  });

  it('moves distant layers less than near ones and in the opposite direction to the ship', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    const stars = sim.starfield.stars;
    const far = stars.find((s) => s.layer === 0)!;
    const near = stars.find((s) => s.layer === 2)!;
    const farBefore = sim.starfield.project(far);
    const nearBefore = sim.starfield.project(near);
    runFor(sim, 0.2, { rotate: 0, move: 1, shoot: false });
    const farDx = sim.starfield.project(far).x - farBefore.x;
    const nearDx = sim.starfield.project(near).x - nearBefore.x;
    const wrapFix = (d: number) => (Math.abs(d) > SCREEN_WIDTH / 2 ? d - Math.sign(d) * SCREEN_WIDTH : d);
    expect(wrapFix(nearDx)).toBeLessThan(0);
    expect(wrapFix(farDx)).toBeLessThan(0);
    expect(Math.abs(wrapFix(nearDx))).toBeGreaterThan(Math.abs(wrapFix(farDx)) * 3);
  });

  it('stops scrolling when the ship is pinned against a wall', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: SCREEN_WIDTH - 100, y: 300 };
    runFor(sim, 1, { rotate: 0, move: 1, shoot: false });
    const settled = sim.starfield.cameraOffset.x;
    runFor(sim, 1, { rotate: 0, move: 1, shoot: false });
    expect(Math.abs(sim.starfield.cameraOffset.x - settled)).toBeLessThan(2);
  });

  it('keeps every star on screen', () => {
    const sim = quietSim();
    sim.starfield.scroll({ x: -123456.7, y: 98765.4 });
    for (const star of sim.starfield.stars) {
      const { x, y } = sim.starfield.project(star);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(SCREEN_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(SCREEN_HEIGHT);
    }
  });
});

describe('long-run stability', () => {
  it('stays bounded and consistent over ten minutes of random play with spawning enabled', () => {
    const sim = new GameSim({ rng: seededRng(1234), startCooldown: 0 });
    sim.player.lives = 10_000; // survive; we are testing for leaks and NaNs
    const rng = seededRng(5);
    let peakAsteroids = 0;
    let peakShots = 0;
    for (let i = 0; i < 60 * 600; i++) {
      const input: PlayerInput = {
        rotate: rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0,
        move: rng() < 0.6 ? 1 : rng() < 0.5 ? -1 : 0,
        shoot: rng() < 0.7,
      };
      sim.step(FRAME, input);
      peakAsteroids = Math.max(peakAsteroids, sim.asteroids.length);
      peakShots = Math.max(peakShots, sim.shots.length);
    }
    expect(Number.isFinite(sim.player.position.x + sim.player.position.y)).toBe(true);
    expect(peakShots).toBeLessThan(40);
    expect(peakAsteroids).toBeLessThan(400);
    expect(sim.particles.activeCount).toBeLessThanOrEqual(sim.particles.capacity);
    expect(sim.player.score).toBeGreaterThan(0);
  });
});
