import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, PLAYER_START_X, PLAYER_START_Y, SCREEN_WIDTH } from '../src/core/constants';
import { activateBoost, createPlayer, respawnPlayer, updatePlayer } from '../src/core/player';
import { FRAME, hold, quietSim, rock, runFor } from './helpers';

describe('boost activation', () => {
  it('lasts 3 s, then movement returns to 300 px/s', () => {
    const p = createPlayer(100, 360);
    p.rotation = 270;
    updatePlayer(p, hold({ boost: true, move: 1 }), FRAME);
    expect(p.boost.active).toBe(true);
    // Python moves first and activates afterwards, so the activation frame itself is still at 300 px/s.
    expect(p.position.x - 100).toBeCloseTo(300 * FRAME, 6);
    const before = p.position.x;
    updatePlayer(p, hold({ boost: true, move: 1 }), FRAME);
    expect(p.position.x - before).toBeCloseTo(750 * FRAME, 6); // 2.5x speed

    for (let i = 0; i < 60 * 2.9; i++) updatePlayer(p, hold({ boost: true, move: 1 }), FRAME);
    expect(p.boost.active).toBe(true);
    for (let i = 0; i < 60 * 0.2; i++) updatePlayer(p, hold({ boost: false, move: 1 }), FRAME);
    expect(p.boost.active).toBe(false);

    const x = p.position.x;
    p.position.x = 100;
    p.velocity = { x: 0, y: 0 }; // discard any wall-bounce residue from the run
    updatePlayer(p, hold({ move: 1 }), FRAME);
    expect(p.position.x - 100).toBeCloseTo(300 * FRAME, 6);
    expect(x).toBeGreaterThan(100);
  });

  it('covers 2.5x the distance in the same time, at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const normal = createPlayer(50, 360);
      const boosted = createPlayer(50, 360);
      normal.rotation = boosted.rotation = 270;
      boosted.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
      for (let i = 0; i < fps; i++) {
        updatePlayer(normal, hold({ move: 1 }), 1 / fps);
        updatePlayer(boosted, hold({ move: 1, boost: true }), 1 / fps);
      }
      expect((boosted.position.x - 50) / (normal.position.x - 50)).toBeCloseTo(2.5, 6);
    }
  });

  it('fires once per key press and the 8 s cooldown starts at activation', () => {
    const p = createPlayer(640, 360);
    let starts = 0;
    for (let i = 0; i < 60 * 3.5; i++) starts += updatePlayer(p, hold({ boost: true }), FRAME).boostStarted ? 1 : 0;
    expect(starts).toBe(1);

    // 3.5 s in: boost over, 4.5 s of the cooldown left. A fresh press is refused...
    updatePlayer(p, hold({ boost: false }), FRAME);
    expect(updatePlayer(p, hold({ boost: true }), FRAME).boostStarted).toBe(false);
    updatePlayer(p, hold({ boost: false }), FRAME);

    // ...until 8 s after the first activation.
    for (let i = 0; i < 60 * 4.3; i++) updatePlayer(p, hold({ boost: false }), FRAME);
    expect(p.boost.cooldown).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 0.4; i++) updatePlayer(p, hold({ boost: false }), FRAME);
    expect(p.boost.cooldown).toBeLessThanOrEqual(0);
    expect(updatePlayer(p, hold({ boost: true }), FRAME).boostStarted).toBe(true);
  });

  it('blocks the main cannon while it runs', () => {
    const p = createPlayer(640, 360);
    updatePlayer(p, hold({ boost: true }), FRAME);
    expect(updatePlayer(p, hold({ shoot: true }), FRAME).shots).toHaveLength(0);
    for (let i = 0; i < 60 * 3.1; i++) updatePlayer(p, hold({}), FRAME);
    expect(updatePlayer(p, hold({ shoot: true }), FRAME).shots).toHaveLength(1);
  });

  it('is cancelled by respawning, but its cooldown keeps running', () => {
    const p = createPlayer(640, 360);
    activateBoost(p);
    respawnPlayer(p, 320, 360);
    expect(p.boost.active).toBe(false);
    expect(p.boost.cooldown).toBe(8);
  });

  it('still bounces off walls at boost speed', () => {
    const p = createPlayer(SCREEN_WIDTH - 60, 360);
    p.rotation = 270;
    updatePlayer(p, hold({ boost: true, move: 1 }), FRAME);
    let bounced = false;
    for (let i = 0; i < 20; i++) bounced ||= updatePlayer(p, hold({ boost: true, move: 1 }), FRAME).bounce !== null;
    expect(bounced).toBe(true);
    expect(p.position.x).toBeLessThanOrEqual(SCREEN_WIDTH - PLAYER_RADIUS + 1e-9);
  });
});

describe('boost ramming', () => {
  const boostSim = () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    return sim;
  };

  it('destroys a standard asteroid for full points without hurting the ship', () => {
    const sim = boostSim();
    const target = rock(PLAYER_START_X + 30, PLAYER_START_Y, 60);
    sim.asteroids.push(target);
    sim.step(FRAME);
    expect(target.dying).toBe(true);
    expect(sim.player.score).toBe(10);
    expect(sim.player.lives).toBe(3);
  });

  it('rams several overlapping asteroids on the same frame', () => {
    const sim = boostSim();
    const rocks = [rock(PLAYER_START_X + 30, PLAYER_START_Y, 60), rock(PLAYER_START_X - 25, PLAYER_START_Y, 40), rock(PLAYER_START_X, PLAYER_START_Y + 30, 20)];
    sim.asteroids.push(...rocks);
    sim.step(FRAME);
    expect(rocks.every((r) => r.dying)).toBe(true);
    // Three kills in one frame climb the combo: 10 x 1.0 + 20 x 1.5 + 50 x 2.0.
    expect(sim.player.score).toBe(10 + 30 + 100);
    expect(sim.player.lives).toBe(3);
  });

  it('an armored asteroid absorbs the first contact frame and breaks on the next', () => {
    const sim = boostSim();
    const armored = rock(PLAYER_START_X + 30, PLAYER_START_Y, 60, 'armored');
    sim.asteroids.push(armored);
    sim.step(FRAME);
    expect(armored.dying).toBe(false);
    expect(armored.hitPoints).toBe(1);
    expect(sim.player.lives).toBe(3);
    expect(sim.player.score).toBe(0);
    sim.step(FRAME);
    expect(armored.dying).toBe(true);
    expect(sim.player.score).toBe(25);
    expect(sim.player.lives).toBe(3);
  });

  it('is resolved before damage logic: a shield is not used up and respawn protection is not wasted', () => {
    const sim = boostSim();
    sim.player.shieldActive = true;
    sim.player.isRespawning = true;
    sim.player.respawnTimer = 2;
    sim.asteroids.push(rock(PLAYER_START_X + 30, PLAYER_START_Y, 60));
    sim.step(FRAME);
    expect(sim.player.shieldActive).toBe(true);
    expect(sim.player.isRespawning).toBe(true);
    expect(sim.player.score).toBe(10); // the ram scores, unlike a shield-absorbed collision
  });

  it('can drop power-ups like any other kill', () => {
    const sim = boostSim();
    // Force the next drop roll: not mega, under 8%, and pick index 0 (rapid fire).
    const asteroid = rock(PLAYER_START_X + 30, PLAYER_START_Y, 60);
    sim.asteroids.push(asteroid);
    const rolls = [0.5, 0.01, 0.0];
    const original = sim.rng;
    let i = 0;
    (sim as unknown as { rng: () => number }).rng = () => (i < rolls.length ? (rolls[i++] as number) : original());
    const events = sim.step(FRAME);
    // The drop appears on top of the ship, so it is collected straight away.
    expect(events).toContainEqual({ type: 'powerup_dropped', powerType: 'rapid_fire' });
    expect(sim.player.rapidFire.active).toBe(true);
  });

  it('protection ends exactly when the boost does: the next collision costs a life', () => {
    const sim = boostSim();
    runFor(sim, 3.05);
    expect(sim.player.boost.active).toBe(false);
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
  });

  it('a full boost run through a field of rocks never costs a life', () => {
    const sim = boostSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    for (let i = 0; i < 12; i++) sim.asteroids.push(rock(300 + i * 70, 360 + ((i * 37) % 50) - 25, 40));
    for (let f = 0; f < 150 && sim.player.boost.active; f++) sim.step(FRAME, hold({ move: 1, boost: true }));
    expect(sim.player.lives).toBe(3);
    expect(sim.player.score).toBeGreaterThan(100);
  });
});
