import { describe, expect, it } from 'vitest';
import { createLaser, distanceToBeam, laserEndPosition, laserHits, updateLaser } from '../src/core/laser';
import { createPlayer, fireLaser, updatePlayer } from '../src/core/player';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/core/constants';
import { FRAME, hold, quietSim, rock, runFor } from './helpers';

describe('laser geometry', () => {
  it.each([
    [0, { x: 640, y: SCREEN_HEIGHT }, 'Down'],
    [90, { x: 0, y: 360 }, 'Left'],
    [180, { x: 640, y: 0 }, 'Up'],
    [270, { x: SCREEN_WIDTH, y: 360 }, 'Right'],
  ])('a beam from the centre at %i degrees ends on the %s edge', (direction, end) => {
    const e = laserEndPosition({ x: 640, y: 360 }, direction);
    expect(e.x).toBeCloseTo(end.x, 6);
    expect(e.y).toBeCloseTo(end.y, 6);
  });

  it('a diagonal beam stops at the nearest edge', () => {
    // Facing Up-Right (225 deg) from the centre: reaches the top edge (y=0) after 360 px of rise, x = 640 + 360.
    const e = laserEndPosition({ x: 640, y: 360 }, 225);
    expect(e.y).toBeCloseTo(0, 6);
    expect(e.x).toBeCloseTo(1000, 6);
  });

  it('measures distance to the segment, clamping behind the start and beyond the end', () => {
    const beam = { start: { x: 100, y: 100 }, end: { x: 300, y: 100 } };
    expect(distanceToBeam(beam, { x: 200, y: 130 })).toBeCloseTo(30, 9); // perpendicular
    expect(distanceToBeam(beam, { x: 50, y: 100 })).toBeCloseTo(50, 9); // behind the start
    expect(distanceToBeam(beam, { x: 340, y: 130 })).toBeCloseTo(50, 9); // beyond the end (3-4-5)
  });

  it('hits a circle when the distance is within its radius (inclusive), once per beam', () => {
    const beam = createLaser({ x: 100, y: 100 }, 270, 1);
    const target = rock(400, 159.9, 60); // 59.9 px from the beam, radius 60
    expect(laserHits(beam, target)).toBe(true);
    expect(laserHits(beam, target)).toBe(false);
    expect(laserHits(beam, rock(400, 160.1, 60))).toBe(false); // 60.1 px: just misses
    expect(laserHits(beam, rock(400, 159.9, 60))).toBe(true); // a different object is a different target
  });

  it('expires after 0.3 s', () => {
    const beam = createLaser({ x: 0, y: 0 }, 0, 1);
    expect(updateLaser(beam, 0.29)).toBe(true);
    expect(updateLaser(beam, 0.02)).toBe(false);
  });
});

describe('firing rules', () => {
  it('starts at the ship nose and points the way the ship faces', () => {
    const p = createPlayer(640, 360);
    p.rotation = 270;
    const beam = fireLaser(p);
    expect(beam?.start.x).toBeCloseTo(660, 6);
    expect(beam?.start.y).toBeCloseTo(360, 6);
    expect(beam?.end.x).toBeCloseTo(SCREEN_WIDTH, 6);
    expect(beam?.owner).toBe(1);
  });

  it('spends one of 15 charges and then waits out a 1 s cooldown', () => {
    const p = createPlayer(640, 360);
    expect(fireLaser(p)).not.toBeNull();
    expect(p.laser.shotsRemaining).toBe(14);
    expect(fireLaser(p)).toBeNull();
    expect(p.laser.shotsRemaining).toBe(14);
    for (let i = 0; i < 61; i++) updatePlayer(p, hold({}), FRAME);
    expect(fireLaser(p)).not.toBeNull();
  });

  it('fires once per key press: holding the key does nothing more', () => {
    const p = createPlayer(640, 360);
    let beams = 0;
    for (let i = 0; i < 180; i++) beams += updatePlayer(p, hold({ laser: true }), FRAME).laser ? 1 : 0;
    expect(beams).toBe(1);
  });

  it('a press during cooldown is wasted: the key must be released and pressed again', () => {
    const p = createPlayer(640, 360);
    expect(updatePlayer(p, hold({ laser: true }), FRAME).laser).not.toBeNull();
    for (let i = 0; i < 10; i++) updatePlayer(p, hold({ laser: false }), FRAME); // release
    expect(updatePlayer(p, hold({ laser: true }), FRAME).laser).toBeNull(); // still cooling down
    for (let i = 0; i < 90; i++) updatePlayer(p, hold({ laser: true }), FRAME); // held through the cooldown
    expect(p.laser.cooldown).toBeLessThanOrEqual(0);
    expect(updatePlayer(p, hold({ laser: true }), FRAME).laser).toBeNull(); // still held, nothing fires
    updatePlayer(p, hold({ laser: false }), FRAME);
    expect(updatePlayer(p, hold({ laser: true }), FRAME).laser).not.toBeNull();
  });

  it('runs out after 15 beams', () => {
    const p = createPlayer(640, 360);
    let fired = 0;
    for (let n = 0; n < 20; n++) {
      if (updatePlayer(p, hold({ laser: true }), FRAME).laser) fired++;
      updatePlayer(p, hold({ laser: false }), FRAME);
      for (let i = 0; i < 62; i++) updatePlayer(p, hold({}), FRAME);
    }
    expect(fired).toBe(15);
    expect(p.laser.shotsRemaining).toBe(0);
  });

  it('can be fired while boosting and while the start grace period blocks shooting', () => {
    const p = createPlayer(640, 360);
    p.canShoot = false;
    p.boost.active = true;
    p.boost.timer = 3;
    expect(updatePlayer(p, hold({ laser: true, shoot: true }), FRAME).laser).not.toBeNull();
  });
});

describe('laser in the simulation', () => {
  function armedSim() {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    return sim;
  }

  it('pierces every asteroid on its path and scores each kill', () => {
    const sim = armedSim();
    const rocks = [rock(300, 360, 60), rock(600, 340, 40), rock(900, 379, 20), rock(1100, 300, 20)];
    sim.asteroids.push(...rocks);
    const events = sim.step(FRAME, hold({ laser: true }));
    expect(events).toContainEqual({ type: 'laser_fired' });
    expect(rocks.slice(0, 3).every((r) => r.dying)).toBe(true);
    expect(rocks[3]?.dying).toBe(false); // 60 px off the beam, radius 20
    expect(sim.player.score).toBe(10 + 20 + 50);
  });

  it('does not consume or interact with ordinary shots', () => {
    const sim = armedSim();
    sim.asteroids.push(rock(600, 360, 20));
    sim.shots.push({ position: { x: 200, y: 360 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    sim.step(FRAME, hold({ laser: true }));
    expect(sim.shots).toHaveLength(1);
  });

  it('hits an asteroid only once however long the beam lasts', () => {
    const sim = armedSim();
    const armored = rock(500, 360, 60, 'armored');
    sim.asteroids.push(armored);
    sim.step(FRAME, hold({ laser: true }));
    expect(armored.hitPoints).toBe(1);
    expect(sim.player.score).toBe(0);
    runFor(sim, 0.4);
    expect(armored.hitPoints).toBe(1); // still alive after the whole beam, one hit only
    expect(armored.dying).toBe(false);
  });

  it('a second beam finishes an armored asteroid (25 points when large)', () => {
    const sim = armedSim();
    const armored = rock(500, 360, 60, 'armored');
    sim.asteroids.push(armored);
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 1.2); // beam over, cooldown over, key released
    sim.step(FRAME, hold({ laser: true }));
    expect(armored.dying).toBe(true);
    expect(sim.player.score).toBe(25);
  });

  it('counts an asteroid at the beam end only if it actually touches the segment', () => {
    const sim = armedSim();
    const touching = rock(SCREEN_WIDTH + 10, 360, 20); // 10 px past the end, radius 20
    const clear = rock(SCREEN_WIDTH + 30, 360, 20);
    sim.asteroids.push(touching, clear);
    sim.step(FRAME, hold({ laser: true }));
    expect(touching.dying).toBe(true);
    expect(clear.dying).toBe(false);
  });

  it('follows the ship heading in all four cardinal directions', () => {
    for (const [rotation, x, y] of [
      [0, 640, 600],
      [90, 200, 360],
      [180, 640, 100],
      [270, 1000, 360],
    ] as const) {
      const sim = quietSim();
      sim.player.position = { x: 640, y: 360 };
      sim.player.rotation = rotation;
      const target = rock(x, y, 20);
      const decoy = rock(x === 640 ? 300 : x, y === 360 ? 600 : y, 20); // off-axis
      sim.asteroids.push(target, decoy);
      sim.step(FRAME, hold({ laser: true }));
      expect(target.dying).toBe(true);
      expect(decoy.dying).toBe(false);
    }
  });

  it('keeps hitting for its whole 0.3 s life: asteroids drifting in are caught, and the beam then disappears', () => {
    const sim = armedSim();
    const drifter = rock(600, 200, 20, 'standard', { x: 0, y: 750 });
    sim.asteroids.push(drifter);
    sim.step(FRAME, hold({ laser: true }));
    expect(sim.lasers).toHaveLength(1);
    runFor(sim, 0.2);
    expect(drifter.dying || !drifter.alive).toBe(true);
    runFor(sim, 0.2);
    expect(sim.lasers).toHaveLength(0);
  });

  it('children spawned into a live beam are hit by it too (Python behaviour)', () => {
    const sim = armedSim();
    sim.asteroids.push(rock(500, 360, 60));
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.5);
    // 10 for the large one, then 20 for each medium child caught in the same beam.
    expect(sim.player.score).toBeGreaterThanOrEqual(50);
  });

  it('is not slowed by Slow Motion and does not hurt the ship', () => {
    const sim = armedSim();
    sim.slowMotion = { active: true, timer: 6 };
    sim.asteroids.push(rock(500, 360, 20));
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.35);
    expect(sim.lasers).toHaveLength(0);
    expect(sim.player.lives).toBe(3);
  });

  it('a beam fired on the frame of game over is discarded', () => {
    const sim = armedSim();
    sim.player.lives = 1;
    sim.asteroids.push(rock(100, 360, 40));
    sim.step(FRAME, hold({ laser: true }));
    expect(sim.isGameOver).toBe(true);
    expect(sim.lasers).toHaveLength(0);
  });
});
