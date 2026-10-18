import { describe, expect, it } from 'vitest';
import {
  MULTI_SHOT_ANGLE_SPREAD,
  PLAYER_RESPAWN_X,
  PLAYER_RESPAWN_Y,
  PLAYER_START_X,
  PLAYER_START_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { getForwardVector } from '../src/core/math';
import {
  createPlayer,
  shotAngleOffsets,
  takeDamage,
  updatePlayer,
} from '../src/core/player';
import { createPowerUp, maybeSpawnPowerUp, updatePowerUp } from '../src/core/powerup';
import { seededRng } from '../src/core/rng';
import { FRAME, hold, pickupAtShip, queueRng, quietSim, rock, runFor } from './helpers';

describe('power-up drops', () => {
  it('a roll under 1.5% drops MEGA POWER', () => {
    const rng = queueRng();
    rng.queue(0.0149);
    expect(maybeSpawnPowerUp(100, 100, rng)?.type).toBe('mega_power');
  });

  it('otherwise a roll under 8% drops one of the four ordinary types, picked uniformly', () => {
    const types = [];
    for (const pick of [0.0, 0.26, 0.51, 0.76]) {
      const rng = queueRng();
      rng.queue(0.5 /* not mega */, 0.0799 /* drops */, pick /* which one */);
      types.push(maybeSpawnPowerUp(0, 0, rng)?.type);
    }
    expect(types).toEqual(['rapid_fire', 'shield', 'multi_shot', 'slow_motion']);
  });

  it('does not drop on a roll of 8% or more', () => {
    const rng = queueRng();
    rng.queue(0.5, 0.08);
    expect(maybeSpawnPowerUp(0, 0, rng)).toBeNull();
  });

  it('never drops Revive, and matches the original odds over many rolls (~9.4% overall, 1.5% mega)', () => {
    const rng = seededRng(42);
    const counts: Record<string, number> = {};
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const drop = maybeSpawnPowerUp(0, 0, rng);
      if (drop) counts[drop.type] = (counts[drop.type] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total / n).toBeCloseTo(0.015 + 0.985 * 0.08, 2);
    expect((counts['mega_power'] ?? 0) / n).toBeCloseTo(0.015, 2);
    expect(counts['revive']).toBeUndefined();
    for (const t of ['rapid_fire', 'shield', 'multi_shot', 'slow_motion']) {
      expect((counts[t] ?? 0) / n).toBeCloseTo((0.985 * 0.08) / 4, 2);
    }
  });
});

describe('power-up entity', () => {
  it('has radius 15, drifts at 30 px/s and lasts 12 s (Revive 15 s)', () => {
    const p = createPowerUp(100, 100, 'shield', seededRng(1));
    expect(p.radius).toBe(15);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(30, 9);
    expect(p.lifetime).toBe(12);
    expect(createPowerUp(0, 0, 'revive', seededRng(1)).lifetime).toBe(15);
    expect(createPowerUp(0, 0, 'revive', seededRng(1), 3).lifetime).toBe(3);
  });

  it('expires after its lifetime', () => {
    const p = createPowerUp(640, 360, 'shield', seededRng(1));
    p.velocity = { x: 0, y: 0 };
    for (let i = 0; i < 60 * 11.9; i++) updatePowerUp(p, FRAME);
    expect(p.alive).toBe(true);
    for (let i = 0; i < 60 * 0.3; i++) updatePowerUp(p, FRAME);
    expect(p.alive).toBe(false);
  });

  it('wraps around the screen edges instead of leaving', () => {
    const p = createPowerUp(1, 1, 'shield', seededRng(1));
    p.velocity = { x: -30, y: -30 };
    updatePowerUp(p, 0.1);
    expect(p.position).toEqual({ x: SCREEN_WIDTH, y: SCREEN_HEIGHT });
    p.velocity = { x: 30, y: 30 };
    updatePowerUp(p, 0.1);
    expect(p.position).toEqual({ x: 0, y: 0 });
  });

  it('drifts on real time even during Slow Motion', () => {
    const sim = quietSim();
    sim.slowMotion = { active: true, timer: 6 };
    const p = createPowerUp(300, 300, 'shield', seededRng(1));
    p.velocity = { x: 30, y: 0 };
    sim.powerups.push(p);
    runFor(sim, 1);
    expect(p.position.x).toBeCloseTo(330, 3);
  });
});

describe('drops in the simulation', () => {
  /** rng whose next draws force an ordinary drop of the given pick (0..1). */
  const forcedDrop = (pick: number) => {
    const rng = queueRng();
    return { rng, arm: () => rng.queue(0.5, 0.01, pick) };
  };

  function shootAt(sim: GameSim, target: ReturnType<typeof rock>): void {
    sim.player.rotation = 270;
    sim.player.position = { x: 200, y: 360 };
    target.position = { x: 400, y: 360 };
    sim.asteroids.push(target);
  }

  it('a shot kill can drop a power-up at the asteroid position', () => {
    const { rng, arm } = forcedDrop(0.3);
    const sim = quietSim(1, rng);
    const target = rock(0, 0, 20);
    shootAt(sim, target);
    sim.shots.push({ position: { x: 395, y: 360 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    arm();
    const events = sim.step(FRAME);
    expect(sim.powerups).toHaveLength(1);
    expect(sim.powerups[0]?.type).toBe('shield');
    expect(sim.powerups[0]?.position.x).toBeCloseTo(400, 6);
    expect(events).toContainEqual({ type: 'powerup_dropped', powerType: 'shield' });
  });

  it('a non-lethal armored hit never drops anything', () => {
    const { rng, arm } = forcedDrop(0.3);
    const sim = quietSim(1, rng);
    const target = rock(0, 0, 60, 'armored');
    shootAt(sim, target);
    sim.shots.push({ position: { x: 395, y: 360 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    arm();
    sim.step(FRAME);
    expect(sim.powerups).toHaveLength(0);
    expect(target.hitPoints).toBe(1);
  });

  it('an asteroid that dies by crashing into the ship never drops anything', () => {
    const { rng, arm } = forcedDrop(0.3);
    const sim = quietSim(1, rng);
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    arm();
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.powerups).toHaveLength(0);
  });
});

describe('collection', () => {
  it('collects a pickup the ship touches, removes it and reports the event', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'rapid_fire');
    const events = sim.step(FRAME);
    expect(sim.powerups).toHaveLength(0);
    expect(sim.player.rapidFire.active).toBe(true);
    expect(events).toContainEqual({ type: 'powerup_collected', powerType: 'rapid_fire' });
    expect(sim.pickupFlashes).toHaveLength(1);
  });

  it('uses circle geometry: radius 20 + 15 = 35 px reach', () => {
    const sim = quietSim();
    const near = createPowerUp(PLAYER_START_X + 34.9, PLAYER_START_Y, 'shield', seededRng(1));
    const far = createPowerUp(PLAYER_START_X, PLAYER_START_Y + 35.1, 'multi_shot', seededRng(1));
    near.velocity = far.velocity = { x: 0, y: 0 };
    sim.powerups.push(near, far);
    sim.step(0.001);
    expect(near.alive).toBe(false);
    expect(far.alive).toBe(true);
  });

  it('works while respawn-invulnerable but not once the game is over', () => {
    const sim = quietSim();
    sim.player.isRespawning = true;
    sim.player.respawnTimer = 2;
    pickupAtShip(sim, 'shield');
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(true);
  });

  it('flash fades away', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'slow_motion');
    sim.step(FRAME);
    expect(sim.pickupFlashes).toHaveLength(1);
    runFor(sim, 0.5);
    expect(sim.pickupFlashes).toHaveLength(0);
  });
});

describe('Rapid Fire', () => {
  const fireCount = (sim: GameSim, seconds: number): number => {
    let shots = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const events = sim.step(FRAME, hold({ shoot: true }));
      shots += events.filter((e) => e.type === 'shot_fired').length;
    }
    return shots;
  };

  it('cuts the shot cooldown from 0.3 s to 0.1 s', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'rapid_fire');
    sim.step(FRAME);
    // 0.1 s cooldown at 60 fps takes 7 frames (float rounding), as in Python: ~8.6 shots/s vs 3.3 normally.
    const shots = fireCount(sim, 3);
    expect(shots).toBeGreaterThanOrEqual(24);
    expect(shots).toBeLessThanOrEqual(31);
  });

  it('lasts 5 s, then the cooldown returns to normal', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'rapid_fire');
    sim.step(FRAME);
    runFor(sim, 4.9);
    expect(sim.player.rapidFire.active).toBe(true);
    runFor(sim, 0.2);
    expect(sim.player.rapidFire.active).toBe(false);
    expect(fireCount(sim, 3)).toBeLessThanOrEqual(10);
  });

  it('collecting another one restarts the 5 s timer', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'rapid_fire');
    sim.step(FRAME);
    runFor(sim, 4);
    pickupAtShip(sim, 'rapid_fire');
    sim.step(FRAME);
    expect(sim.player.rapidFire.timer).toBeCloseTo(5, 1);
    runFor(sim, 4.5);
    expect(sim.player.rapidFire.active).toBe(true);
  });

  it('lasts 5 s of real time at any frame rate', () => {
    for (const fps of [30, 144]) {
      const sim = quietSim();
      pickupAtShip(sim, 'rapid_fire');
      sim.step(1 / fps);
      runFor(sim, 4.9, undefined, fps);
      expect(sim.player.rapidFire.active).toBe(true);
      runFor(sim, 0.2, undefined, fps);
      expect(sim.player.rapidFire.active).toBe(false);
    }
  });
});

describe('Multi-Shot', () => {
  it('fires three shots fanned -15, 0 and +15 degrees', () => {
    expect(shotAngleOffsets(true)).toEqual([-15, 0, 15]);
    expect(shotAngleOffsets(false)).toEqual([0]);
    expect(MULTI_SHOT_ANGLE_SPREAD).toBe(15);
  });

  it.each([0, 90, 180, 270, 33])('headings are correct when the ship faces %i degrees', (rotation) => {
    const p = createPlayer(640, 360);
    p.multiShot = { active: true, timer: 8 };
    p.rotation = rotation;
    const { shots } = updatePlayer(p, hold({ shoot: true }), FRAME);
    expect(shots).toHaveLength(3);
    [-15, 0, 15].forEach((offset, i) => {
      const expected = getForwardVector(rotation + offset);
      const v = shots[i]?.velocity ?? { x: NaN, y: NaN };
      expect(v.x).toBeCloseTo(expected.x * 500, 6);
      expect(v.y).toBeCloseTo(expected.y * 500, 6);
      expect(shots[i]?.owner).toBe(1);
    });
  });

  it('uses the normal cooldown, plays one shot sound per trigger pull, and lasts 8 s', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'multi_shot');
    sim.step(FRAME);
    let pulls = 0;
    let projectiles = 0;
    for (let i = 0; i < 60; i++) {
      const before = sim.shots.length;
      const ev = sim.step(FRAME, hold({ shoot: true }));
      pulls += ev.filter((e) => e.type === 'shot_fired').length;
      projectiles += Math.max(0, sim.shots.length - before);
    }
    expect(pulls).toBe(4);
    expect(projectiles).toBe(12);

    runFor(sim, 7.1);
    expect(sim.player.multiShot.active).toBe(false);
  });

  it('every projectile in the fan can score', () => {
    const sim = quietSim();
    sim.player.multiShot = { active: true, timer: 8 };
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    sim.asteroids.push(rock(400, 360, 20), rock(400, 360 - 300 * Math.tan(Math.PI / 12), 20));
    runFor(sim, 1.5, hold({ shoot: true }));
    expect(sim.player.score).toBeGreaterThanOrEqual(100);
  });
});

describe('Shield', () => {
  it('absorbs one asteroid hit: the rock still breaks, no life is lost, the shield is spent', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'shield');
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(true);

    const first = rock(PLAYER_START_X, PLAYER_START_Y, 40);
    sim.asteroids.push(first);
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.shieldActive).toBe(false);
    expect(first.dying).toBe(true);
    expect(sim.player.score).toBe(0);
  });

  it('is not permanent: the next hit costs a life', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
  });

  it('only absorbs one of several simultaneous hits', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40), rock(PLAYER_START_X + 3, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.player.shieldActive).toBe(false);
  });

  it('never times out', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    runFor(sim, 60);
    expect(sim.player.shieldActive).toBe(true);
  });

  it('respawn invulnerability is checked first and leaves the shield alone', () => {
    const p = createPlayer(0, 0);
    p.shieldActive = true;
    p.isRespawning = true;
    expect(takeDamage(p)).toBe('invulnerable');
    expect(p.shieldActive).toBe(true);
    p.isRespawning = false;
    expect(takeDamage(p)).toBe('shield');
    expect(p.shieldActive).toBe(false);
    expect(takeDamage(p)).toBe('life_lost');
  });

  it('a shield-absorbed hit does not play the death cue but the rock still explodes', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    const events = sim.step(FRAME);
    expect(events.some((e) => e.type === 'player_hit')).toBe(false);
    expect(events.some((e) => e.type === 'asteroid_destroyed')).toBe(true);
  });
});

describe('Slow Motion', () => {
  it('slows asteroids to 40% and nothing else', () => {
    const sim = quietSim();
    sim.slowMotion = { active: true, timer: 6 };
    const a = rock(100, 100, 60, 'standard', { x: 50, y: 0 });
    sim.asteroids.push(a);
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 500 };
    const startShots = sim.shots.length;
    sim.step(0.1, hold({ move: 1, shoot: true }));
    expect(a.position.x).toBeCloseTo(100 + 50 * 0.1 * 0.4, 6);
    expect(sim.player.position.x).toBeCloseTo(100 + 300 * 0.1, 6); // ship at full speed
    expect(sim.shots.length).toBeGreaterThan(startShots);
    const shot = sim.shots[0];
    expect(shot ? Math.hypot(shot.velocity.x, shot.velocity.y) : 0).toBeCloseTo(500, 6);
  });

  it('stacks with the difficulty multiplier', () => {
    const sim = quietSim();
    sim.slowMotion = { active: true, timer: 6 };
    sim.asteroidSpeedMultiplier = 1.3;
    const a = rock(100, 100, 60, 'standard', { x: 50, y: 0 });
    sim.asteroids.push(a);
    sim.step(0.1);
    expect(a.position.x).toBeCloseTo(100 + 50 * 0.1 * 1.3 * 0.4, 6);
  });

  it('does not slow the spawner, the cooldowns or the clock', () => {
    const normal = quietSim();
    const slow = quietSim();
    slow.slowMotion = { active: true, timer: 100 };
    for (const sim of [normal, slow]) sim.spawner.spawnTimer = 0;
    runFor(normal, 5);
    runFor(slow, 5);
    expect(slow.spawner.spawnTimer).toBeCloseTo(normal.spawner.spawnTimer, 6);
    expect(slow.time).toBeCloseTo(normal.time, 6);
  });

  it('lasts 6 s of real time and does not extend when collected again, it restarts', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'slow_motion');
    sim.step(FRAME);
    runFor(sim, 5.8);
    expect(sim.slowMotion.active).toBe(true);
    pickupAtShip(sim, 'slow_motion');
    sim.step(FRAME);
    expect(sim.slowMotion.timer).toBeCloseTo(6, 1);
    runFor(sim, 5.9);
    expect(sim.slowMotion.active).toBe(true);
    runFor(sim, 0.2);
    expect(sim.slowMotion.active).toBe(false);
  });

  it('lasts 6 s of real time at any frame rate', () => {
    for (const fps of [30, 144]) {
      const sim = quietSim();
      sim.slowMotion = { active: true, timer: 6 };
      runFor(sim, 5.9, undefined, fps);
      expect(sim.slowMotion.active).toBe(true);
      runFor(sim, 0.2, undefined, fps);
      expect(sim.slowMotion.active).toBe(false);
    }
  });

  it('the death animation still ends after 0.15 real seconds', () => {
    const sim = quietSim();
    sim.slowMotion = { active: true, timer: 6 };
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    const a = rock(300, 360, 60);
    sim.asteroids.push(a);
    sim.shots.push({ position: { x: 295, y: 360 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    sim.step(FRAME);
    expect(a.dying).toBe(true);
    runFor(sim, 0.2);
    expect(a.alive).toBe(false);
    expect(sim.asteroids.filter((c) => c.radius === 40)).toHaveLength(2);
  });
});

describe('MEGA POWER', () => {
  it('turns on Rapid Fire, Multi-Shot, Shield and Slow Motion for 6 s', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    const p = sim.player;
    expect(p.megaPower.active && p.rapidFire.active && p.multiShot.active && p.shieldActive).toBe(true);
    expect(sim.slowMotion.active).toBe(true);
    expect(p.megaPower.timer).toBeCloseTo(6, 1);
  });

  it('on expiry switches Rapid Fire and Multi-Shot off but keeps the shield; Slow Motion ends at the same time', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    runFor(sim, 5.8);
    expect(sim.player.megaPower.active).toBe(true);
    runFor(sim, 0.3);
    const p = sim.player;
    expect(p.megaPower.active).toBe(false);
    expect(p.rapidFire.active).toBe(false);
    expect(p.multiShot.active).toBe(false);
    expect(p.shieldActive).toBe(true);
    expect(sim.slowMotion.active).toBe(false);
  });

  it('pauses the individual Rapid Fire / Multi-Shot timers while it runs', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    runFor(sim, 3);
    expect(sim.player.rapidFire.timer).toBeCloseTo(6, 1);
    expect(sim.player.multiShot.timer).toBeCloseTo(6, 1);
  });

  it('overrides an already-active Rapid Fire / Multi-Shot with fresh 6 s timers', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'rapid_fire');
    pickupAtShip(sim, 'multi_shot');
    sim.step(FRAME);
    runFor(sim, 4.5);
    expect(sim.player.rapidFire.timer).toBeLessThan(1);
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    expect(sim.player.rapidFire.timer).toBeCloseTo(6, 1);
    expect(sim.player.multiShot.timer).toBeCloseTo(6, 1);
  });

  it('(Python behaviour) switches off a separately collected Rapid Fire / Multi-Shot when it ends', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    runFor(sim, 2);
    pickupAtShip(sim, 'rapid_fire'); // gets a fresh 5 s timer, but the mega still owns it
    sim.step(FRAME);
    expect(sim.player.rapidFire.timer).toBeCloseTo(5, 1);
    runFor(sim, 4.2);
    expect(sim.player.megaPower.active).toBe(false);
    expect(sim.player.rapidFire.active).toBe(false);
  });

  it('collecting Rapid Fire after it ended behaves normally again', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    runFor(sim, 6.2);
    pickupAtShip(sim, 'rapid_fire');
    sim.step(FRAME);
    runFor(sim, 4.8);
    expect(sim.player.rapidFire.active).toBe(true);
    runFor(sim, 0.4);
    expect(sim.player.rapidFire.active).toBe(false);
  });

  it('collecting it again restarts the clock and does not stack effects', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    runFor(sim, 4);
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    expect(sim.player.megaPower.timer).toBeCloseTo(6, 1);
    expect(sim.slowMotion.timer).toBeCloseTo(6, 1);
    runFor(sim, 6.2);
    expect(sim.player.megaPower.active).toBe(false);
    expect(sim.slowMotion.active).toBe(false);
  });

  it('its shield is spent by a hit and the rest of the effect carries on', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.megaPower.active).toBe(true);
    expect(sim.player.rapidFire.active).toBe(true);
  });
});

describe('Revive (single player)', () => {
  it('is consumed without effect (nobody to revive) and never drops on its own', () => {
    const sim = quietSim();
    sim.player.lives = 2;
    pickupAtShip(sim, 'revive');
    const events = sim.step(FRAME);
    expect(sim.powerups).toHaveLength(0);
    expect(sim.player.lives).toBe(2);
    expect(events).toContainEqual({ type: 'powerup_collected', powerType: 'revive' });
  });
});

describe('cleanup on death and restart', () => {
  it('losing a life clears Rapid Fire, Multi-Shot, Mega Power and boost; Slow Motion is global and stays', () => {
    const sim = quietSim();
    const p = sim.player;
    p.rapidFire = { active: true, timer: 4 };
    p.multiShot = { active: true, timer: 4 };
    p.megaPower = { active: true, timer: 4 };
    p.boost.active = false; // boost would ram instead of dying, so test boost via respawnPlayer separately
    sim.slowMotion = { active: true, timer: 4 };
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(p.lives).toBe(2);
    expect(p.rapidFire.active || p.multiShot.active || p.megaPower.active || p.shieldActive).toBe(false);
    expect(sim.slowMotion.active).toBe(true);
    expect(p.position).toEqual({ x: PLAYER_RESPAWN_X, y: PLAYER_RESPAWN_Y });
  });

  it('a fresh game starts with no effects at all', () => {
    const sim = new GameSim({ rng: seededRng(9) });
    const p = sim.player;
    expect(p.rapidFire.active || p.multiShot.active || p.megaPower.active || p.shieldActive || p.boost.active).toBe(false);
    expect(sim.slowMotion.active).toBe(false);
    expect(sim.powerups).toHaveLength(0);
    expect(sim.lasers).toHaveLength(0);
    expect(p.laser.shotsRemaining).toBe(15);
    expect(p.boost.cooldown).toBe(0);
  });

  it('game over while effects are active freezes pickups and keeps the sim consistent', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    sim.player.rapidFire = { active: true, timer: 4 };
    pickupAtShip(sim, 'mega_power').position = { x: 900, y: 100 };
    sim.asteroids.push(rock(PLAYER_START_X, PLAYER_START_Y, 40));
    sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    const drift = { ...(sim.powerups[0]?.position ?? { x: 0, y: 0 }) };
    runFor(sim, 2);
    expect(sim.powerups[0]?.position).toEqual(drift);
    expect(sim.player.lives).toBe(0);
  });
});
