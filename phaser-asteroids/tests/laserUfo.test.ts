import { describe, expect, it, vi } from 'vitest';
import { FRAME, collectEvents, eventsOfType, hold, quietSim, runFor } from './helpers';

// Python's beam ignores UFOs (see LASER_HITS_UFOS in constants.ts). This file checks the opt-in behaviour so it stays
// correct if the switch is turned on.
vi.mock('../src/core/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/constants')>()),
  LASER_HITS_UFOS: true,
}));

function armed() {
  const sim = quietSim();
  sim.player.rotation = 270;
  sim.player.position = { x: 100, y: 360 };
  return sim;
}

describe('Laser Beam vs UFOs with LASER_HITS_UFOS switched on', () => {
  it('destroys every UFO on its path once: flat points, one power-up each, no combo', () => {
    const sim = armed();
    const a = sim.spawnUfo('large', 400, 360);
    const b = sim.spawnUfo('small', 800, 370);
    for (const u of [a, b]) {
      u.shootTimer = 1e9;
      u.targetVelocity = { x: 0, y: 0 };
      u.movementTimer = -1e9;
    }
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.5)];
    expect(eventsOfType(events, 'ufo_destroyed').map((e) => e.points)).toEqual([200, 500]);
    expect(sim.player.score).toBe(700);
    expect(sim.powerups).toHaveLength(2);
    expect(sim.combo.count).toBe(0);
    expect(sim.ufos).toHaveLength(0);
  });

  it('a UFO already killed by a shot in the same frame is not paid again by the beam', () => {
    const sim = armed();
    const ufo = sim.spawnUfo('large', 400, 360);
    ufo.shootTimer = 1e9;
    ufo.targetVelocity = { x: 0, y: 0 };
    sim.shots.push({ position: { x: 400, y: 360 }, velocity: { x: 0, y: 0 }, radius: 5, owner: 1, alive: true });
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(sim.player.score).toBe(200);
    expect(sim.powerups).toHaveLength(1);
  });
});
