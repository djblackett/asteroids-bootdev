import { describe, expect, it } from 'vitest';
import { getForwardVector } from '../src/core/math';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { HeldKeys } from '../src/input/heldKeys';
import { keySchemesFor } from '../src/input/keyboardControls';
import { readPlayerInputs } from '../src/input/playerInputs';
import {
  DPAD_DEAD_ZONE,
  DPAD_DEAD_ZONE_HELD,
  DPAD_NEUTRAL,
  dpadDirection,
  TouchModel,
  type DpadDirection,
} from '../src/input/touchModel';
import { FRAME, quietSim } from './helpers';

/**
 * The virtual D-pad: the direction maths (eight 45 degree sectors, a dead zone, a little hysteresis), the model around it (one
 * finger, digital output, sliding, releasing, switching) and a real GameSim driven by it. Pad centre (105, 275), radius 85.
 */

const CX = 105;
const CY = 275;
const R = 85;
const NEUTRAL = { rotate: 0, move: 0, shoot: false, laser: false, boost: false };

/** A point `distance` (fraction of the radius) from the centre at a compass-style angle: 0 = up, 90 = right, 180 = down, 270 = left. */
function at(angle: number, distance = 0.7): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: CX + Math.sin(a) * distance * R, y: CY - Math.cos(a) * distance * R };
}

function dir(angle: number, distance = 0.7, previous?: DpadDirection): DpadDirection {
  const p = at(angle, distance);
  return dpadDirection(p.x - CX, p.y - CY, R, previous);
}

function padModel(): TouchModel {
  const m = new TouchModel();
  m.setSteering('dpad');
  m.setDpadGeometry(CX, CY, R);
  return m;
}

const press = (m: TouchModel, id: number, angle: number, distance = 0.7): boolean => {
  const p = at(angle, distance);
  return m.press(id, 'dpad', p.x, p.y);
};
const slide = (m: TouchModel, id: number, angle: number, distance = 0.7): void => {
  const p = at(angle, distance);
  m.move(id, p.x, p.y);
};

describe('dpadDirection: the eight sectors', () => {
  it.each([
    ['up', 0, 0, 1],
    ['up + right', 45, 1, 1],
    ['right', 90, 1, 0],
    ['down + right', 135, 1, -1],
    ['down', 180, 0, -1],
    ['down + left', 225, -1, -1],
    ['left', 270, -1, 0],
    ['up + left', 315, -1, 1],
  ])('%s (%i degrees) -> rotate %i, move %i', (_name, angle, rotate, move) => {
    expect(dir(angle)).toEqual({ rotate, move });
  });

  it('up is forward, down is back, left is counterclockwise (-1), right is clockwise (+1)', () => {
    expect(dir(0)).toEqual({ rotate: 0, move: 1 });
    expect(dir(180)).toEqual({ rotate: 0, move: -1 });
    expect(dir(270).rotate).toBe(-1);
    expect(dir(90).rotate).toBe(1);
  });

  it('every sector is 45 degrees wide: the boundaries sit at 22.5, 67.5, 112.5 ... degrees', () => {
    expect(dir(20)).toEqual({ rotate: 0, move: 1 }); // still Up
    expect(dir(25)).toEqual({ rotate: 1, move: 1 }); // Up + Right
    expect(dir(65)).toEqual({ rotate: 1, move: 1 });
    expect(dir(70)).toEqual({ rotate: 1, move: 0 }); // Right
    expect(dir(110)).toEqual({ rotate: 1, move: 0 });
    expect(dir(115)).toEqual({ rotate: 1, move: -1 }); // Down + Right
    expect(dir(340)).toEqual({ rotate: 0, move: 1 });
    expect(dir(335)).toEqual({ rotate: -1, move: 1 });
  });

  it('the diagonal sectors are as wide as the cardinal ones (a thumb that aims for a corner gets the corner)', () => {
    const width = (match: (d: DpadDirection) => boolean): number => {
      let n = 0;
      for (let a = 0; a < 360; a += 0.5) if (match(dir(a))) n += 0.5;
      return n;
    };
    // (sampled every half degree, so allow a degree of slack)
    for (const match of [(d: DpadDirection) => d.rotate === 0 && d.move === 1, (d: DpadDirection) => d.rotate === 1 && d.move === 1, (d: DpadDirection) => d.rotate === 1 && d.move === 0]) {
      expect(Math.abs(width(match) - 45)).toBeLessThanOrEqual(1);
    }
  });

  it('the output is digital: only -1, 0 and 1 whatever the angle or distance', () => {
    for (let a = 0; a < 360; a += 7) {
      for (const d of [0.25, 0.5, 1, 1.5, 4]) {
        const out = dir(a, d);
        expect([-1, 0, 1]).toContain(out.rotate);
        expect([-1, 0, 1]).toContain(out.move);
        expect(Object.keys(out).sort()).toEqual(['move', 'rotate']);
      }
    }
  });

  it('the strength of the push does not matter outside the dead zone', () => {
    expect(dir(90, 0.3)).toEqual(dir(90, 1));
    expect(dir(90, 0.3)).toEqual(dir(90, 5));
    expect(dir(315, 0.3)).toEqual(dir(315, 5));
  });
});

describe('dpadDirection: dead zone', () => {
  it('a thumb on the hub is neutral, in every direction', () => {
    for (let a = 0; a < 360; a += 30) expect(dir(a, DPAD_DEAD_ZONE * 0.9)).toEqual(DPAD_NEUTRAL);
    expect(dpadDirection(0, 0, R)).toEqual(DPAD_NEUTRAL);
  });

  it('just outside it the direction is live', () => {
    expect(dir(90, DPAD_DEAD_ZONE * 1.1)).toEqual({ rotate: 1, move: 0 });
  });

  it('a held direction survives a smaller push than it took to start it (no flicker at the hub edge)', () => {
    const between = (DPAD_DEAD_ZONE + DPAD_DEAD_ZONE_HELD) / 2;
    expect(dir(90, between)).toEqual(DPAD_NEUTRAL); // from neutral: not enough
    expect(dir(90, between, { rotate: 1, move: 0 })).toEqual({ rotate: 1, move: 0 }); // already turning: kept
    expect(dir(90, DPAD_DEAD_ZONE_HELD * 0.8, { rotate: 1, move: 0 })).toEqual(DPAD_NEUTRAL); // far enough back: released
  });

  it('degenerate input is neutral, never a crash or a stuck direction', () => {
    expect(dpadDirection(50, 0, 0)).toEqual(DPAD_NEUTRAL);
    expect(dpadDirection(50, 0, -3)).toEqual(DPAD_NEUTRAL);
    expect(dpadDirection(Number.NaN, 0, R)).toEqual(DPAD_NEUTRAL);
    expect(dpadDirection(0, Number.POSITIVE_INFINITY, R)).toEqual(DPAD_NEUTRAL);
  });
});

describe('dpadDirection: sliding between directions is predictable', () => {
  it('a diagonal is held a little past its boundary, so a thumb riding the edge does not flap', () => {
    // 24 degrees from Up: Up + Right is on. Pulling back to 21 degrees (inside Up's sector) keeps the diagonal...
    const diagonal = dir(24);
    expect(diagonal).toEqual({ rotate: 1, move: 1 });
    expect(dir(21, 0.7, diagonal)).toEqual({ rotate: 1, move: 1 });
    // ...and only further back (18 degrees) does it fall to plain Up.
    expect(dir(18, 0.7, diagonal)).toEqual({ rotate: 0, move: 1 });
    // From plain Up the same 21 degrees is still Up: entering needs the full 22.5.
    expect(dir(21, 0.7, { rotate: 0, move: 1 })).toEqual({ rotate: 0, move: 1 });
  });

  it('a slow sweep around the whole pad visits the sectors in order, each exactly once, with no flicker', () => {
    let held: DpadDirection = DPAD_NEUTRAL;
    const visited: string[] = [];
    for (let a = 0; a <= 360; a += 1) {
      held = dir(a % 360, 0.8, held);
      const key = `${held.rotate},${held.move}`;
      if (visited[visited.length - 1] !== key) visited.push(key);
    }
    expect(visited).toEqual(['0,1', '1,1', '1,0', '1,-1', '0,-1', '-1,-1', '-1,0', '-1,1', '0,1']);
  });

  it('sweeping back the other way is just as clean', () => {
    let held: DpadDirection = DPAD_NEUTRAL;
    const visited: string[] = [];
    for (let a = 360; a >= 0; a -= 1) {
      held = dir(a % 360, 0.8, held);
      const key = `${held.rotate},${held.move}`;
      if (visited[visited.length - 1] !== key) visited.push(key);
    }
    expect(visited).toEqual(['0,1', '-1,1', '-1,0', '-1,-1', '0,-1', '1,-1', '1,0', '1,1', '0,1']);
  });

  it('crossing the hub from one side to the other passes through neutral', () => {
    let held = dir(270); // left
    expect(held).toEqual({ rotate: -1, move: 0 });
    held = dir(270, 0.05, held); // back at the hub
    expect(held).toEqual(DPAD_NEUTRAL);
    held = dir(90, 0.7, held);
    expect(held).toEqual({ rotate: 1, move: 0 });
  });
});

describe('TouchModel D-pad', () => {
  it('each of the eight directions gives the matching command, and nothing else', () => {
    const expected: Array<[number, number, number]> = [
      [0, 0, 1],
      [45, 1, 1],
      [90, 1, 0],
      [135, 1, -1],
      [180, 0, -1],
      [225, -1, -1],
      [270, -1, 0],
      [315, -1, 1],
    ];
    for (const [angle, rotate, move] of expected) {
      const m = padModel();
      expect(press(m, 1, angle)).toBe(true);
      expect(m.command()).toEqual({ ...NEUTRAL, rotate, move });
      m.release(1);
      expect(m.command()).toEqual(NEUTRAL);
    }
  });

  it('the direction is live on the very first event (a short tap steers without a move event)', () => {
    const m = padModel();
    press(m, 1, 270);
    expect(m.command().rotate).toBe(-1);
    m.release(1);
    expect(m.command().rotate).toBe(0);
  });

  it('a quick succession of taps is a quick succession of full-strength nudges', () => {
    const m = padModel();
    const seen: number[] = [];
    for (const angle of [90, 270, 90, 90, 270]) {
      press(m, 1, angle);
      seen.push(m.command().rotate);
      m.release(1);
      seen.push(m.command().rotate);
    }
    expect(seen).toEqual([1, 0, -1, 0, 1, 0, 1, 0, -1, 0]);
  });

  it('a tap on the hub is neutral and the finger is still tracked until it lifts', () => {
    const m = padModel();
    expect(press(m, 1, 0, 0.05)).toBe(true);
    expect(m.command()).toEqual(NEUTRAL);
    expect(m.has(1)).toBe(true);
    slide(m, 1, 0, 0.8); // the thumb rolls up out of the hub
    expect(m.command().move).toBe(1);
  });

  it('sliding the thumb round the pad changes direction without lifting', () => {
    const m = padModel();
    press(m, 1, 0);
    expect(m.command()).toMatchObject({ rotate: 0, move: 1 });
    slide(m, 1, 45);
    expect(m.command()).toMatchObject({ rotate: 1, move: 1 });
    slide(m, 1, 90);
    expect(m.command()).toMatchObject({ rotate: 1, move: 0 });
    slide(m, 1, 270);
    expect(m.command()).toMatchObject({ rotate: -1, move: 0 });
    slide(m, 1, 315);
    expect(m.command()).toMatchObject({ rotate: -1, move: 1 });
    expect(m.activePointers).toBe(1);
  });

  it('sliding off the pad keeps the direction the thumb points in until it lifts', () => {
    const m = padModel();
    press(m, 1, 0);
    m.move(1, CX, -400); // far above the pad, over the playfield
    expect(m.command()).toMatchObject({ rotate: 0, move: 1 });
    m.move(1, CX - 900, CY - 20); // far off to the left
    expect(m.command()).toMatchObject({ rotate: -1, move: 0 });
    m.move(1, 3000, 3000); // off the screen
    expect(m.command()).toMatchObject({ rotate: 1, move: -1 });
    m.release(1); // lifting anywhere lets go
    expect(m.command()).toEqual(NEUTRAL);
  });

  it('release and cancel both return to neutral at once (the model cannot tell them apart, which is the point)', () => {
    for (const how of ['release', 'releaseAll'] as const) {
      const m = padModel();
      press(m, 1, 45);
      m.press(2, 'fire', 700, 300);
      if (how === 'release') m.release(1);
      else m.releaseAll();
      expect(m.command().rotate).toBe(0);
      expect(m.command().move).toBe(0);
      expect(m.dpadView()).toEqual({ active: false, up: false, down: false, left: false, right: false });
    }
  });

  it('a second finger on the pad is ignored and cannot leak', () => {
    const m = padModel();
    press(m, 1, 270);
    expect(press(m, 2, 90)).toBe(false);
    expect(m.has(2)).toBe(false);
    expect(m.command().rotate).toBe(-1);
    m.release(2); // not ours: nothing happens
    expect(m.command().rotate).toBe(-1);
    m.release(1);
    expect(m.command()).toEqual(NEUTRAL);
  });

  it('refuses a press before the pad has any geometry (a hidden or unmeasured pad)', () => {
    const m = new TouchModel();
    m.setSteering('dpad');
    expect(m.press(1, 'dpad', 100, 100)).toBe(false);
    expect(m.activePointers).toBe(0);
    m.setDpadGeometry(0, 0, 0); // an element that is display:none measures as an empty box
    expect(m.press(1, 'dpad', 100, 100)).toBe(false);
  });

  it('only the live steering control takes touches', () => {
    const joystick = new TouchModel();
    joystick.setDpadGeometry(CX, CY, R);
    expect(joystick.steeringMode).toBe('joystick');
    expect(joystick.press(1, 'dpad', CX, CY - 60)).toBe(false);
    expect(joystick.press(2, 'stick', 100, 300)).toBe(true);

    const pad = padModel();
    expect(pad.press(1, 'stick', 100, 300)).toBe(false);
    expect(pad.press(2, 'dpad', CX, CY - 60)).toBe(true);
    // FIRE, LASER, BOOST and PAUSE work in both modes.
    expect(pad.press(3, 'fire', 700, 300)).toBe(true);
    expect(joystick.press(3, 'fire', 700, 300)).toBe(true);
  });

  it('a moving pad (resize, fullscreen) re-aims a held thumb instead of leaving a stale direction', () => {
    const m = padModel();
    press(m, 1, 0); // thumb at the top of the pad: Up
    expect(m.command().move).toBe(1);
    m.setDpadGeometry(CX, CY - 300, R); // the pad is now far above the thumb: the thumb is below its centre
    expect(m.command()).toMatchObject({ rotate: 0, move: -1 });
  });

  it('dpadView lights the arms for the direction held, two at a corner', () => {
    const m = padModel();
    expect(m.dpadView()).toEqual({ active: false, up: false, down: false, left: false, right: false });
    press(m, 1, 315);
    expect(m.dpadView()).toEqual({ active: true, up: true, down: false, left: true, right: false });
    slide(m, 1, 180);
    expect(m.dpadView()).toEqual({ active: true, up: false, down: true, left: false, right: false });
  });

  it('notifies listeners only when something drawn changes', () => {
    const m = padModel();
    let calls = 0;
    m.onChange(() => calls++);
    press(m, 1, 0);
    const afterPress = calls;
    slide(m, 1, 5, 0.75); // same sector, different spot
    slide(m, 1, 350, 0.9);
    expect(calls).toBe(afterPress);
    slide(m, 1, 90);
    expect(calls).toBe(afterPress + 1);
  });
});

describe('TouchModel D-pad with the other controls (multi-touch)', () => {
  it('D-pad + FIRE: turning and shooting at once', () => {
    const m = padModel();
    press(m, 1, 270);
    m.press(2, 'fire', 700, 300);
    expect(m.command()).toEqual({ ...NEUTRAL, rotate: -1, shoot: true });
    m.release(2);
    expect(m.command()).toEqual({ ...NEUTRAL, rotate: -1 });
  });

  it('D-pad diagonal + FIRE + LASER + BOOST, four fingers at once', () => {
    const m = padModel();
    press(m, 1, 45);
    m.press(2, 'fire', 700, 300);
    m.press(3, 'laser', 620, 300);
    m.press(4, 'boost', 720, 200);
    expect(m.command()).toEqual({ rotate: 1, move: 1, shoot: true, laser: true, boost: true });
    m.release(1);
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: true, laser: true, boost: true });
  });

  it('lifting an action finger leaves the D-pad finger untouched, and the other way round', () => {
    const m = padModel();
    press(m, 1, 0);
    m.press(2, 'laser', 620, 300);
    m.release(2);
    expect(m.command()).toEqual({ ...NEUTRAL, move: 1 });
    m.press(3, 'boost', 720, 200);
    m.release(1);
    expect(m.command()).toEqual({ ...NEUTRAL, boost: true });
  });

  it('a finger that slides from the D-pad onto FIRE keeps steering and does not press FIRE', () => {
    const m = padModel();
    press(m, 1, 90);
    m.move(1, 750, 300); // over the FIRE button
    expect(m.command().shoot).toBe(false);
    expect(m.command().rotate).toBe(1);
  });
});

describe('switching steering mode', () => {
  it('switching from joystick to D-pad while input is active lets go of everything', () => {
    const m = new TouchModel();
    m.setDpadGeometry(CX, CY, R);
    m.press(1, 'stick', 100, 300);
    m.move(1, 40, 240);
    m.press(2, 'fire', 700, 300);
    expect(m.command()).toMatchObject({ rotate: expect.any(Number), shoot: true });
    m.setSteering('dpad');
    expect(m.command()).toEqual(NEUTRAL);
    expect(m.activePointers).toBe(0);
    expect(m.stickView().active).toBe(false);
    // The old finger's later events are ignored (it is not tracked any more)...
    m.move(1, 10, 10);
    expect(m.command()).toEqual(NEUTRAL);
    // ...and the pad works straight away.
    press(m, 3, 0);
    expect(m.command().move).toBe(1);
  });

  it('switching from D-pad to joystick while turning lets go of the turn', () => {
    const m = padModel();
    press(m, 1, 270);
    m.setSteering('joystick');
    expect(m.command()).toEqual(NEUTRAL);
    expect(m.dpadView().active).toBe(false);
    expect(press(m, 2, 270)).toBe(false);
  });

  it('switching to the mode it is already in changes nothing', () => {
    const m = padModel();
    press(m, 1, 270);
    m.setSteering('dpad');
    expect(m.command().rotate).toBe(-1);
  });
});

describe('a real GameSim driven by the D-pad', () => {
  /** The keyboard command for the same direction, through the same merge the game uses. */
  const keyboardFor = (rotate: number, move: number): PlayerInput => {
    const held = new HeldKeys();
    if (rotate < 0) held.press('KeyA');
    if (rotate > 0) held.press('KeyD');
    if (move > 0) held.press('KeyW');
    if (move < 0) held.press('KeyS');
    return readPlayerInputs(held, { command: () => ({ ...NO_INPUT }) }, keySchemesFor(1))[0] as PlayerInput;
  };

  it('each direction is the same PlayerInput the keyboard produces for the matching keys', () => {
    for (const [angle, rotate, move] of [
      [0, 0, 1],
      [45, 1, 1],
      [90, 1, 0],
      [135, 1, -1],
      [180, 0, -1],
      [225, -1, -1],
      [270, -1, 0],
      [315, -1, 1],
    ] as const) {
      const m = padModel();
      press(m, 1, angle);
      expect(m.command()).toEqual(keyboardFor(rotate, move));
    }
  });

  it('a scripted run with the D-pad ends in exactly the state the same keys produce', () => {
    // Left, up-left, up, up-right, right, down, neutral: 20 frames each.
    const script: Array<[number | null, number, number]> = [
      [270, -1, 0],
      [315, -1, 1],
      [0, 0, 1],
      [45, 1, 1],
      [90, 1, 0],
      [180, 0, -1],
      [null, 0, 0],
    ];
    const pad = quietSim();
    const keys = quietSim();
    const m = padModel();
    for (const [angle, rotate, move] of script) {
      m.releaseAll();
      if (angle !== null) press(m, 1, angle);
      for (let i = 0; i < 20; i++) {
        pad.step(FRAME, m.command());
        keys.step(FRAME, keyboardFor(rotate, move));
      }
    }
    expect(pad.player.rotation).toBe(keys.player.rotation);
    expect(pad.player.position).toEqual(keys.player.position);
    expect(pad.player.velocity).toEqual(keys.player.velocity);
  });

  it('Up flies the way the ship is facing, not toward the thumb or the screen', () => {
    const sim = quietSim();
    const m = padModel();
    press(m, 1, 90); // turn right for a while
    for (let i = 0; i < 20; i++) sim.step(FRAME, m.command());
    m.releaseAll();
    expect(sim.player.rotation).not.toBe(0);
    const rotation = sim.player.rotation;
    const start = { ...sim.player.position };
    press(m, 1, 0); // now Up
    for (let i = 0; i < 30; i++) sim.step(FRAME, m.command());
    expect(sim.player.rotation).toBe(rotation); // Up does not turn the ship
    const moved = { x: sim.player.position.x - start.x, y: sim.player.position.y - start.y };
    const forward = getForwardVector(rotation); // the simulation's own idea of "the way the ship faces"
    expect(moved.x * forward.x + moved.y * forward.y).toBeGreaterThan(Math.hypot(moved.x, moved.y) * 0.99);
  });

  it('Left turns counterclockwise, Right clockwise, by the same amount as A and D', () => {
    const turn = (angle: number): number => {
      const sim = quietSim();
      const m = padModel();
      press(m, 1, angle);
      for (let i = 0; i < 30; i++) sim.step(FRAME, m.command());
      return sim.player.rotation;
    };
    const signed = (d: number): number => (((d % 360) + 540) % 360) - 180;
    expect(signed(turn(270))).toBeLessThan(0);
    expect(signed(turn(90))).toBeGreaterThan(0);
    expect(signed(turn(90))).toBeCloseTo(-signed(turn(270)), 6);
  });

  it('there is no creeping turn or drift from a neutral pad, and no input outlives a release', () => {
    const sim = quietSim();
    const m = padModel();
    press(m, 1, 315);
    m.release(1);
    const before = { ...sim.player.position };
    const rot = sim.player.rotation;
    for (let i = 0; i < 60; i++) sim.step(FRAME, m.command());
    expect(sim.player.rotation).toBe(rot);
    expect(sim.player.position.x).toBeCloseTo(before.x, 9);
  });

  it('turning + shooting from the pad and FIRE: FIRE keeps shooting while the thumb slides between directions', () => {
    const sim = quietSim();
    const m = padModel();
    m.press(2, 'fire', 700, 300);
    press(m, 1, 270);
    let seen = 0;
    let fired = 0;
    for (let i = 0; i < 120; i++) {
      if (i === 40) slide(m, 1, 315);
      if (i === 80) slide(m, 1, 0);
      sim.step(FRAME, m.command());
      if (sim.shots.length > seen) fired += sim.shots.length - seen;
      seen = sim.shots.length;
    }
    expect(fired).toBeGreaterThan(5);
  });
});
