import { describe, expect, it } from 'vitest';
import { LASER_BEAM_MAX_SHOTS } from '../src/core/constants';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { HeldKeys } from '../src/input/heldKeys';
import { keySchemesFor } from '../src/input/keyboardControls';
import { readPlayerInputs } from '../src/input/playerInputs';
import { TouchModel } from '../src/input/touchModel';
import { FRAME, quietCoop, quietSim } from './helpers';

/**
 * Touch -> `PlayerInput` -> the unchanged GameSim, and how touch shares a player with the keyboard and a controller. Nothing here
 * knows about the DOM; the model is driven the way the binding drives it.
 */

const NO_PAD = { command: (): PlayerInput => ({ ...NO_INPUT }) };
const keys = (...codes: string[]): HeldKeys => {
  const held = new HeldKeys();
  for (const c of codes) held.press(c);
  return held;
};
const SOLO = keySchemesFor(1);

function steeringModel(dx: number, dy: number): TouchModel {
  const m = new TouchModel();
  m.setStickRadius(60);
  m.press(1, 'stick', 100, 300);
  m.move(1, 100 + dx, 300 + dy);
  return m;
}

describe('readPlayerInputs with touch', () => {
  it('without touch controls it is exactly what it was', () => {
    expect(readPlayerInputs(keys('KeyD', 'Space'), NO_PAD, SOLO)).toEqual([{ rotate: 1, move: 0, shoot: true, laser: false, boost: false }]);
  });

  it('touch alone drives Player 1', () => {
    const m = steeringModel(60, -30);
    m.press(2, 'fire', 700, 300);
    const [p1] = readPlayerInputs(keys(), NO_PAD, SOLO, m);
    expect(p1).toMatchObject({ rotate: 1, move: 0.5, shoot: true, laser: false, boost: false });
  });

  it('an idle (or disabled) touch layer adds nothing', () => {
    const m = new TouchModel();
    expect(readPlayerInputs(keys(), NO_PAD, SOLO, m)).toEqual([{ rotate: 0, move: 0, shoot: false, laser: false, boost: false }]);
    m.press(1, 'fire', 0, 0);
    m.setEnabled(false);
    expect(readPlayerInputs(keys(), NO_PAD, SOLO, m)[0]?.shoot).toBe(false);
  });

  it('keyboard and touch together: the keyboard wins an axis it pushes, touch fills the other, buttons are OR-ed', () => {
    const m = steeringModel(-60, -60); // turn left, forward
    m.press(2, 'laser', 600, 300);
    const [p1] = readPlayerInputs(keys('KeyD', 'Space'), NO_PAD, SOLO, m);
    expect(p1).toMatchObject({ rotate: 1, move: 1, shoot: true, laser: true, boost: false });
  });

  it('a controller and touch together follow the same policy (the pad is merged first)', () => {
    const pad = { command: (): PlayerInput => ({ rotate: 0.4, move: 0, shoot: false, laser: false, boost: true }) };
    const m = steeringModel(0, -60);
    const [p1] = readPlayerInputs(keys(), pad, SOLO, m);
    expect(p1).toMatchObject({ rotate: 0.4, move: 1, boost: true });
  });

  it('switching modes mid-session: touch off means the keyboard alone again, touch on adds the fingers back', () => {
    const m = steeringModel(60, 0);
    m.press(2, 'fire', 700, 300);
    const held = keys('KeyW');
    expect(readPlayerInputs(held, NO_PAD, SOLO, m)[0]).toMatchObject({ rotate: 1, move: 1, shoot: true });
    m.setEnabled(false); // the player switched to keyboard / controller controls
    expect(readPlayerInputs(held, NO_PAD, SOLO, m)[0]).toEqual({ rotate: 0, move: 1, shoot: false, laser: false, boost: false });
    m.setEnabled(true);
    expect(readPlayerInputs(held, NO_PAD, SOLO, m)[0]).toEqual({ rotate: 0, move: 1, shoot: false, laser: false, boost: false }); // fingers were let go
  });

  it('touch belongs to Player 1 only; Player 2 in a two-player game is unaffected', () => {
    const m = steeringModel(60, -60);
    m.press(2, 'fire', 700, 300);
    const [p1, p2] = readPlayerInputs(keys(), NO_PAD, keySchemesFor(2), m);
    expect(p1).toMatchObject({ rotate: 1, move: 1, shoot: true });
    expect(p2).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
  });
});

describe('a touch-driven run of the unchanged simulation', () => {
  it('steering right turns the ship clockwise-as-D does, steering left the other way, harder push turns faster', () => {
    // Rotation is in degrees and wraps at 360, so compare the signed turn in (-180, 180].
    const signed = (degrees: number): number => {
      const d = ((degrees % 360) + 360) % 360;
      return d > 180 ? d - 360 : d;
    };
    const turned = (dx: number): number => {
      const sim = quietSim();
      const m = steeringModel(dx, 0);
      const before = sim.player.rotation;
      for (let i = 0; i < 30; i++) sim.step(FRAME, m.command());
      return signed(sim.player.rotation - before);
    };
    const keyboardD = ((): number => {
      const sim = quietSim();
      for (let i = 0; i < 30; i++) sim.step(FRAME, { ...NO_INPUT, rotate: 1 });
      return signed(sim.player.rotation);
    })();
    expect(turned(60)).toBeCloseTo(keyboardD, 6); // full deflection = the keyboard's full turn
    expect(turned(-60)).toBeCloseTo(-turned(60), 6);
    expect(Math.abs(turned(30))).toBeCloseTo(Math.abs(turned(60)) / 2, 6);
    expect(turned(5)).toBe(0); // inside the dead zone: no creeping turn
  });

  it('pushing up flies forward, pushing down flies backward, a light push is slower', () => {
    const travelled = (dy: number): number => {
      const sim = quietSim();
      const start = { ...sim.player.position };
      const m = steeringModel(0, dy);
      for (let i = 0; i < 30; i++) sim.step(FRAME, m.command());
      return Math.hypot(sim.player.position.x - start.x, sim.player.position.y - start.y);
    };
    expect(travelled(-60)).toBeGreaterThan(travelled(-30));
    expect(travelled(-30)).toBeGreaterThan(0);
    expect(travelled(60)).toBeGreaterThan(0);
    expect(travelled(-4)).toBe(0);
  });

  it('forward and backward are opposite directions', () => {
    const sim = quietSim();
    const start = { ...sim.player.position };
    const fwd = steeringModel(0, -60);
    for (let i = 0; i < 20; i++) sim.step(FRAME, fwd.command());
    const forwardPos = { ...sim.player.position };
    const back = steeringModel(0, 60);
    for (let i = 0; i < 20; i++) sim.step(FRAME, back.command());
    // 20 frames forward then 20 back returns to the start.
    expect(Math.hypot(sim.player.position.x - start.x, sim.player.position.y - start.y)).toBeLessThan(Math.hypot(forwardPos.x - start.x, forwardPos.y - start.y) * 0.1);
  });

  it('holding FIRE shoots continuously with no further taps, and steering at the same time does not interrupt it', () => {
    const sim = quietSim();
    const m = steeringModel(-60, 0);
    m.press(2, 'fire', 700, 300);
    let fired = 0;
    let seen = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(FRAME, m.command());
      if (sim.shots.length > seen) fired += sim.shots.length - seen;
      seen = sim.shots.length;
    }
    expect(fired).toBeGreaterThan(5);
    expect(sim.player.rotation).not.toBe(0);
    m.release(2);
    const after = sim.shots.length;
    for (let i = 0; i < 60; i++) sim.step(FRAME, m.command());
    expect(sim.shots.length).toBeLessThanOrEqual(after); // no new shots once the finger is up
  });

  it('LASER fires one beam per press however long the finger stays down, and again on the next press', () => {
    const sim = quietSim();
    const m = new TouchModel();
    m.press(1, 'laser', 620, 300);
    for (let i = 0; i < 90; i++) sim.step(FRAME, m.command()); // 1.5 s held
    expect(sim.player.laser.shotsRemaining).toBe(LASER_BEAM_MAX_SHOTS - 1);
    m.release(1);
    sim.step(FRAME, m.command());
    for (let i = 0; i < 90; i++) sim.step(FRAME, m.command()); // let the cooldown pass
    m.press(2, 'laser', 620, 300);
    sim.step(FRAME, m.command());
    expect(sim.player.laser.shotsRemaining).toBe(LASER_BEAM_MAX_SHOTS - 2);
  });

  it('BOOST starts once per press, and can only be pressed again after its cooldown', () => {
    const sim = quietSim();
    const m = new TouchModel();
    m.press(1, 'boost', 720, 200);
    sim.step(FRAME, m.command());
    expect(sim.player.boost.active).toBe(true);
    m.release(1);
    sim.step(FRAME, m.command());
    m.press(2, 'boost', 720, 200); // pressing again during the boost does not restart it
    const timerBefore = sim.player.boost.timer;
    sim.step(FRAME, m.command());
    expect(sim.player.boost.timer).toBeLessThan(timerBefore);
  });

  it('a finger lifted on pause leaves no stuck input: the next frame after resuming is neutral', () => {
    const sim = quietSim();
    const m = steeringModel(60, -60);
    m.press(2, 'fire', 700, 300);
    m.press(3, 'boost', 720, 200);
    m.releaseAll(); // what the scene does when pausing
    const before = { ...sim.player.position };
    for (let i = 0; i < 30; i++) sim.step(FRAME, m.command());
    expect(sim.player.position).toEqual(before);
    expect(sim.shots.length).toBe(0);
    expect(sim.player.boost.active).toBe(false);
  });

  it('after game over and a restart, a brand-new run starts from a neutral model', () => {
    const m = steeringModel(60, -60);
    m.press(2, 'fire', 700, 300);
    m.releaseAll(); // game over: the layer goes away
    const fresh = quietSim();
    for (let i = 0; i < 10; i++) fresh.step(FRAME, m.command());
    expect(fresh.shots.length).toBe(0);
    expect(fresh.player.rotation).toBe(0);
  });

  it('a touch-driven two-player simulation still only reads Player 2 from its own input', () => {
    const sim = quietCoop();
    const m = steeringModel(60, 0);
    for (let i = 0; i < 20; i++) sim.step(FRAME, m.command(), NO_INPUT);
    expect(sim.player.rotation).not.toBe(0);
    expect(sim.player2?.rotation).toBe(0);
  });
});
