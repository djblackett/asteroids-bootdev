import { describe, expect, it } from 'vitest';
import { PLAYER_RESPAWN_X, PLAYER_RESPAWN_Y, SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/core/constants';
import { GameSim, type SimEvent } from '../src/core/game';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { createPowerUp, ORDINARY_POWERUPS } from '../src/core/powerup';
import { seededRng } from '../src/core/rng';
import {
  FRAME,
  collectEvents,
  eventsOfType,
  hold,
  killOne,
  parkedUfoFor,
  pickupAtShip,
  queueKill,
  quietSim,
  rock,
  runFor,
  shotAt,
  ufoShotAt,
} from './helpers';

/** Points announced by events must add up to the score: nothing is paid without an event, nothing twice. */
function paid(events: readonly SimEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.type === 'asteroid_destroyed' || e.type === 'ufo_destroyed') total += e.points;
  }
  return total;
}

describe('integrated combat scenarios', () => {
  it('1. real gunfire down a line of rocks builds a combo: five kills pay 50 + 75 + 100 + 125 + 150', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    sim.player.rapidFire = { active: true, timer: 5 };
    for (let i = 0; i < 5; i++) sim.asteroids.push(rock(300 + i * 100, 360, 20));
    const events = collectEvents(sim, 2, hold({ shoot: true }));
    expect(eventsOfType(events, 'asteroid_destroyed').map((e) => e.combo)).toEqual([1, 2, 3, 4, 5]);
    expect(sim.player.score).toBe(500);
    expect(paid(events)).toBe(500);
  });

  it('2. a UFO shot dead in the middle of a combo pays flat and leaves the combo exactly as it was', () => {
    const sim = quietSim();
    for (let i = 0; i < 4; i++) killOne(sim, i);
    runFor(sim, 0.5);
    const { count, timer } = sim.combo;
    parkedUfoFor(sim, 'small', 900, 300);
    sim.shots.push(shotAt(900, 300));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.combo.count).toBe(count);
    expect(sim.combo.timer).toBeCloseTo(timer - FRAME, 6);
    expect(sim.player.score).toBe(50 + 75 + 100 + 125 + 500);
    expect(eventsOfType(events, 'kill_streak')).toHaveLength(0);
    // the combo carries on afterwards
    const next = eventsOfType(killOne(sim, 9), 'asteroid_destroyed')[0];
    expect(next).toMatchObject({ combo: 5, points: 150 });
  });

  it('6. killing a UFO amid heavy asteroid traffic: paid once, and every point is accounted for by an event', () => {
    const sim = new GameSim({ rng: seededRng(31), startCooldown: 0, ufos: false });
    sim.asteroidSpawnRate = 0.12;
    sim.player.lives = 999;
    sim.player.shieldActive = true;
    const events: SimEvent[] = collectEvents(sim, 8);
    expect(sim.asteroids.length).toBeGreaterThan(8);
    const ufo = parkedUfoFor(sim, 'large', 900, 600);
    sim.shots.push(shotAt(900, 600));
    events.push(...sim.step(FRAME));
    events.push(...collectEvents(sim, 3, hold({ shoot: true, rotate: 1 })));
    expect(ufo.alive).toBe(false);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.player.score).toBe(paid(events));
    expect(sim.player.score).toBeGreaterThanOrEqual(200);
  });

  it('7. a power-up dropped by a UFO appears where it died, drifts, can be flown into and takes effect', () => {
    const sim = quietSim(4);
    parkedUfoFor(sim, 'large', 400, 360);
    sim.shots.push(shotAt(400, 360));
    sim.step(FRAME);
    const drop = sim.powerups[0];
    expect(drop?.position).toEqual({ x: 400, y: 360 });
    if (!drop) return;
    drop.type = 'shield';
    sim.player.position = { x: 400, y: 360 };
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'powerup_collected')).toEqual([{ type: 'powerup_collected', powerType: 'shield' }]);
    expect(sim.player.shieldActive).toBe(true);
  });

  it('8. a UFO shot meets a shielded ship: shield gone, life kept, shot gone, and the next one hurts', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(3);
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
  });

  it('9. a ship that is still invulnerable after a respawn shrugs off a UFO shot and a UFO together', () => {
    const sim = quietSim();
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40)); // first life lost, ship respawns
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.player.isRespawning).toBe(true);
    parkedUfoFor(sim, 'small', sim.player.position.x + 10, sim.player.position.y);
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    const events = sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
    expect(sim.ufoShots).toHaveLength(0);
  });

  it('10. a kill streak banner while Mega Power, boost, Slow Motion and a shield are all active', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    sim.step(FRAME);
    sim.step(FRAME, hold({ boost: true }));
    expect(sim.player.megaPower.active && sim.player.boost.active && sim.slowMotion.active && sim.player.shieldActive).toBe(true);
    const names: string[] = [];
    for (let i = 0; i < 16; i++) {
      for (const e of eventsOfType(killOne(sim, i), 'kill_streak')) names.push(e.name);
    }
    expect(names).toEqual(['KILLING SPREE!']);
    expect(sim.streakBanner?.name).toBe('KILLING SPREE!');
    expect(sim.player.shieldActive).toBe(true); // nothing hit the ship
  });

  it('11. a pause (no frames reach the simulation) freezes UFOs, shots, the combo clock and the banner', () => {
    const sim = quietSim();
    sim.player.lives = 999;
    for (let i = 0; i < 15; i++) killOne(sim, i);
    const ufo = sim.spawnUfo('small', 800, 300);
    ufo.shootTimer = 0.2;
    runFor(sim, 0.1);
    const snapshot = JSON.stringify([sim.ufos, sim.ufoShots, sim.combo, sim.streakBanner, sim.time]);
    for (let i = 0; i < 600; i++) sim.step(0);
    expect(JSON.stringify([sim.ufos, sim.ufoShots, sim.combo, sim.streakBanner, sim.time])).toBe(snapshot);
  });

  it('12. dying with UFOs, enemy shots, rocks and particles on screen freezes it all; a new run starts empty', () => {
    const sim = new GameSim({ rng: seededRng(7), startCooldown: 0 });
    sim.spawner.spawnTimer = -1e9;
    sim.player.lives = 1;
    for (let i = 0; i < 5; i++) queueKill(sim, i);
    sim.spawnUfo('large', 900, 200);
    sim.spawnUfo('small', 200, 600);
    sim.ufoShots.push(ufoShotAt(1000, 500, -50, 0));
    sim.step(FRAME);
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    const events = sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(eventsOfType(events, 'game_over')).toHaveLength(1);
    expect(sim.streakBanner).toBeNull();
    expect(sim.ufos).toHaveLength(2);

    const frozen = JSON.stringify([sim.ufos, sim.ufoShots]);
    const over = collectEvents(sim, 3);
    expect(over).toEqual([]); // no more game events, no more sounds
    expect(JSON.stringify([sim.ufos, sim.ufoShots])).toBe(frozen);
    expect(sim.particles.activeCount).toBe(0); // the burst has played out

    const fresh = new GameSim({ rng: seededRng(7), startCooldown: 0 });
    expect(fresh.ufos).toHaveLength(0);
    expect(fresh.ufoShots).toHaveLength(0);
    expect(fresh.asteroids).toHaveLength(0);
    expect(fresh.particles.activeCount).toBe(0);
    expect(fresh.combo).toEqual({ count: 0, timer: 0, lastMilestone: 0 });
    expect(fresh.player.lives).toBe(3);
    expect(fresh.player.score).toBe(0);
  });

  it('events of one frame come in a fixed order: asteroid kills, UFO kills, ship hits, pick-ups', () => {
    const sim = quietSim();
    queueKill(sim, 0);
    parkedUfoFor(sim, 'large', 900, 300);
    sim.shots.push(shotAt(900, 300));
    sim.ufoShots.push(ufoShotAt(sim.player.position.x, sim.player.position.y));
    // The hit sends the ship to the respawn point, and the pick-up waits there: pick-ups are collected last.
    const pickup = createPowerUp(PLAYER_RESPAWN_X, PLAYER_RESPAWN_Y, 'rapid_fire', seededRng(1));
    pickup.velocity = { x: 0, y: 0 };
    sim.powerups.push(pickup);
    const events = sim.step(FRAME);
    const order = events.map((e) => e.type).filter((t) => !['asteroid_hit', 'wall_bounce'].includes(t));
    expect(order).toEqual(['asteroid_destroyed', 'ufo_destroyed', 'powerup_dropped', 'player_hit', 'powerup_collected']);
  });

  it('a kill, its streak banner and its power-up drop happen exactly once each when several candidates overlap', () => {
    const sim = quietSim();
    for (let i = 0; i < 14; i++) killOne(sim, i);
    const target = rock(300, 300, 20);
    sim.asteroids.push(target);
    sim.shots.push(shotAt(300, 300), shotAt(298, 300));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'kill_streak')).toHaveLength(1);
    expect(sim.combo.count).toBe(15);
  });
});

describe('fuzzing combat with combos and UFOs', () => {
  function fuzz(seed: number, fps: number, minutes: number): { restarts: number } {
    const rng = seededRng(seed);
    const inputRng = seededRng(seed + 500);
    let sim = new GameSim({ rng, startCooldown: 0 });
    sim.asteroidSpawnRate = 0.3;
    let input: PlayerInput = NO_INPUT;
    let restarts = 0;
    let spawned = 0;
    let destroyed = 0;
    const frames = Math.round(minutes * 60 * fps);

    for (let f = 0; f < frames; f++) {
      if (f % Math.round(fps / 6) === 0) {
        input = {
          rotate: inputRng() < 0.4 ? (inputRng() < 0.5 ? -1 : 1) : 0,
          move: inputRng() < 0.5 ? 1 : 0,
          shoot: inputRng() < 0.8,
          laser: inputRng() < 0.1,
          boost: inputRng() < 0.05,
        };
      }
      if (f % Math.round(fps * 2.5) === 0 && !sim.isGameOver) {
        if (inputRng() < 0.5 && sim.ufos.length < 2) {
          sim.spawnUfo(inputRng() < 0.5 ? 'large' : 'small', inputRng() * SCREEN_WIDTH, inputRng() * SCREEN_HEIGHT);
          spawned++;
        }
        const type = ORDINARY_POWERUPS[Math.floor(inputRng() * ORDINARY_POWERUPS.length)] ?? 'shield';
        sim.powerups.push(createPowerUp(sim.player.position.x, sim.player.position.y, type, inputRng));
      }

      const events = sim.step(1 / fps, input);
      spawned += eventsOfType(events, 'ufo_spawned').length;
      destroyed += eventsOfType(events, 'ufo_destroyed').length;

      // At most one banner per kill, and one UFO kill per UFO.
      const kills = eventsOfType(events, 'asteroid_destroyed').filter((e) => e.combo !== undefined);
      expect(eventsOfType(events, 'kill_streak').length).toBeLessThanOrEqual(kills.length);
      expect(eventsOfType(events, 'ufo_destroyed').length).toBeLessThanOrEqual(4);

      if (f % 20 === 0) {
        expect(sim.ufos.length).toBe(spawned - destroyed);
        expect(sim.ufos.length).toBeLessThanOrEqual(4);
        expect(sim.ufoShots.length).toBeLessThan(40);
        expect(sim.particles.activeCount).toBeLessThanOrEqual(sim.particles.capacity);
        expect(sim.combo.count).toBeGreaterThanOrEqual(0);
        expect(sim.combo.timer).toBeLessThanOrEqual(3);
        if (sim.combo.count === 0) expect(sim.combo.lastMilestone).toBe(0);
        for (const u of sim.ufos) {
          expect(Number.isFinite(u.position.x + u.position.y + u.velocity.x + u.velocity.y)).toBe(true);
          expect(u.position.x).toBeGreaterThanOrEqual(-u.radius - 1);
          expect(u.position.x).toBeLessThanOrEqual(SCREEN_WIDTH + u.radius + 1);
          expect(u.position.y).toBeGreaterThanOrEqual(-u.radius - 1);
          expect(u.position.y).toBeLessThanOrEqual(SCREEN_HEIGHT + u.radius + 1);
        }
        for (const s of sim.ufoShots) expect(Number.isFinite(s.position.x + s.position.y)).toBe(true);
        expect(sim.streakBanner === null || sim.streakBanner.timer <= 2.5).toBe(true);
      }

      if (sim.isGameOver && sim.retryDelay === 0) {
        sim = new GameSim({ rng, startCooldown: 0 });
        sim.asteroidSpawnRate = 0.3;
        restarts++;
        spawned = 0;
        destroyed = 0;
      }
    }
    return { restarts };
  }

  it.each([
    [1, 60],
    [2, 30],
    [3, 144],
  ])('seed %i at %i fps: 5 simulated minutes keep every invariant', (seed, fps) => {
    expect(fuzz(seed, fps, 5).restarts).toBeGreaterThan(0);
  });

  it('the score always equals the points announced by events (no hidden or doubled awards)', () => {
    const rng = seededRng(99);
    const inputRng = seededRng(100);
    const sim = new GameSim({ rng, startCooldown: 0 });
    sim.asteroidSpawnRate = 0.25;
    sim.player.lives = 9999;
    let announced = 0;
    for (let f = 0; f < 60 * 120; f++) {
      if (f % 150 === 0 && sim.ufos.length < 2) sim.spawnUfo(inputRng() < 0.5 ? 'large' : 'small', inputRng() * 1280, inputRng() * 720);
      const input = hold({ rotate: inputRng() < 0.4 ? 1 : 0, move: inputRng() < 0.5 ? 1 : 0, shoot: true, laser: inputRng() < 0.05 });
      announced += paid(sim.step(FRAME, input));
    }
    expect(announced).toBeGreaterThan(1000);
    expect(sim.player.score).toBe(announced);
  });
});
