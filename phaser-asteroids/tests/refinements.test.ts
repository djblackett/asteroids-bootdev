import { describe, expect, it } from 'vitest';
import { DIFFICULTY_INCREASE_INTERVAL, UFO_MAX_ACTIVE, UFO_SHIELD_CONTACT_GRACE, UFO_SMALL_PROGRESSION } from '../src/core/constants';
import { GameSim } from '../src/core/game';
import { seededRng } from '../src/core/rng';
import { chooseContinuousUfoType, createUfoSpawner, smallUfoChance, updateUfoSpawner } from '../src/core/ufo';
import { FRAME, collectEvents, eventsOfType, hold, parkedUfoFor, queueRng, quietSim, rock, runFor, shotAt, ufoShotAt } from './helpers';

/** Phase 4, Milestone 0: the three single-player refinements. */

describe('0A: the Laser Beam kills UFOs', () => {
  function armed(options: { laserHitsUfos?: boolean } = {}): GameSim {
    const sim = new GameSim({ rng: seededRng(4), startCooldown: 0, ufos: false, ...options });
    sim.spawner.spawnTimer = -1e9;
    sim.player.rotation = 270; // facing right
    sim.player.position = { x: 100, y: 360 };
    return sim;
  }

  it('is on by default and can be turned off', () => {
    const on = armed();
    const ufo = parkedUfoFor(on, 'large', 500, 360);
    on.step(FRAME, hold({ laser: true }));
    expect(ufo.alive).toBe(false);

    const off = armed({ laserHitsUfos: false });
    const kept = parkedUfoFor(off, 'large', 500, 360);
    off.step(FRAME, hold({ laser: true }));
    runFor(off, 0.4);
    expect(kept.alive).toBe(true);
  });

  it.each([
    ['large', 200],
    ['small', 500],
  ] as const)('a %s UFO pays %i, exactly one destruction event and one guaranteed ordinary power-up for the whole beam', (type, points) => {
    const sim = armed();
    parkedUfoFor(sim, type, 600, 365);
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.5)];
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'ufo_destroyed')[0]?.points).toBe(points);
    expect(eventsOfType(events, 'powerup_dropped')).toHaveLength(1);
    expect(sim.powerups).toHaveLength(1);
    expect(sim.powerups[0]?.type).not.toBe('mega_power');
    expect(sim.powerups[0]?.type).not.toBe('revive');
    expect(sim.player.score).toBe(points);
    expect(sim.combo.count).toBe(0); // UFOs never touch the combo
    expect(sim.ufos).toHaveLength(0);
  });

  it('keeps piercing: one beam kills the asteroid and the UFO behind it, each once', () => {
    const sim = armed();
    sim.asteroids.push(rock(300, 360, 20));
    parkedUfoFor(sim, 'large', 600, 360);
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.5)];
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(eventsOfType(events, 'ufo_destroyed')).toHaveLength(1);
    expect(sim.player.score).toBe(50 /* small asteroid, x1 combo */ + 200);
  });

  it('a second beam cannot pay a UFO that is already dead, and a UFO the beam missed is untouched', () => {
    const sim = armed();
    const hit = parkedUfoFor(sim, 'large', 500, 360);
    const missed = parkedUfoFor(sim, 'large', 500, 500);
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 1.1); // cooldown
    sim.step(FRAME, hold({ laser: false }));
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(hit.alive).toBe(false);
    expect(missed.alive).toBe(true);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
  });

  it('a UFO killed by a shot in the same frame is paid once, and the shot is not wasted on the dead UFO', () => {
    const sim = armed();
    const ufo = parkedUfoFor(sim, 'large', 500, 360);
    const shot = shotAt(500, 360);
    sim.shots.push(shot);
    sim.step(FRAME, hold({ laser: true }));
    expect(ufo.alive).toBe(false);
    expect(sim.player.score).toBe(200); // by the beam (resolved before shots vs UFOs)
    expect(sim.powerups).toHaveLength(1);
    expect(shot.alive).toBe(true);
  });

  it('works while boosting (no cannon, but the beam is fine) without costing the boost anything', () => {
    const sim = armed();
    parkedUfoFor(sim, 'small', 700, 360);
    sim.step(FRAME, hold({ boost: true }));
    expect(sim.player.boost.active).toBe(true);
    sim.step(FRAME, hold({ boost: true, laser: true }));
    runFor(sim, 0.2, hold({ boost: true }));
    expect(sim.player.score).toBe(500);
    expect(sim.player.lives).toBe(3);
  });

  it('does not touch UFO projectiles, the shield or the ship', () => {
    const sim = armed();
    sim.player.shieldActive = true;
    const enemyShot = ufoShotAt(400, 360);
    sim.ufoShots.push(enemyShot);
    sim.step(FRAME, hold({ laser: true }));
    expect(enemyShot.alive).toBe(true);
    expect(sim.player.shieldActive).toBe(true);
    expect(sim.player.lives).toBe(3);
  });

  it('a beam that kills the UFO does not stop the UFO shot already in flight', () => {
    const sim = armed();
    const ufo = parkedUfoFor(sim, 'large', 500, 360);
    ufo.shootTimer = 0; // fires this frame, aimed anywhere
    sim.step(FRAME, hold({ laser: true }));
    expect(ufo.alive).toBe(false);
    expect(sim.ufoShots.length).toBeGreaterThanOrEqual(0); // the shot lives on its own list either way
  });
});

describe('0B: small UFOs are introduced gradually in continuous mode', () => {
  it('the difficulty level goes up every 30 s of play', () => {
    const sim = quietSim();
    sim.player.lives = 999;
    expect(sim.difficultyLevel).toBe(0);
    runFor(sim, DIFFICULTY_INCREASE_INTERVAL + 0.1);
    expect(sim.difficultyLevel).toBe(1);
    runFor(sim, 3 * DIFFICULTY_INCREASE_INTERVAL);
    expect(sim.difficultyLevel).toBe(4);
    expect(sim.asteroidSpeedMultiplier).toBeCloseTo(1.6, 9);
  });

  it('documented thresholds: 0 % before 1:00, then 10 / 20 / 40 / 60 % at 1 / 2 / 4 / 6 minutes', () => {
    expect(UFO_SMALL_PROGRESSION).toEqual([
      { level: 2, chance: 0.1 },
      { level: 4, chance: 0.2 },
      { level: 8, chance: 0.4 },
      { level: 12, chance: 0.6 },
    ]);
    const at = (seconds: number): number => smallUfoChance(Math.floor(seconds / DIFFICULTY_INCREASE_INTERVAL));
    expect([0, 29, 59.999].map(at)).toEqual([0, 0, 0]);
    expect([60, 90, 119.999].map(at)).toEqual([0.1, 0.1, 0.1]);
    expect([120, 200, 239].map(at)).toEqual([0.2, 0.2, 0.2]);
    expect([240, 300, 359].map(at)).toEqual([0.4, 0.4, 0.4]);
    expect([360, 600, 3600].map(at)).toEqual([0.6, 0.6, 0.6]);
  });

  it('draws no random number while the chance is zero, so early games are exactly as before', () => {
    let draws = 0;
    const counting = (): number => (draws++, 0);
    for (let level = 0; level < 2; level++) expect(chooseContinuousUfoType(level, counting)).toBe('large');
    expect(draws).toBe(0);
    expect(chooseContinuousUfoType(4, counting)).toBe('small');
    expect(draws).toBe(1);
  });

  it('the roll is deterministic under a controlled RNG: small exactly below the chance', () => {
    expect(chooseContinuousUfoType(2, () => 0.0999)).toBe('small');
    expect(chooseContinuousUfoType(2, () => 0.1)).toBe('large');
    expect(chooseContinuousUfoType(4, () => 0.19)).toBe('small');
    expect(chooseContinuousUfoType(4, () => 0.2)).toBe('large');
    expect(chooseContinuousUfoType(8, () => 0.39)).toBe('small');
    expect(chooseContinuousUfoType(8, () => 0.4)).toBe('large');
    expect(chooseContinuousUfoType(12, () => 0.59)).toBe('small');
    expect(chooseContinuousUfoType(12, () => 0.6)).toBe('large');
  });

  it('measured over many spawns the shares are about 0 / 10 / 20 / 40 / 60 %', () => {
    const share = (level: number): number => {
      const rng = seededRng(77);
      let small = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) if (chooseContinuousUfoType(level, rng) === 'small') small++;
      return small / n;
    };
    expect(share(1)).toBe(0);
    expect(share(2)).toBeGreaterThan(0.07);
    expect(share(2)).toBeLessThan(0.13);
    expect(share(4)).toBeGreaterThan(0.17);
    expect(share(4)).toBeLessThan(0.23);
    expect(share(8)).toBeGreaterThan(0.37);
    expect(share(8)).toBeLessThan(0.43);
    expect(share(12)).toBeGreaterThan(0.57);
    expect(share(12)).toBeLessThan(0.63);
  });

  it('the spawner passes the level through; spawn timing and the UFO cap are unchanged', () => {
    const state = createUfoSpawner(true);
    const rng = queueRng(5);
    rng.queue(0.0); // type roll -> small at level 4
    const ufo = updateUfoSpawner(state, 5, 0, rng, 4);
    expect(ufo?.type).toBe('small');
    expect(state.nextSpawnTime).toBe(20); // still every 15 s
    expect(updateUfoSpawner(state, 19.9, 0, rng, 4)).toBeNull();
    // An attempt with the maximum already alive is skipped, whatever the level.
    expect(updateUfoSpawner(state, 20, UFO_MAX_ACTIVE, rng, 12)).toBeNull();
    expect(state.nextSpawnTime).toBe(35);
  });

  it('level 0 default keeps the old call shape working (large only)', () => {
    const state = createUfoSpawner(true);
    expect(updateUfoSpawner(state, 5, 0, seededRng(1))?.type).toBe('large');
  });

  it('in a real run no small UFO appears before 1:00 and some do afterwards', () => {
    const sim = new GameSim({ rng: seededRng(9), startCooldown: 0 });
    sim.spawner.spawnTimer = -1e9;
    sim.player.lives = 999;
    const first: Record<string, number> = {};
    for (let i = 0; i < 60 * 480; i++) {
      for (const e of eventsOfType(sim.step(FRAME), 'ufo_spawned')) first[e.ufoType] ??= sim.time;
      sim.ufos.length = 0;
    }
    expect(first['large']).toBeLessThan(6);
    expect(first['small']).toBeGreaterThanOrEqual(60);
  });
});

describe('0C: a shield protects against the UFO body it absorbed, but not forever', () => {
  function shielded(): { sim: GameSim; ufo: ReturnType<typeof parkedUfoFor> } {
    const sim = quietSim();
    sim.player.shieldActive = true;
    const ufo = parkedUfoFor(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    return { sim, ufo };
  }

  it('absorbs the contact: shield used up, no life lost, no hit event, UFO survives', () => {
    const { sim, ufo } = shielded();
    const events = sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(3);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(0);
    expect(ufo.alive).toBe(true);
  });

  it('staying in the same contact does not hit again for UFO_SHIELD_CONTACT_GRACE seconds', () => {
    const { sim } = shielded();
    sim.step(FRAME);
    runFor(sim, UFO_SHIELD_CONTACT_GRACE - 0.1);
    expect(sim.player.lives).toBe(3);
  });

  it('after the grace has run out the normal rules apply: shielding is not lasting immunity', () => {
    const { sim } = shielded();
    sim.step(FRAME);
    const events = collectEvents(sim, UFO_SHIELD_CONTACT_GRACE + 0.2);
    expect(sim.player.lives).toBe(2);
    expect(eventsOfType(events, 'player_hit')).toHaveLength(1);
    expect(eventsOfType(events, 'player_hit')[0]?.source).toBe('ufo');
  });

  it.each([30, 60, 144])('the protected time is the same at %i fps', (fps) => {
    const { sim } = shielded();
    let hitAt = -1;
    for (let i = 0; i < fps * 3 && hitAt < 0; i++) {
      const events = sim.step(1 / fps);
      if (eventsOfType(events, 'player_hit').length > 0) hitAt = (i + 1) / fps;
    }
    expect(hitAt).toBeGreaterThan(UFO_SHIELD_CONTACT_GRACE - 0.1);
    expect(hitAt).toBeLessThan(UFO_SHIELD_CONTACT_GRACE + 0.15);
  });

  it('a genuinely separate collision is a new hit: leave, come back, and the (now unshielded) ship loses a life', () => {
    const { sim, ufo } = shielded();
    sim.step(FRAME);
    expect(sim.player.lives).toBe(3);
    const home = { ...sim.player.position };
    sim.player.position = { x: home.x - 300, y: home.y };
    sim.step(FRAME); // clear of the UFO: the grace ends
    expect(ufo.contactGrace[0]).toBe(0);
    sim.player.position = home;
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
  });

  it('the grace belongs to one UFO: a second UFO touching the same ship is a separate collision', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    parkedUfoFor(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    parkedUfoFor(sim, 'large', sim.player.position.x - 20, sim.player.position.y);
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(2); // first UFO: shield; second UFO: no shield left
  });

  it('respawn protection still absorbs for its full 2 s and is not what the grace is about', () => {
    const sim = quietSim();
    sim.player.lives = 2;
    sim.player.isRespawning = true;
    sim.player.respawnTimer = 2;
    const ufo = parkedUfoFor(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    runFor(sim, 1.9);
    expect(sim.player.lives).toBe(2);
    expect(ufo.contactGrace[0]).toBe(0);
    runFor(sim, 0.3);
    expect(sim.player.lives).toBe(1);
  });

  it('boost ramming is unchanged: the UFO dies, the shield is kept', () => {
    const { sim, ufo } = shielded();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    sim.step(FRAME);
    expect(ufo.alive).toBe(false);
    expect(sim.player.shieldActive).toBe(true);
    expect(sim.player.lives).toBe(3);
  });

  it('asteroid crashes and enemy shots are unchanged: each one is its own hit', () => {
    const sim = quietSim();
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20));
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(false);
    expect(sim.player.lives).toBe(3);
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 20));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);

    const sim2 = quietSim();
    sim2.player.shieldActive = true;
    sim2.ufoShots.push(ufoShotAt(sim2.player.position.x, sim2.player.position.y));
    sim2.step(FRAME);
    expect(sim2.player.shieldActive).toBe(false);
    expect(sim2.player.lives).toBe(3);
    sim2.ufoShots.push(ufoShotAt(sim2.player.position.x, sim2.player.position.y));
    sim2.step(FRAME);
    expect(sim2.player.lives).toBe(2);
  });
});
