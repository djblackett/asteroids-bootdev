import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import {
  anythingHeld,
  heldButtons,
  layoutOf,
  mergeInputs,
  padToInput,
  shortPadName,
  stickAxis,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
} from '../src/input/gamepadMapping';
import { B, padSnap } from './padFakes';

/** Pure conversion of one gamepad snapshot into the normalised PlayerInput (Python: Player.update, gamepad branch). */

const input = (spec: Parameters<typeof padSnap>[0]) => padToInput(padSnap(spec));

describe('stick dead zone (Python: abs(axis) > 0.15)', () => {
  it('a neutral pad produces no command at all', () => {
    expect(input({})).toEqual(NO_INPUT);
  });

  it("is exactly Python's 0.15 / 0.5", () => {
    expect(STICK_DEADZONE).toBe(0.15);
    expect(TRIGGER_THRESHOLD).toBe(0.5);
  });

  it('is zero up to and including the boundary, live just past it', () => {
    expect(stickAxis(0.15)).toBe(0);
    expect(stickAxis(-0.15)).toBe(0);
    expect(stickAxis(0.1501)).toBeCloseTo(0.1501);
    expect(stickAxis(-0.1501)).toBeCloseTo(-0.1501);
  });

  it('keeps the raw deflection past the dead zone (no rescaling, like Python) and clamps at 1', () => {
    expect(stickAxis(0.5)).toBe(0.5);
    expect(stickAxis(1)).toBe(1);
    expect(stickAxis(1.2)).toBe(1);
    expect(stickAxis(-3)).toBe(-1);
  });

  it('treats NaN / infinity / missing as neutral instead of poisoning the ship', () => {
    expect(stickAxis(Number.NaN)).toBe(0);
    expect(stickAxis(Infinity)).toBe(0);
    expect(stickAxis(undefined)).toBe(0);
    expect(input({ axes: { 0: Number.NaN, 1: Infinity } })).toEqual(NO_INPUT);
  });

  it('small drift on either axis (a released stick) never turns or moves the ship', () => {
    for (const drift of [0.02, -0.05, 0.1, -0.14, 0.15]) {
      expect(input({ axes: { 0: drift, 1: -drift } })).toEqual(NO_INPUT);
    }
  });

  it('never returns -0 (so "no input" compares equal to the keyboard\'s 0)', () => {
    const i = input({ axes: { 0: -0.1, 1: 0.1 } });
    expect(Object.is(i.rotate, 0)).toBe(true);
    expect(Object.is(i.move, 0)).toBe(true);
  });
});

describe('movement and rotation (left stick)', () => {
  it('stick right rotates +1 (D), stick left -1 (A), proportional to deflection', () => {
    expect(input({ axes: { 0: 1 } }).rotate).toBe(1);
    expect(input({ axes: { 0: -1 } }).rotate).toBe(-1);
    expect(input({ axes: { 0: 0.5 } }).rotate).toBe(0.5);
    expect(input({ axes: { 0: -0.4 } }).rotate).toBe(-0.4);
  });

  it('stick up (axis Y negative) is forward, stick down is backward (Python: move = -axis 1)', () => {
    expect(input({ axes: { 1: -1 } }).move).toBe(1);
    expect(input({ axes: { 1: 1 } }).move).toBe(-1);
    expect(input({ axes: { 1: -0.6 } }).move).toBe(0.6);
  });

  it('thrust and steering can be held together (diagonal)', () => {
    const i = input({ axes: { 0: 0.7, 1: -0.8 } });
    expect(i.rotate).toBe(0.7);
    expect(i.move).toBe(0.8);
  });

  it('the axes are independent: a push straight up does not rotate, a push sideways does not move', () => {
    expect(input({ axes: { 0: 0.1, 1: -1 } })).toMatchObject({ rotate: 0, move: 1 });
    expect(input({ axes: { 0: 1, 1: 0.1 } })).toMatchObject({ rotate: 1, move: 0 });
  });

  it('is a pure function of the snapshot: the same state gives the same command every frame', () => {
    const snap = padSnap({ axes: { 0: 0.33, 1: -0.77 }, buttons: { [B.A]: true } });
    expect(padToInput(snap)).toEqual(padToInput(snap));
  });

  it('the D-pad steers and moves only while the stick is centred, and opposite directions cancel', () => {
    expect(input({ buttons: { [B.LEFT]: true } }).rotate).toBe(-1);
    expect(input({ buttons: { [B.RIGHT]: true } }).rotate).toBe(1);
    expect(input({ buttons: { [B.UP]: true } }).move).toBe(1);
    expect(input({ buttons: { [B.DOWN]: true } }).move).toBe(-1);
    expect(input({ buttons: { [B.LEFT]: true, [B.RIGHT]: true } }).rotate).toBe(0);
    // The stick beats the D-pad on its own axis: no contradictory steering.
    expect(input({ axes: { 0: -0.5 }, buttons: { [B.RIGHT]: true } }).rotate).toBe(-0.5);
    // ...but only on that axis.
    expect(input({ axes: { 0: -0.5 }, buttons: { [B.UP]: true } })).toMatchObject({ rotate: -0.5, move: 1 });
  });
});

describe('weapons (Python: RT or A shoot, X laser, B boost)', () => {
  it('the right trigger shoots at 0.5 and above, not below', () => {
    expect(input({ buttons: { [B.RT]: 0.49 } }).shoot).toBe(false);
    expect(input({ buttons: { [B.RT]: 0.5 } }).shoot).toBe(true);
    expect(input({ buttons: { [B.RT]: 1 } }).shoot).toBe(true);
  });

  it('the A button shoots too, and holding either keeps shooting (a level, not a one-shot)', () => {
    expect(input({ buttons: { [B.A]: true } }).shoot).toBe(true);
    const held = padSnap({ buttons: { [B.RT]: 0.9 } });
    for (let i = 0; i < 5; i++) expect(padToInput(held).shoot).toBe(true);
  });

  it('the left trigger does nothing', () => {
    expect(input({ buttons: { [B.LT]: 1 } })).toEqual(NO_INPUT);
  });

  it('X is the laser and B is the boost, independently of everything else', () => {
    expect(input({ buttons: { [B.X]: true } })).toEqual({ ...NO_INPUT, laser: true });
    expect(input({ buttons: { [B.B]: true } })).toEqual({ ...NO_INPUT, boost: true });
  });

  it('every control can be held at the same time without one cancelling another', () => {
    const i = input({ axes: { 0: -1, 1: -1 }, buttons: { [B.RT]: 1, [B.X]: true, [B.B]: true } });
    expect(i).toEqual({ rotate: -1, move: 1, shoot: true, laser: true, boost: true });
  });

  it('buttons the game does not use (Y, bumpers, stick clicks) produce nothing', () => {
    expect(input({ buttons: { [B.Y]: true, [B.LB]: true, [B.RB]: true, [B.LS]: true, [B.RS]: true } })).toEqual(NO_INPUT);
  });

  it('a digital button that reports pressed with value 0 still counts', () => {
    const snap = padSnap({});
    (snap.buttons as Array<{ pressed: boolean; value: number }>)[B.X] = { pressed: true, value: 0 };
    expect(padToInput(snap).laser).toBe(true);
  });
});

describe("non-standard devices (Python's raw indices, conservatively)", () => {
  const generic = (spec: Parameters<typeof padSnap>[0]) => padSnap({ mapping: '', ...spec });

  it('are detected from the mapping string', () => {
    expect(layoutOf({ mapping: 'standard' })).toBe('standard');
    expect(layoutOf({ mapping: '' })).toBe('generic');
    expect(layoutOf({ mapping: 'xr-standard' })).toBe('generic');
  });

  it('use sticks on axes 0 / 1, the trigger on axis 5, A / B / X on buttons 0 / 1 / 2', () => {
    expect(padToInput(generic({ axes: { 0: 1, 1: -1, 5: 0.9 } }))).toEqual({ rotate: 1, move: 1, shoot: true, laser: false, boost: false });
    expect(padToInput(generic({ buttons: { 2: true } })).laser).toBe(true);
    expect(padToInput(generic({ buttons: { 1: true } })).boost).toBe(true);
    expect(padToInput(generic({ buttons: { 0: true } })).shoot).toBe(true);
  });

  it('a trigger axis resting at -1 or 0 does not shoot; only a pull past 0.5 does', () => {
    expect(padToInput(generic({ axes: { 5: -1 } })).shoot).toBe(false);
    expect(padToInput(generic({ axes: { 5: 0 } })).shoot).toBe(false);
    expect(padToInput(generic({ axes: { 5: 0.5 } })).shoot).toBe(false);
    expect(padToInput(generic({ axes: { 5: 0.51 } })).shoot).toBe(true);
  });

  it('ignore the D-pad indices (12-15 mean something else on raw devices) and survive missing axes / buttons', () => {
    expect(padToInput(generic({ buttons: { 12: true, 13: true, 14: true, 15: true } }))).toEqual(NO_INPUT);
    const tiny = padSnap({ mapping: '', axisCount: 2, buttonCount: 2 });
    expect(padToInput(tiny)).toEqual(NO_INPUT);
  });
});

describe('what counts as "held"', () => {
  it('lists named controls, including the trigger', () => {
    const h = heldButtons(padSnap({ buttons: { [B.A]: true, [B.RT]: 1, [B.START]: true, [B.UP]: true } }));
    expect([...h].sort()).toEqual(['a', 'start', 'trigger', 'up']);
  });

  it('anythingHeld also sees controls the game ignores, with a lower threshold (guards re-arming)', () => {
    expect(anythingHeld(padSnap({}))).toBe(false);
    expect(anythingHeld(padSnap({ buttons: { [B.LT]: 0.3 } }))).toBe(true);
    expect(anythingHeld(padSnap({ buttons: { [B.RB]: true } }))).toBe(true);
    expect(anythingHeld(padSnap({ buttons: { [B.LT]: 0.1 } }))).toBe(false);
    expect(anythingHeld(padSnap({ mapping: '', axes: { 5: 0.9 } }))).toBe(true);
  });
});

describe('keyboard + controller driving the same ship (mergeInputs)', () => {
  const kb = (over: Partial<typeof NO_INPUT> = {}) => ({ ...NO_INPUT, ...over });

  it('with an idle keyboard the pad passes through unchanged', () => {
    const pad = { rotate: 0.4, move: -0.7, shoot: true, laser: true, boost: false };
    expect(mergeInputs(kb(), pad)).toEqual(pad);
  });

  it('with an idle pad the keyboard passes through unchanged', () => {
    const keys = { rotate: -1, move: 1, shoot: true, laser: false, boost: true };
    expect(mergeInputs(keys, { ...NO_INPUT })).toEqual(keys);
  });

  it('on an axis the keyboard is pushing, the keyboard wins outright, so steering is never contradictory', () => {
    expect(mergeInputs(kb({ rotate: 1 }), kb({ rotate: -1 })).rotate).toBe(1);
    expect(mergeInputs(kb({ move: -1 }), kb({ move: 0.3 })).move).toBe(-1);
  });

  it('on an axis the keyboard leaves alone the pad still steers, even while the keyboard works the other axis', () => {
    expect(mergeInputs(kb({ move: 1 }), kb({ rotate: 0.6 }))).toMatchObject({ move: 1, rotate: 0.6 });
  });

  it('buttons are OR-ed', () => {
    expect(mergeInputs(kb({ shoot: true }), kb({ boost: true }))).toEqual({ ...NO_INPUT, shoot: true, boost: true });
  });
});

describe('names', () => {
  it('shortens browser ids for display', () => {
    expect(shortPadName(padSnap({}).id)).toBe('Xbox 360 Controller');
    expect(shortPadName('045e-028e-Microsoft X-Box 360 pad')).toBe('Microsoft X-Box 360 pad');
    expect(shortPadName('')).toBe('Controller');
    expect(shortPadName('A'.repeat(60)).length).toBeLessThanOrEqual(26);
  });
});
