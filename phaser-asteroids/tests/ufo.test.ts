import { describe, expect, it } from 'vitest';
import {
  PLAYER_RESPAWN_X,
  PLAYER_RESPAWN_Y,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  UFO_CONTINUOUS_RESPAWN_TIME,
  UFO_CONTINUOUS_SPAWN_TIME,
  UFO_MAX_ACTIVE,
} from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { getForwardVector } from '../src/core/math';
import { respawnPlayer } from '../src/core/player';
import { ORDINARY_POWERUPS } from '../src/core/powerup';
import { seededRng } from '../src/core/rng';
import { SPAWN_EDGES } from '../src/core/spawner';
import {
  aimAngle,
  chooseUfoType,
  createUfo,
  createUfoSpawner,
  createUfoShot,
  UFO_STATS,
  updateUfo,
  updateUfoSpawner,
  type Ufo,
} from '../src/core/ufo';
import { FRAME, collectEvents, eventsOfType, hold, parkedUfoFor, queueRng, quietSim, rock, runFor, shotAt, ufoShotAt } from './helpers';

const parkedUfo = parkedUfoFor;

const angleOf = (v: { x: number; y: number }): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const angleDiff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

describe('UFO stats (constants.py)', () => {
  it('large: radius 30, 100 px/s, a shot every 2 s with accuracy 0, 200 points', () => {
    expect(UFO_STATS.large).toEqual({ radius: 30, speed: 100, shootCooldown: 2, accuracy: 0, points: 200 });
  });
  it('small: radius 20, 180 px/s, a shot every 1.5 s with accuracy 0.7, 500 points', () => {
    expect(UFO_STATS.small).toEqual({ radius: 20, speed: 180, shootCooldown: 1.5, accuracy: 0.7, points: 500 });
  });
});

describe('creating a UFO (random draws in the Python order)', () => {
  it('large: interval, heading, first-shot delay', () => {
    const rng = queueRng();
    rng.queue(0.5, 0.25, 0.5);
    const ufo = createUfo(10, 20, 'large', rng);
    expect(ufo.directionChangeInterval).toBeCloseTo(3, 9); // uniform(2, 4)
    expect(ufo.shootTimer).toBeCloseTo(1.0, 9); // uniform(0.5, 1.5)
    const dir = getForwardVector(90); // 0.25 x 360
    expect(ufo.targetVelocity.x).toBeCloseTo(dir.x * 100, 9);
    expect(ufo.targetVelocity.y).toBeCloseTo(dir.y * 100, 9);
    expect(ufo.velocity).toEqual({ x: 0, y: 0 });
    expect(ufo.position).toEqual({ x: 10, y: 20 });
    expect(ufo.alive).toBe(true);
  });

  it('small: 40 % of the time it picks a straight horizontal run instead, left or right', () => {
    const horizontalRight = queueRng();
    horizontalRight.queue(0.5, 0.3, 0.39, 0.9, 0.5);
    expect(createUfo(0, 0, 'small', horizontalRight).targetVelocity).toEqual({ x: 180, y: 0 });

    const horizontalLeft = queueRng();
    horizontalLeft.queue(0.5, 0.3, 0.0, 0.1, 0.5);
    expect(createUfo(0, 0, 'small', horizontalLeft).targetVelocity).toEqual({ x: -180, y: 0 });

    const free = queueRng();
    free.queue(0.5, 0.3, 0.4, 0.5);
    const ufo = createUfo(0, 0, 'small', free);
    expect(Math.hypot(ufo.targetVelocity.x, ufo.targetVelocity.y)).toBeCloseTo(180, 9);
    expect(ufo.targetVelocity.y).not.toBe(0);
    expect(ufo.shootTimer).toBeGreaterThanOrEqual(0.5);
    expect(ufo.shootTimer).toBeLessThan(1.5);
  });
});

describe('UFO movement', () => {
  function drifter(): Ufo {
    const ufo = createUfo(640, 360, 'large', seededRng(1));
    ufo.targetVelocity = { x: 100, y: 0 };
    ufo.directionChangeInterval = 1e9;
    ufo.shootTimer = 1e9;
    return ufo;
  }

  it('eases its velocity towards the target heading instead of snapping to it', () => {
    const ufo = drifter();
    const rng = seededRng(2);
    updateUfo(ufo, FRAME, null, rng);
    expect(ufo.velocity.x).toBeGreaterThan(0);
    expect(ufo.velocity.x).toBeLessThan(5);
    for (let i = 0; i < 59; i++) updateUfo(ufo, FRAME, null, rng);
    // After 1 s the gap has closed by 1 - e^-2 = 86 %.
    expect(ufo.velocity.x).toBeGreaterThan(84);
    expect(ufo.velocity.x).toBeLessThan(88);
  });

  it('the easing is the same at 30, 60 and 144 fps (within 1 %)', () => {
    const results = [30, 60, 144].map((fps) => {
      const ufo = drifter();
      const rng = seededRng(2);
      for (let i = 0; i < fps; i++) updateUfo(ufo, 1 / fps, null, rng);
      return { v: ufo.velocity.x, x: ufo.position.x };
    });
    const [a, b, c] = results;
    expect(Math.abs((a?.v ?? 0) - (b?.v ?? 0))).toBeLessThan(1);
    expect(Math.abs((c?.v ?? 0) - (b?.v ?? 0))).toBeLessThan(1);
    expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeLessThan(1.5);
    expect(Math.abs((c?.x ?? 0) - (b?.x ?? 0))).toBeLessThan(1.5);
  });

  it.each([
    ['left', { x: -31, y: 360 }, { x: -100, y: 0 }, { x: SCREEN_WIDTH + 30, y: 360 }],
    ['right', { x: SCREEN_WIDTH + 31, y: 360 }, { x: 100, y: 0 }, { x: -30, y: 360 }],
    ['top', { x: 640, y: -31 }, { x: 0, y: -100 }, { x: 640, y: SCREEN_HEIGHT + 30 }],
    ['bottom', { x: 640, y: SCREEN_HEIGHT + 31 }, { x: 0, y: 100 }, { x: 640, y: -30 }],
  ])('wraps from the %s edge once a full radius outside the screen', (_name, from, velocity, to) => {
    const ufo = drifter();
    ufo.position = { ...from };
    ufo.velocity = { ...velocity };
    ufo.targetVelocity = { ...velocity };
    updateUfo(ufo, 0.001, null, seededRng(1));
    expect(ufo.position.x).toBeCloseTo(to.x, 6);
    expect(ufo.position.y).toBeCloseTo(to.y, 6);
  });

  it('does not wrap while still within one radius of the edge (partly visible)', () => {
    const ufo = drifter();
    ufo.position = { x: -29, y: 360 };
    ufo.velocity = { x: -10, y: 0 };
    ufo.targetVelocity = { x: -10, y: 0 };
    updateUfo(ufo, 0.01, null, seededRng(1));
    expect(ufo.position.x).toBeLessThan(0);
    expect(ufo.position.x).toBeGreaterThan(-30);
  });

  it('picks a new heading and a new 2-4 s interval when the interval is up, and not before', () => {
    const ufo = createUfo(640, 360, 'large', seededRng(5));
    ufo.shootTimer = 1e9;
    ufo.directionChangeInterval = 3;
    const before = { ...ufo.targetVelocity };
    const rng = seededRng(9);
    for (let i = 0; i < 59 * 3; i++) updateUfo(ufo, FRAME, null, rng);
    expect(ufo.targetVelocity).toEqual(before);
    for (let i = 0; i < 6; i++) updateUfo(ufo, FRAME, null, rng);
    expect(ufo.targetVelocity).not.toEqual(before);
    expect(Math.hypot(ufo.targetVelocity.x, ufo.targetVelocity.y)).toBeCloseTo(100, 6);
    expect(ufo.directionChangeInterval).toBeGreaterThanOrEqual(2);
    expect(ufo.directionChangeInterval).toBeLessThanOrEqual(4);
    expect(ufo.movementTimer).toBeLessThan(0.1);
  });

  it('over a long flight the headings use the whole circle and small UFOs mix in horizontal runs', () => {
    const ufo = createUfo(640, 360, 'small', seededRng(11));
    ufo.shootTimer = 1e9;
    const rng = seededRng(12);
    let horizontal = 0;
    let changes = 0;
    let last = ufo.targetVelocity;
    const quadrants = new Set<number>();
    for (let i = 0; i < 60 * 600; i++) {
      updateUfo(ufo, FRAME, null, rng);
      if (ufo.targetVelocity !== last) {
        last = ufo.targetVelocity;
        changes++;
        if (ufo.targetVelocity.y === 0) horizontal++;
        quadrants.add((ufo.targetVelocity.x >= 0 ? 1 : 0) + (ufo.targetVelocity.y >= 0 ? 2 : 0));
      }
    }
    expect(changes).toBeGreaterThan(150); // ~ one every 3 s over 600 s
    expect(horizontal / changes).toBeGreaterThan(0.3);
    expect(horizontal / changes).toBeLessThan(0.5);
    expect(quadrants.size).toBe(4);
  });
});

describe('UFO aiming and firing', () => {
  it('aims straight at the target when accuracy is 1', () => {
    for (const [tx, ty] of [
      [500, 100],
      [100, 500],
      [900, 360],
      [50, 360],
      [100, 100],
    ] as const) {
      const from = { x: 100, y: 360 };
      const shot = createUfoShot(from, aimAngle(from, { x: tx, y: ty }, 1, seededRng(1)));
      expect(angleOf(shot.velocity)).toBeCloseTo(angleOf({ x: tx - from.x, y: ty - from.y }), 6);
    }
  });

  it("small UFO accuracy 0.7 means the shot strays at most 54 degrees, uniformly: it is not a '70 % hit' roll", () => {
    const rng = seededRng(21);
    const from = { x: 100, y: 100 };
    const target = { x: 700, y: 400 };
    const exact = angleOf({ x: target.x - from.x, y: target.y - from.y });
    let within27 = 0;
    let within10 = 0;
    let worst = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const dev = angleDiff(angleOf(createUfoShot(from, aimAngle(from, target, 0.7, rng)).velocity), exact);
      worst = Math.max(worst, Math.abs(dev));
      if (Math.abs(dev) <= 27) within27++;
      if (Math.abs(dev) <= 10) within10++;
    }
    expect(worst).toBeLessThanOrEqual(54 + 1e-6);
    expect(worst).toBeGreaterThan(53.5);
    expect(within27 / N).toBeGreaterThan(0.48); // uniform over +/-54: half are within +/-27
    expect(within27 / N).toBeLessThan(0.52);
    expect(within10 / N).toBeGreaterThan(0.17); // 20 / 108
    expect(within10 / N).toBeLessThan(0.2);
  });

  it('large UFO (accuracy 0) fires in a uniformly random direction whatever the target', () => {
    const rng = seededRng(33);
    const from = { x: 640, y: 360 };
    const quadrant = [0, 0, 0, 0];
    const N = 8000;
    for (let i = 0; i < N; i++) {
      const a = angleOf(createUfoShot(from, aimAngle(from, { x: 1000, y: 360 }, 0, rng)).velocity);
      quadrant[Math.floor(((a + 360) % 360) / 90)]! += 1;
    }
    for (const count of quadrant) {
      expect(count / N).toBeGreaterThan(0.22);
      expect(count / N).toBeLessThan(0.28);
    }
  });

  it('shots start at the UFO, travel at 350 px/s and are 6 px in radius', () => {
    const rng = queueRng();
    const ufo = createUfo(300, 200, 'small', rng);
    ufo.shootTimer = 0.001;
    const shot = updateUfo(ufo, 0.01, { x: 800, y: 200 }, queueRng(7));
    expect(shot).not.toBeNull();
    expect(shot?.radius).toBe(6);
    expect(Math.hypot(shot?.velocity.x ?? 0, shot?.velocity.y ?? 0)).toBeCloseTo(350, 6);
    expect(shot?.position).toEqual(ufo.position);
    expect(shot?.alive).toBe(true);
    expect(ufo.shootTimer).toBe(1.5); // reset to the cooldown, not topped up
  });

  it('with nobody to target it fires at a random point of the screen', () => {
    const ufo = createUfo(100, 100, 'small', queueRng());
    ufo.velocity = { x: 0, y: 0 };
    ufo.targetVelocity = { x: 0, y: 0 };
    ufo.shootTimer = 0;
    const rng = queueRng();
    rng.queue(0.5, 0.5, 0.5); // x = 640, y = 360, deviation 0
    const shot = updateUfo(ufo, 0.001, null, rng);
    expect(angleOf(shot?.velocity ?? { x: 0, y: 0 })).toBeCloseTo(angleOf({ x: 640 - 100, y: 360 - 100 }), 4);
  });

  it('a UFO exactly on its target fires in a random direction instead of dividing by zero', () => {
    const rng = queueRng();
    rng.queue(0.25);
    expect(aimAngle({ x: 5, y: 5 }, { x: 5, y: 5 }, 1, rng)).toBeCloseTo(90, 9);
  });

  it('fires first after 0.5-1.5 s and then every cooldown (large 2 s, small 1.5 s), in the simulation', () => {
    for (const [type, cooldown] of [
      ['large', 2],
      ['small', 1.5],
    ] as const) {
      const sim = quietSim(4);
      sim.player.lives = 999;
      const ufo = sim.spawnUfo(type, 900, 200);
      ufo.movementTimer = -1e9;
      const times: number[] = [];
      for (let i = 0; i < 60 * 12; i++) {
        const events = sim.step(FRAME);
        if (eventsOfType(events, 'ufo_fired').length > 0) times.push(sim.time);
      }
      expect(times[0]).toBeGreaterThanOrEqual(0.49);
      expect(times[0]).toBeLessThanOrEqual(1.52);
      for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeCloseTo(cooldown, 1);
      expect(times.length).toBeGreaterThanOrEqual(Math.floor((12 - 1.5) / cooldown));
    }
  });

  it('a small UFO aims at the ship (within 54 degrees); a respawning ship is not a target', () => {
    const sim = quietSim(8);
    sim.player.lives = 999;
    const ufo = sim.spawnUfo('small', 1000, 360);
    ufo.movementTimer = -1e9;
    ufo.targetVelocity = { x: 0, y: 0 };
    const devs: number[] = [];
    for (let shots = 0; shots < 30; ) {
      const events = sim.step(FRAME);
      if (eventsOfType(events, 'ufo_fired').length > 0) {
        const shot = sim.ufoShots[sim.ufoShots.length - 1]!;
        const toShip = angleOf({ x: sim.player.position.x - shot.position.x, y: sim.player.position.y - shot.position.y });
        devs.push(Math.abs(angleDiff(angleOf(shot.velocity), toShip)));
        shots++;
        sim.ufoShots.length = 0;
      }
    }
    expect(Math.max(...devs)).toBeLessThanOrEqual(54 + 1e-6);
    expect(devs.filter((d) => d > 20).length).toBeGreaterThan(0); // not perfect aim

    // The same UFO ignores a ship that is respawning: shots then go anywhere.
    respawnPlayer(sim.player, 100, 100);
    sim.player.respawnTimer = 1e9;
    const far: number[] = [];
    for (let shots = 0; shots < 60; ) {
      const events = sim.step(FRAME);
      if (eventsOfType(events, 'ufo_fired').length > 0) {
        const shot = sim.ufoShots[sim.ufoShots.length - 1]!;
        const toShip = angleOf({ x: sim.player.position.x - shot.position.x, y: sim.player.position.y - shot.position.y });
        far.push(Math.abs(angleDiff(angleOf(shot.velocity), toShip)));
        shots++;
        sim.ufoShots.length = 0;
      }
    }
    expect(Math.max(...far)).toBeGreaterThan(54);
  });

  it('is not affected by Slow Motion or by how far the difficulty has climbed', () => {
    const run = (slow: boolean): Ufo => {
      const sim = quietSim(15);
      sim.player.lives = 999;
      sim.asteroidSpeedMultiplier = slow ? 3 : 1;
      if (slow) sim.slowMotion = { active: true, timer: 99 };
      const ufo = sim.spawnUfo('small', 500, 300);
      runFor(sim, 3);
      return ufo;
    };
    const normal = run(false);
    const slowed = run(true);
    expect(slowed.position).toEqual(normal.position);
    expect(slowed.velocity).toEqual(normal.velocity);
  });
});

describe('UFO spawning', () => {
  function schedulerSim(seed = 3): GameSim {
    const sim = new GameSim({ rng: seededRng(seed), startCooldown: 0 });
    sim.spawner.spawnTimer = -1e9; // no asteroids
    sim.player.lives = 999;
    return sim;
  }

  it('first UFO after 5 s of play, never earlier', () => {
    const sim = schedulerSim();
    runFor(sim, 4.9);
    expect(sim.ufos).toHaveLength(0);
    const events = collectEvents(sim, 0.3);
    expect(eventsOfType(events, 'ufo_spawned')).toHaveLength(1);
    expect(sim.ufos).toHaveLength(1);
    expect(UFO_CONTINUOUS_SPAWN_TIME).toBe(5);
  });

  it('then one attempt every 15 s counted from the previous attempt (20 s, 35 s, ...)', () => {
    const sim = schedulerSim();
    const spawnTimes: number[] = [];
    for (let i = 0; i < 60 * 80; i++) {
      const events = sim.step(FRAME);
      if (eventsOfType(events, 'ufo_spawned').length > 0) spawnTimes.push(sim.time);
      sim.ufos.length = 0; // keep the field clear so the cap never interferes
    }
    expect(spawnTimes).toHaveLength(5);
    spawnTimes.forEach((t, i) => expect(t).toBeCloseTo(5 + 15 * i, 0));
    expect(UFO_CONTINUOUS_RESPAWN_TIME).toBe(15);
  });

  it('never more than two at once: an attempt with two alive is skipped, not queued', () => {
    const sim = schedulerSim();
    let spawned = 0;
    for (let i = 0; i < 60 * 52; i++) {
      spawned += eventsOfType(sim.step(FRAME), 'ufo_spawned').length;
      sim.ufos.forEach((u) => (u.shootTimer = 1e9)); // keep them harmless
      expect(sim.ufos.length).toBeLessThanOrEqual(UFO_MAX_ACTIVE);
    }
    expect(spawned).toBe(2); // 5 s and 20 s; the 35 s and 50 s attempts found the cap full
    expect(sim.ufos).toHaveLength(2);

    // Free one slot: the next attempt (65 s) goes ahead, with nothing "owed" from the skipped ones.
    sim.ufos.pop();
    let more = 0;
    for (let i = 0; i < 60 * 12; i++) more += eventsOfType(sim.step(FRAME), 'ufo_spawned').length;
    expect(more).toBe(0); // 52 + 12 = 64 s
    more += eventsOfType(collectEvents(sim, 3), 'ufo_spawned').length;
    expect(more).toBe(1);
  });

  it('continuous mode: only large UFOs before 60 s, then small ones become eligible', () => {
    const sim = schedulerSim(21);
    const early = new Set<string>();
    const late = new Set<string>();
    for (let i = 0; i < 60 * 120; i++) {
      for (const e of eventsOfType(sim.step(FRAME), 'ufo_spawned')) (sim.time < 60 ? early : late).add(e.ufoType);
      sim.ufos.length = 0;
    }
    expect([...early]).toEqual(['large']);
    expect([...late].sort()).toEqual(['large', 'small']);
  });

  it('chooseUfoType: small 40 % of the time from wave 5 on, and the random draw is skipped before that', () => {
    let draws = 0;
    const counting = () => (draws++, 0.1);
    expect(chooseUfoType(4, counting)).toBe('large');
    expect(draws).toBe(0);
    expect(chooseUfoType(5, () => 0.39)).toBe('small');
    expect(chooseUfoType(5, () => 0.4)).toBe('large');
    expect(chooseUfoType(9, () => 0.0)).toBe('small');
  });

  it('appears on a random edge 60 px outside the screen, 20-80 % along it', () => {
    SPAWN_EDGES.forEach((edge, index) => {
      for (const [t, roll] of [
        [0.2, 0],
        [0.5, 0.5],
        [0.8, 1],
      ] as const) {
        const rng = queueRng();
        rng.queue((index + 0.1) / 4, roll, 0.5, 0.5, 0.5);
        const state = createUfoSpawner();
        const ufo = updateUfoSpawner(state, 5, 0, rng);
        const expected = edge.point(t);
        expect(ufo?.position.x).toBeCloseTo(expected.x, 6);
        expect(ufo?.position.y).toBeCloseTo(expected.y, 6);
      }
    });
  });

  it('a UFO that spawns past the edge first jumps to the opposite side (the original edge table is reused)', () => {
    const ufo = createUfo(-60, 360, 'large', seededRng(2));
    ufo.shootTimer = 1e9;
    updateUfo(ufo, FRAME, null, seededRng(3));
    expect(ufo.position.x).toBeCloseTo(SCREEN_WIDTH + 30, 0);
  });

  it('can be switched off, and a new run starts the schedule over', () => {
    const off = new GameSim({ rng: seededRng(1), startCooldown: 0, ufos: false });
    off.spawner.spawnTimer = -1e9;
    runFor(off, 30);
    expect(off.ufos).toHaveLength(0);

    const old = schedulerSim();
    runFor(old, 30);
    expect(old.ufos.length).toBeGreaterThan(0);
    const fresh = new GameSim({ rng: seededRng(1), startCooldown: 0 });
    expect(fresh.ufos).toHaveLength(0);
    expect(fresh.ufoShots).toHaveLength(0);
    expect(fresh.ufoSpawner.nextSpawnTime).toBe(5);
  });

  it('no time passes, no UFO appears: a paused game (no frames stepped) and a zero-length frame change nothing', () => {
    const sim = schedulerSim();
    runFor(sim, 4.9);
    const t = sim.spawner.gameplayTimer;
    for (let i = 0; i < 100; i++) sim.step(0);
    expect(sim.spawner.gameplayTimer).toBe(t);
    expect(sim.ufos).toHaveLength(0);
  });
});

describe('player shots vs UFOs', () => {
  it('a shot destroys a large UFO: 200 points, burst, shake, one power-up, shot used up; no combo', () => {
    const sim = quietSim();
    const ufo = parkedUfo(sim, 'large', 300, 300);
    sim.shots.push(shotAt(310, 300));
    const events = sim.step(FRAME);

    expect(ufo.alive).toBe(false);
    expect(sim.player.score).toBe(200);
    expect(sim.combo.count).toBe(0);
    expect(sim.combo.timer).toBe(0);
    expect(sim.streakBanner).toBeNull();
    expect(eventsOfType(events, 'ufo_destroyed')).toEqual([
      { type: 'ufo_destroyed', ufoType: 'large', points: 200, radius: 30, position: { x: ufo.position.x, y: ufo.position.y }, player: 1 },
    ]);
    expect(sim.shots.filter((s) => s.alive)).toHaveLength(0);
    expect(sim.particles.activeCount).toBe(10);
    expect(sim.screenShake).toBeGreaterThan(5);
    expect(sim.powerups).toHaveLength(1);
    expect(eventsOfType(events, 'powerup_dropped')).toHaveLength(1);
    expect(ORDINARY_POWERUPS).toContain(sim.powerups[0]?.type);
    expect(sim.powerups[0]?.position).toEqual(ufo.position);
  });

  it('a small UFO is worth 500, and a UFO kill does not touch an active combo', () => {
    const sim = quietSim();
    for (let i = 0; i < 3; i++) {
      sim.asteroids.push(rock(100 + i * 100, 100, 20));
      sim.shots.push(shotAt(100 + i * 100, 100));
      sim.step(FRAME);
    }
    expect(sim.combo.count).toBe(3);
    runFor(sim, 1);
    const timer = sim.combo.timer;
    const before = sim.player.score;
    const ufo = parkedUfo(sim, 'small', 800, 300);
    sim.shots.push(shotAt(800, 300));
    sim.step(FRAME);
    expect(ufo.alive).toBe(false);
    expect(sim.player.score - before).toBe(500); // flat: not x2
    expect(sim.combo.count).toBe(3);
    expect(sim.combo.timer).toBeLessThan(timer); // not refreshed
  });

  it('two shots on one UFO in the same frame: only the first scores and is used up', () => {
    const sim = quietSim();
    parkedUfo(sim, 'large', 300, 300);
    sim.shots.push(shotAt(300, 300), shotAt(305, 300));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
    expect(sim.shots).toHaveLength(1);
  });

  it('one shot over two overlapping UFOs destroys only one of them', () => {
    const sim = quietSim();
    const a = parkedUfo(sim, 'large', 300, 300);
    const b = parkedUfo(sim, 'large', 320, 300);
    sim.shots.push(shotAt(310, 300));
    sim.step(FRAME);
    expect([a.alive, b.alive].filter(Boolean)).toHaveLength(1);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
  });

  it('a shot that missed passes on; a shot used up on an asteroid cannot also kill the UFO', () => {
    const sim = quietSim();
    const ufo = parkedUfo(sim, 'large', 500, 300);
    sim.asteroids.push(rock(500, 300, 20));
    sim.shots.push(shotAt(500, 300));
    sim.step(FRAME);
    expect(ufo.alive).toBe(true); // the asteroid took the shot first (Python order)
    expect(sim.player.score).toBe(50);
  });

  it('the destroyed UFO is removed, is never paid twice and leaves one power-up', () => {
    const sim = quietSim();
    parkedUfo(sim, 'large', 300, 300);
    sim.shots.push(shotAt(300, 300));
    sim.step(FRAME);
    const events = collectEvents(sim, 2);
    expect(sim.ufos).toHaveLength(0);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(0);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
  });

  it('drops one of the four ordinary power-ups, uniformly, and never MEGA POWER or Revive', () => {
    const sim = quietSim(77);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 800; i++) {
      parkedUfo(sim, i % 2 ? 'large' : 'small', 300, 300);
      sim.shots.push(shotAt(300, 300));
      const events = sim.step(FRAME);
      for (const e of eventsOfType(events, 'powerup_dropped')) counts[e.powerType] = (counts[e.powerType] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual([...ORDINARY_POWERUPS].sort());
    for (const type of ORDINARY_POWERUPS) {
      expect(counts[type]).toBeGreaterThan(150);
      expect(counts[type]).toBeLessThan(250);
    }
  });

  it('the dropped power-up can be collected like any other', () => {
    const sim = quietSim(5);
    parkedUfo(sim, 'large', sim.player.position.x + 100, sim.player.position.y);
    sim.shots.push(shotAt(sim.player.position.x + 100, sim.player.position.y));
    sim.step(FRAME);
    const drop = sim.powerups[0];
    expect(drop).toBeDefined();
    if (drop) {
      drop.velocity = { x: 0, y: 0 };
      drop.position = { ...sim.player.position };
    }
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'powerup_collected')).toHaveLength(1);
    expect(sim.powerups).toHaveLength(0);
  });
});

describe('Laser Beam vs UFOs', () => {
  function beamAtUfo(options: { laserHitsUfos?: boolean } = {}) {
    const sim = new GameSim({ rng: seededRng(1), startCooldown: 0, ufos: false, ...options });
    sim.spawner.spawnTimer = -1e9;
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    const ufo = parkedUfo(sim, 'large', 500, 360);
    return { sim, ufo };
  }

  it('kills a UFO on its path (flat points, one guaranteed power-up)', () => {
    const { sim, ufo } = beamAtUfo();
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.4)];
    expect(eventsOfType(events, 'laser_fired')).toHaveLength(1);
    expect(ufo.alive).toBe(false);
    expect(sim.player.score).toBe(200);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.powerups).toHaveLength(1);
  });

  it('passes through when the original behaviour is restored (laserHitsUfos: false / LASER_HITS_UFOS)', () => {
    const { sim, ufo } = beamAtUfo({ laserHitsUfos: false });
    const events = sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(eventsOfType(events, 'laser_fired')).toHaveLength(1);
    expect(ufo.alive).toBe(true);
    expect(sim.player.score).toBe(0);
  });
});

describe('boost ramming and contact with UFOs', () => {
  it('a boosting ship destroys the UFO and takes no damage: shield and respawn protection stay untouched', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    sim.player.shieldActive = true;
    const ufo = parkedUfo(sim, 'small', sim.player.position.x + 38, sim.player.position.y);
    const events = sim.step(FRAME);
    expect(ufo.alive).toBe(false);
    expect(sim.player.score).toBe(500);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.shieldActive).toBe(true);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
    expect(sim.powerups).toHaveLength(1);
    expect(sim.combo.count).toBe(0);

    // Respawn protection is not used up either.
    const sim2 = quietSim();
    respawnPlayer(sim2.player, sim2.player.position.x, sim2.player.position.y);
    sim2.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    parkedUfo(sim2, 'large', sim2.player.position.x + 45, sim2.player.position.y);
    sim2.step(FRAME);
    expect(sim2.player.isRespawning).toBe(true);
    expect(sim2.player.respawnTimer).toBeGreaterThan(1.9);
    expect(sim2.player.score).toBe(200);
  });

  it('a shot and a ram in the same frame pay once and drop once', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    parkedUfo(sim, 'large', sim.player.position.x + 45, sim.player.position.y);
    sim.shots.push(shotAt(sim.player.position.x + 45, sim.player.position.y));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
  });

  it('touching a UFO without boosting costs a life, respawns the ship at (320, 360) and leaves the UFO flying', () => {
    const sim = quietSim();
    const ufo = parkedUfo(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    const events = sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.player.position).toEqual({ x: PLAYER_RESPAWN_X, y: PLAYER_RESPAWN_Y });
    expect(sim.player.isRespawning).toBe(true);
    expect(ufo.alive).toBe(true);
    expect(sim.player.score).toBe(0);
    expect(eventsOfType(events, 'player_hit')).toEqual([{ type: 'player_hit', livesLeft: 2, source: 'ufo', player: 1 }]);
  });

  it('a shield absorbs a UFO body, the UFO survives, and staying in that same contact costs nothing at first', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    const ufo = parkedUfo(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    const first = sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(3);
    expect(eventsOfType(first, 'player_hit')).toHaveLength(0);
    expect(ufo.alive).toBe(true);
    runFor(sim, 0.5);
    expect(sim.player.lives).toBe(3);
  });

  it('respawn invulnerability absorbs UFO contact for its whole 2 s without being consumed and without hurting the UFO', () => {
    const sim = quietSim();
    sim.player.lives = 2;
    respawnPlayer(sim.player, 320, 360);
    const ufo = parkedUfo(sim, 'large', 330, 360);
    const events = collectEvents(sim, 1.9);
    expect(sim.player.lives).toBe(2);
    expect(ufo.alive).toBe(true);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
    collectEvents(sim, 0.2); // protection ends while the UFO is still there
    expect(sim.player.lives).toBe(1);
  });

  it('losing the last life to a UFO ends the game once, with no further collisions in that frame', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    parkedUfo(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    parkedUfo(sim, 'large', sim.player.position.x - 20, sim.player.position.y);
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    const events = sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(sim.player.lives).toBe(0);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(1);
    expect(eventsOfType(events, 'game_over')).toHaveLength(1);
  });
});

describe('UFO shots', () => {
  it('cost the ship a life, are used up, and send it to the respawn point', () => {
    const sim = quietSim();
    const shot = ufoShotAt(sim.player.position.x + 10, sim.player.position.y);
    sim.ufoShots.push(shot);
    const events = sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(shot.alive).toBe(false);
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.player.position).toEqual({ x: PLAYER_RESPAWN_X, y: PLAYER_RESPAWN_Y });
    expect(eventsOfType(events, 'player_hit')).toEqual([{ type: 'player_hit', livesLeft: 2, source: 'ufo_shot', player: 1 }]);
  });

  it('are absorbed by a shield (which is used up) with no life lost and no sound event', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    const events = sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(3);
    expect(sim.ufoShots).toHaveLength(0);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
  });

  it('are absorbed by respawn invulnerability, which is not used up', () => {
    const sim = quietSim();
    sim.player.lives = 2;
    respawnPlayer(sim.player, 320, 360);
    sim.player.shieldActive = true;
    sim.ufoShots.push(ufoShotAt(320, 360));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.player.shieldActive).toBe(true); // invulnerability is checked first
    expect(sim.player.isRespawning).toBe(true);
    expect(sim.ufoShots).toHaveLength(0);
  });

  it('still hurt a boosting ship: the boost only protects against ramming', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
  });

  it('never hurt a UFO, and a player shot never hurts the ship', () => {
    const sim = quietSim();
    const ufo = parkedUfo(sim, 'large', 300, 300);
    sim.ufoShots.push(ufoShotAt(300, 300));
    sim.shots.push(shotAt(sim.player.position.x, sim.player.position.y));
    sim.step(FRAME);
    expect(ufo.alive).toBe(true);
    expect(sim.player.lives).toBe(3);
  });

  it('are separate from player shots: ownership is by list, they are drawn and counted apart', () => {
    const sim = quietSim();
    sim.player.lives = 999;
    const ufo = sim.spawnUfo('large', 900, 200);
    ufo.movementTimer = -1e9;
    ufo.shootTimer = 0.001;
    sim.step(FRAME);
    expect(sim.ufoShots).toHaveLength(1);
    expect(sim.shots).toHaveLength(0);
  });

  it('are removed once they leave the playfield, so they cannot pile up', () => {
    const sim = quietSim();
    sim.player.lives = 999;
    const ufo = sim.spawnUfo('large', 900, 200);
    ufo.movementTimer = -1e9;
    let peak = 0;
    for (let i = 0; i < 60 * 120; i++) {
      sim.step(FRAME);
      peak = Math.max(peak, sim.ufoShots.length);
    }
    expect(peak).toBeLessThan(6); // 2 s apart, ~2-4 s to cross the field
  });

  it('wreck asteroids without paying anyone, and may drop a power-up (Python quirk, kept)', () => {
    const sim = quietSim();
    sim.asteroids.push(rock(400, 200, 20));
    sim.ufoShots.push(ufoShotAt(400, 200));
    const events = sim.step(FRAME);
    expect(sim.player.score).toBe(0);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(sim.ufoShots).toHaveLength(0);
  });

  it('do nothing once the game is over and freeze with everything else', () => {
    const sim = quietSim();
    sim.player.lives = 1;
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y), ufoShotAt(200, 200, 100, 0));
    sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    const frozen = sim.ufoShots.map((s) => ({ ...s.position }));
    runFor(sim, 1);
    expect(sim.ufoShots.map((s) => s.position)).toEqual(frozen);
  });
});

describe('restart and cleanup', () => {
  it('a new simulation has no UFOs, no enemy shots and a fresh schedule, whatever was left on screen', () => {
    const old = new GameSim({ rng: seededRng(3), startCooldown: 0 });
    old.spawner.spawnTimer = -1e9;
    old.player.lives = 1;
    runFor(old, 30);
    old.ufoShots.push(ufoShotAt(1, 1));
    expect(old.ufos.length).toBeGreaterThan(0);

    const fresh = new GameSim({ rng: seededRng(3), startCooldown: 0 });
    expect(fresh.ufos).toEqual([]);
    expect(fresh.ufoShots).toEqual([]);
    expect(fresh.combo.count).toBe(0);
    expect(fresh.powerups).toEqual([]);
    expect(fresh.particles.activeCount).toBe(0);
  });
});
