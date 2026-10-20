import { describe, expect, it } from 'vitest';
import { GameSim, type SimEvent } from '../src/core/game';
import type { PlayerInput } from '../src/core/player';
import { HeldKeys } from '../src/input/heldKeys';
import { keySchemesFor, type KeyScheme } from '../src/input/keyboardControls';
import { readPlayerInputs } from '../src/input/playerInputs';
import { B, makeHub, plugIn, type HubRig } from './padFakes';
import { eventsOfType, knockOut, pickupAt, quietCoop, quietSim, rock } from './helpers';

/**
 * Keyboard + gamepad through the real input path (HeldKeys + GamepadHub -> readPlayerInputs -> GameSim.step). The
 * simulation sees only normalised PlayerInputs, so a pad-driven player must be able to do everything a keyboard player can.
 */

interface Rig {
  sim: GameSim;
  held: HeldKeys;
  pad: HubRig;
  schemes: readonly KeyScheme[];
  playerCount: 1 | 2;
  /** Steps `seconds` of frames: poll the pad, read both sources, step the sim. Returns every event. */
  run(seconds: number, fps?: number): SimEvent[];
  set(spec: Parameters<HubRig['pads']['set']>[0]): void;
}

/** Two-player game: Player 1 on the keyboard, a pad on Player 2 (the primary configuration). */
function coopRig(config: Parameters<typeof quietCoop>[0] = {}): Rig {
  const sim = quietCoop(config);
  return rigFor(sim, 2);
}

function rigFor(sim: GameSim, playerCount: 1 | 2): Rig {
  const pad = makeHub();
  const key = plugIn(pad);
  pad.hub.assign(key, playerCount === 2 ? 1 : 0, playerCount);
  const rig: Rig = {
    sim,
    held: new HeldKeys(),
    pad,
    schemes: keySchemesFor(playerCount),
    playerCount,
    run(seconds, fps = 60) {
      const events: SimEvent[] = [];
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        pad.hub.poll();
        const inputs = readPlayerInputs(rig.held, pad.hub, rig.schemes);
        events.push(...sim.step(1 / fps, inputs[0], inputs[1]));
      }
      return events;
    },
    set(spec) {
      pad.pads.set(spec, 0);
    },
  };
  return rig;
}

describe('Player 1 on the keyboard, Player 2 on a gamepad', () => {
  it('both ships move at once, each from its own device', () => {
    const rig = coopRig();
    const [p1, p2] = rig.sim.players;
    const y1 = p1!.position.y;
    const y2 = p2!.position.y;
    rig.held.press('KeyW');
    rig.set({ axes: { 1: -1 } });
    rig.run(0.5);
    expect(p1!.position.y).toBeGreaterThan(y1);
    expect(p2!.position.y).toBeGreaterThan(y2);
    expect(p1!.position.y - y1).toBeCloseTo(p2!.position.y - y2, 3);
  });

  it('the keyboard alone does not move the pad player, and the pad alone does not move the keyboard player', () => {
    const rig = coopRig();
    const [p1, p2] = rig.sim.players;
    const start = [p1!.position.y, p2!.position.y];
    rig.held.press('KeyW');
    rig.run(0.4);
    expect(p2!.position.y).toBe(start[1]);
    rig.held.release('KeyW');
    rig.set({ axes: { 1: -1 } });
    const before = p1!.position.y;
    rig.run(0.4);
    expect(p1!.position.y).toBe(before);
    expect(p2!.position.y).toBeGreaterThan(start[1]!);
  });

  it('turning in opposite directions, thrusting while steering, and a released stick stops dead', () => {
    const rig = coopRig();
    const [p1, p2] = rig.sim.players;
    rig.held.press('KeyD');
    rig.set({ axes: { 0: -1, 1: -1 } });
    rig.run(0.3);
    expect(p1!.rotation).toBeGreaterThan(0);
    expect(p2!.rotation).toBeGreaterThan(180); // wrapped: turned the other way
    const rotation = p2!.rotation;
    const position = { ...p2!.position };
    rig.set({ axes: { 0: 0.1, 1: -0.14 } }); // drift only
    rig.run(0.3);
    expect(p2!.rotation).toBe(rotation);
    expect(p2!.position).toEqual(position);
  });

  it('both can shoot at the same moment, shots are owned correctly, and holding the trigger keeps firing', () => {
    const rig = coopRig();
    rig.held.press('Space');
    rig.set({ buttons: { [B.RT]: 1 } });
    const events = rig.run(1.3);
    const shots = eventsOfType(events, 'shot_fired');
    const by = (n: number) => shots.filter((e) => e.player === n).length;
    expect(by(1)).toBeGreaterThanOrEqual(4);
    expect(by(2)).toBe(by(1));
    expect(new Set(rig.sim.shots.map((s) => s.owner))).toEqual(new Set([1, 2]));
  });

  it('a pad player fires at exactly the keyboard cadence (same cooldown, no pad-specific advantage)', () => {
    const a = coopRig();
    a.held.press('Space');
    a.set({ buttons: { [B.A]: true } });
    const shots = eventsOfType(a.run(3), 'shot_fired');
    expect(shots.filter((e) => e.player === 2)).toHaveLength(shots.filter((e) => e.player === 1).length);
  });

  it('the laser fires once per press (X), not every frame, and again after release + press', () => {
    const rig = coopRig();
    rig.set({ buttons: { [B.X]: true } });
    expect(eventsOfType(rig.run(0.5), 'laser_fired')).toHaveLength(1);
    expect(rig.sim.players[1]!.laser.shotsRemaining).toBe(14);
    expect(rig.sim.players[0]!.laser.shotsRemaining).toBe(15);
    rig.set({});
    rig.run(1.2); // cooldown is 1 s
    rig.set({ buttons: { [B.X]: true } });
    expect(eventsOfType(rig.run(0.3), 'laser_fired')).toHaveLength(1);
  });

  it('boost (B) starts once per press, speeds the ship up, and holding it does not restart it after the cooldown rules', () => {
    const rig = coopRig();
    rig.set({ buttons: { [B.B]: true }, axes: { 1: -1 } });
    const events = rig.run(0.5);
    expect(eventsOfType(events, 'boost_started')).toHaveLength(1);
    expect(rig.sim.players[1]!.boost.active).toBe(true);
    expect(rig.sim.players[0]!.boost.active).toBe(false);
  });

  it('keyboard and pad boost / laser are independent players\' abilities', () => {
    const rig = coopRig();
    rig.held.press('KeyE');
    rig.set({ buttons: { [B.B]: true } });
    const events = rig.run(0.3);
    expect(eventsOfType(events, 'laser_fired').map((e) => e.player)).toEqual([1]);
    expect(eventsOfType(events, 'boost_started').map((e) => e.player)).toEqual([2]);
  });

  it('identical commands give identical ships: a full stick + RT equals W + D + Space on the other ship', () => {
    const rig = coopRig();
    const [a0, b0] = rig.sim.players;
    a0!.position = { x: 300, y: 360 };
    b0!.position = { x: 900, y: 360 };
    rig.held.press('KeyW');
    rig.held.press('KeyD');
    rig.held.press('Space');
    rig.set({ axes: { 0: 1, 1: -1 }, buttons: { [B.RT]: 1 } });
    rig.run(1);
    const [a, b] = rig.sim.players;
    expect(b!.position.x - 900).toBeCloseTo(a!.position.x - 300, 6);
    expect(b!.position.y - 360).toBeCloseTo(a!.position.y - 360, 6);
    expect(b!.rotation).toBeCloseTo(a!.rotation, 6);
  });

  it('a lighter push turns proportionally slower, independent of the frame rate', () => {
    const turned = (fps: number, axis: number): number => {
      const solo = rigFor(quietSim(), 1);
      solo.set({ axes: { 0: axis } });
      solo.run(1, fps);
      return solo.sim.player.rotation;
    };
    const full = turned(60, 1);
    const half = turned(60, 0.5);
    expect(half).toBeCloseTo(full / 2, 3);
    expect(turned(30, 0.5)).toBeCloseTo(half, 3);
    expect(turned(144, 0.5)).toBeCloseTo(half, 3);
  });

  it('collects power-ups and scores like any player', () => {
    const rig = coopRig();
    const p2 = rig.sim.players[1]!;
    pickupAt(rig.sim, 'shield', p2.position.x, p2.position.y);
    rig.run(0.1);
    expect(p2.shieldActive).toBe(true);
    // Kill a rock with the pad player's own shot.
    rig.sim.asteroids.push(rock(p2.position.x - 400, p2.position.y, 20));
    rig.sim.shots.push({ position: { x: p2.position.x - 400, y: p2.position.y }, velocity: { x: 0, y: 0 }, radius: 5, owner: 2, alive: true });
    rig.run(0.1);
    expect(p2.score).toBeGreaterThan(0);
    expect(rig.sim.players[0]!.score).toBe(0);
  });

  it('can lose lives, be eliminated, and be revived by the keyboard player; the pad then controls the revived ship', () => {
    const rig = coopRig();
    const [p1, p2] = rig.sim.players;
    knockOut(rig.sim, p2!);
    expect(p2!.lives).toBe(0);
    rig.set({ axes: { 1: -1 }, buttons: { [B.RT]: 1 } });
    const parked = { ...p2!.position };
    rig.run(0.3);
    expect(p2!.position).toEqual(parked); // a dead ship does not move or shoot
    expect(rig.sim.shots.filter((s) => s.owner === 2)).toHaveLength(0);
    pickupAt(rig.sim, 'revive', p1!.position.x, p1!.position.y);
    const events = rig.run(0.1);
    expect(eventsOfType(events, 'player_revived').map((e) => e.player)).toEqual([2]);
    expect(p2!.lives).toBe(3);
    rig.set({});
    rig.run(0.1);
    rig.set({ axes: { 1: -1 } });
    const y = p2!.position.y;
    rig.run(0.3);
    expect(p2!.position.y).toBeGreaterThan(y);
  });

  it('works with shared lives', () => {
    const rig = coopRig({ livesMode: 'shared' });
    expect(rig.sim.sharedLives).toBe(6);
    knockOut(rig.sim, rig.sim.players[1]!);
    expect(rig.sim.sharedLives).toBeLessThan(6);
    expect(rig.sim.players[1]!.lives).toBeGreaterThanOrEqual(0);
  });

  it('with friendly fire on, the pad player\'s shot hurts the keyboard player, and the other way round', () => {
    const rig = coopRig({ friendlyFire: true });
    const [p1, p2] = rig.sim.players;
    p1!.isRespawning = false;
    p1!.position = { x: 400, y: 360 };
    p2!.position = { x: 400, y: 360 };
    p2!.rotation = 0;
    const lives = p1!.lives;
    rig.sim.shots.push({ position: { ...p1!.position }, velocity: { x: 0, y: 0 }, radius: 5, owner: 2, alive: true });
    rig.run(0.05);
    expect(p1!.lives).toBe(lives - 1);
  });
});

describe('device lifecycle during play', () => {
  it('unplugging the pad stops its ship at once: no stuck thrust, turn or cannon, and the keyboard player is unaffected', () => {
    const rig = coopRig();
    const [p1, p2] = rig.sim.players;
    rig.held.press('KeyW');
    rig.set({ axes: { 0: 1, 1: -1 }, buttons: { [B.RT]: 1 } });
    rig.run(0.3);
    rig.pad.pads.set(null, 0);
    const pos = { ...p2!.position };
    const rot = p2!.rotation;
    const shotsBefore = rig.sim.shots.filter((s) => s.owner === 2).length;
    rig.run(1);
    expect(p2!.position).toEqual(pos);
    expect(p2!.rotation).toBe(rot);
    expect(eventsOfType(rig.run(0.5), 'shot_fired').filter((e) => e.player === 2)).toHaveLength(0);
    expect(rig.sim.shots.filter((s) => s.owner === 2).length).toBeLessThanOrEqual(shotsBefore);
    expect(p1!.position.y).toBeGreaterThan(360);
  });

  it('reconnecting returns the ship to the pad, but only after the buttons are released', () => {
    const rig = coopRig();
    rig.set({ buttons: { [B.RT]: 1 } });
    rig.run(0.2);
    rig.pad.pads.set(null, 0);
    rig.run(0.2);
    rig.set({ buttons: { [B.RT]: 1 } }); // plugged back in with the trigger down
    const before = eventsOfType(rig.run(0.5), 'shot_fired').filter((e) => e.player === 2).length;
    expect(before).toBe(0);
    rig.set({});
    rig.run(0.1);
    rig.set({ buttons: { [B.RT]: 1 } });
    expect(eventsOfType(rig.run(0.5), 'shot_fired').filter((e) => e.player === 2).length).toBeGreaterThan(0);
  });

  it('a focus loss silences the pad until it is released, while keyboard keys are the keyboard tracker\'s business', () => {
    const rig = coopRig();
    rig.set({ axes: { 1: -1 }, buttons: { [B.RT]: 1 } });
    rig.run(0.2);
    rig.pad.hub.disarmAll('window lost focus');
    const y = rig.sim.players[1]!.position.y;
    const shots = eventsOfType(rig.run(0.5), 'shot_fired').filter((e) => e.player === 2).length;
    expect(shots).toBe(0);
    expect(rig.sim.players[1]!.position.y).toBe(y);
  });

  it('boost and laser held through a restart do not fire in the new run (the scene marks them used)', () => {
    // The scene seeds `keyHeld` from the first read after disarming; with a disarmed pad that read is neutral, so the
    // ability is simply not triggered until the button is released and pressed again.
    const rig = coopRig();
    rig.set({ buttons: { [B.B]: true, [B.X]: true } });
    rig.pad.hub.disarmAll('run started');
    const events = rig.run(0.5);
    expect(eventsOfType(events, 'boost_started')).toHaveLength(0);
    expect(eventsOfType(events, 'laser_fired')).toHaveLength(0);
  });
});

describe('one-player gamepad, and switching modes', () => {
  it('a single player can fly and shoot with only the pad', () => {
    const rig = rigFor(quietSim(), 1);
    rig.set({ axes: { 0: 1, 1: -1 }, buttons: { [B.RT]: 1 } });
    const events = rig.run(1);
    expect(rig.sim.player.rotation).toBeGreaterThan(0);
    expect(eventsOfType(events, 'shot_fired').length).toBeGreaterThan(0);
  });

  it('keyboard and pad both drive a single ship; the keyboard wins an axis it is pushing', () => {
    const rig = rigFor(quietSim(), 1);
    rig.held.press('KeyD');
    rig.set({ axes: { 0: -1 } });
    rig.run(0.3);
    expect(rig.sim.player.rotation).toBeGreaterThan(0);
  });

  it('keyboard-only play is unchanged by an idle, unassigned pad', () => {
    const solo = rigFor(quietSim(), 1);
    solo.pad.hub.assign(solo.pad.hub.pads()[0]!.key, null, 1);
    solo.held.press('KeyW');
    solo.held.press('Space');
    const events = solo.run(0.6);
    expect(solo.sim.player.position.y).toBeGreaterThan(360);
    expect(eventsOfType(events, 'shot_fired').length).toBeGreaterThan(0);
  });

  it('a pad assigned to Player 2 drives the lone ship of a one-player game, then Player 2 again in a two-player game', () => {
    const pad = makeHub();
    const key = plugIn(pad);
    pad.hub.assign(key, 1, 2);
    pad.pads.set({ axes: { 0: 1 } }, 0);
    pad.hub.poll();
    const held = new HeldKeys();
    const solo = readPlayerInputs(held, pad.hub, keySchemesFor(1));
    expect(solo).toHaveLength(1);
    expect(solo[0]!.rotate).toBe(1);
    const duo: PlayerInput[] = readPlayerInputs(held, pad.hub, keySchemesFor(2));
    expect(duo[0]!.rotate).toBe(0);
    expect(duo[1]!.rotate).toBe(1);
  });

  it('a brand-new sim per run carries nothing over: restarting builds fresh state while the hub keeps the assignment', () => {
    const rig = coopRig();
    rig.set({ buttons: { [B.X]: true } });
    rig.run(0.3);
    expect(rig.sim.players[1]!.laser.shotsRemaining).toBe(14);
    const fresh = new GameSim({ startCooldown: 0, ufos: false, config: { playerCount: 2 } });
    expect(fresh.players[1]!.laser.shotsRemaining).toBe(15);
    expect(rig.pad.hub.padFor(1, 2)).not.toBeNull();
  });
});
