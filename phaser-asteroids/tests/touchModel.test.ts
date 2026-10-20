import { describe, expect, it } from 'vitest';
import { STICK_DEADZONE } from '../src/input/gamepadMapping';
import { STICK_RADIUS_MAX, STICK_RADIUS_MIN, stickRadiusFor, stickToAxes, TouchModel } from '../src/input/touchModel';

/** The touch screen's normalisation: thumb offsets and held buttons -> the same PlayerInput a keyboard or pad produces. */

const R = 60; // stick radius used throughout: dead zone is 0.15 * 60 = 9 px

function modelWithStick(dx = 0, dy = 0, pointer = 1): TouchModel {
  const m = new TouchModel();
  m.setStickRadius(R);
  m.press(pointer, 'stick', 100, 300);
  m.move(pointer, 100 + dx, 300 + dy);
  return m;
}

describe('stickRadiusFor', () => {
  it('is 15 % of the shorter side, bounded so tiny and huge screens both stay usable', () => {
    expect(stickRadiusFor(844, 390)).toBe(59);
    expect(stickRadiusFor(390, 844)).toBe(59); // orientation does not matter
    expect(stickRadiusFor(320, 200)).toBe(STICK_RADIUS_MIN);
    expect(stickRadiusFor(2560, 1440)).toBe(STICK_RADIUS_MAX);
  });
  it('falls back to the minimum for nonsense sizes', () => {
    expect(stickRadiusFor(0, 0)).toBe(STICK_RADIUS_MIN);
    expect(stickRadiusFor(Number.NaN, 400)).toBe(STICK_RADIUS_MIN);
  });
});

describe('stickToAxes (the same dead zone as the controller)', () => {
  it('neutral is exactly zero (never -0)', () => {
    const a = stickToAxes(0, 0, R);
    expect(Object.is(a.rotate, 0)).toBe(true);
    expect(Object.is(a.move, 0)).toBe(true);
  });

  it('uses the gamepad dead zone: inside it is zero, just outside it is the raw value (not rescaled)', () => {
    const edge = STICK_DEADZONE * R; // 9 px
    expect(stickToAxes(edge, 0, R).rotate).toBe(0);
    expect(stickToAxes(-edge, 0, R).rotate).toBe(0);
    expect(stickToAxes(0, edge, R).move).toBe(0);
    expect(stickToAxes(edge + 0.5, 0, R).rotate).toBeCloseTo((edge + 0.5) / R, 10);
    expect(stickToAxes(-(edge + 0.5), 0, R).rotate).toBeCloseTo(-(edge + 0.5) / R, 10);
  });

  it('is proportional: half deflection is about half a turn, full deflection is the keyboard\'s full turn', () => {
    expect(stickToAxes(R / 2, 0, R).rotate).toBeCloseTo(0.5, 10);
    expect(stickToAxes(R, 0, R).rotate).toBe(1);
    expect(stickToAxes(R * 5, 0, R).rotate).toBe(1); // beyond the radius still clamps at 1
  });

  it('right turns positive (D), left negative (A)', () => {
    expect(stickToAxes(40, 0, R).rotate).toBeGreaterThan(0);
    expect(stickToAxes(-40, 0, R).rotate).toBeLessThan(0);
  });

  it('up is forward (positive move), down is backward: screen y grows downward', () => {
    expect(stickToAxes(0, -40, R).move).toBeGreaterThan(0);
    expect(stickToAxes(0, 40, R).move).toBeLessThan(0);
    expect(stickToAxes(0, -R, R).move).toBe(1);
    expect(stickToAxes(0, R, R).move).toBe(-1);
  });

  it('diagonals turn and move at once; each axis has its own dead zone', () => {
    expect(stickToAxes(-45, -45, R)).toEqual({ rotate: -0.75, move: 0.75 });
    // Mostly sideways with a little vertical wobble inside the dead zone: turns, does not creep forward.
    const sideways = stickToAxes(50, -5, R);
    expect(sideways.rotate).toBeGreaterThan(0.8);
    expect(sideways.move).toBe(0);
  });

  it('a corner push is full rate on both axes (a square gate, like holding W and D)', () => {
    expect(stickToAxes(R, -R, R)).toEqual({ rotate: 1, move: 1 });
  });

  it('is safe with a zero radius or non-finite numbers', () => {
    expect(stickToAxes(10, 10, 0)).toEqual({ rotate: 0, move: 0 });
    expect(stickToAxes(Number.NaN, 10, R)).toEqual({ rotate: 0, move: 0 });
    expect(stickToAxes(Number.POSITIVE_INFINITY, 0, R)).toEqual({ rotate: 0, move: 0 });
  });
});

describe('TouchModel', () => {
  it('starts neutral', () => {
    const m = new TouchModel();
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
    expect(m.activePointers).toBe(0);
  });

  it('the stick is relative to where the thumb landed: touching down is neutral wherever it is', () => {
    const m = new TouchModel();
    m.press(1, 'stick', 37, 211);
    expect(m.command().rotate).toBe(0);
    expect(m.command().move).toBe(0);
    m.move(1, 37 + 30, 211);
    expect(m.command().rotate).toBeCloseTo(30 / m.stickRadius, 10);
  });

  it('turns both ways, moves both ways, and combines them', () => {
    expect(modelWithStick(40, 0).command().rotate).toBeGreaterThan(0);
    expect(modelWithStick(-40, 0).command().rotate).toBeLessThan(0);
    expect(modelWithStick(0, -40).command().move).toBeGreaterThan(0);
    expect(modelWithStick(0, 40).command().move).toBeLessThan(0);
    const diag = modelWithStick(-40, -40).command();
    expect(diag.rotate).toBeLessThan(0);
    expect(diag.move).toBeGreaterThan(0);
  });

  it('releasing the stick returns to neutral at once', () => {
    const m = modelWithStick(50, -50);
    expect(m.command().rotate).not.toBe(0);
    expect(m.release(1)).toBe('stick');
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
  });

  it('FIRE is continuous: shoot stays true for as long as a finger is on it, then stops', () => {
    const m = new TouchModel();
    m.press(7, 'fire', 700, 300);
    for (let frame = 0; frame < 120; frame++) expect(m.command().shoot).toBe(true);
    m.release(7);
    expect(m.command().shoot).toBe(false);
  });

  it('LASER and BOOST report "held" while touched (the player turns that into one activation per press)', () => {
    const m = new TouchModel();
    m.press(1, 'laser', 600, 300);
    expect(m.command()).toMatchObject({ laser: true, boost: false, shoot: false });
    m.release(1);
    m.press(2, 'boost', 700, 200);
    expect(m.command()).toMatchObject({ laser: false, boost: true });
    m.release(2);
    expect(m.command().boost).toBe(false);
  });

  it('steers, fires and uses a special at the same time (three independent fingers)', () => {
    const m = modelWithStick(-50, -50, 1);
    m.press(2, 'fire', 700, 300);
    m.press(3, 'laser', 620, 300);
    expect(m.command()).toMatchObject({ shoot: true, laser: true, boost: false });
    expect(m.command().rotate).toBeLessThan(0);
    expect(m.command().move).toBeGreaterThan(0);
    // Lifting the stick finger does not disturb the other two, and the order of lifting does not matter.
    m.release(1);
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: true, laser: true, boost: false });
    m.release(3);
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: true, laser: false, boost: false });
  });

  it('two fingers on FIRE: it stays held until both are up', () => {
    const m = new TouchModel();
    m.press(1, 'fire', 700, 300);
    m.press(2, 'fire', 705, 305);
    m.release(1);
    expect(m.command().shoot).toBe(true);
    m.release(2);
    expect(m.command().shoot).toBe(false);
  });

  it('a second finger on the stick is ignored and never tracked (it cannot leak or steal the first one)', () => {
    const m = new TouchModel();
    expect(m.press(1, 'stick', 100, 300)).toBe(true);
    expect(m.press(2, 'stick', 200, 200)).toBe(false);
    expect(m.has(2)).toBe(false);
    m.move(2, 400, 100); // the stray finger moving does nothing
    expect(m.command().rotate).toBe(0);
    m.release(1);
    expect(m.activePointers).toBe(0);
  });

  it('a finger is bound to the control it started on: moving never re-targets it', () => {
    const m = new TouchModel();
    m.press(1, 'fire', 700, 300);
    m.move(1, 620, 300); // slides over the LASER button
    expect(m.command()).toMatchObject({ shoot: true, laser: false });
    expect(m.controlOf(1)).toBe('fire');
  });

  it('moves of unknown pointers are ignored and releasing an unknown pointer is harmless', () => {
    const m = new TouchModel();
    m.move(5, 1, 1);
    expect(m.release(5)).toBeNull();
    expect(m.command().rotate).toBe(0);
  });

  it('a repeated press of the same pointer id replaces its binding instead of stacking', () => {
    const m = new TouchModel();
    m.press(1, 'fire', 700, 300);
    m.press(1, 'laser', 620, 300);
    expect(m.activePointers).toBe(1);
    expect(m.command()).toMatchObject({ shoot: false, laser: true });
  });

  it('releaseAll lets go of everything and says whether anything was held', () => {
    const m = modelWithStick(50, -50, 1);
    m.press(2, 'fire', 700, 300);
    m.press(3, 'boost', 700, 200);
    expect(m.releaseAll()).toBe(true);
    expect(m.command()).toEqual({ rotate: 0, move: 0, shoot: false, laser: false, boost: false });
    expect(m.activePointers).toBe(0);
    expect(m.releaseAll()).toBe(false);
    // The stick is free again for a new finger.
    expect(m.press(9, 'stick', 10, 10)).toBe(true);
  });

  it('a disabled model takes no presses and disabling lets go of what was held', () => {
    const m = new TouchModel();
    m.press(1, 'fire', 700, 300);
    m.setEnabled(false);
    expect(m.command().shoot).toBe(false);
    expect(m.press(2, 'fire', 700, 300)).toBe(false);
    expect(m.activePointers).toBe(0);
    m.setEnabled(true);
    expect(m.press(2, 'fire', 700, 300)).toBe(true);
  });

  it('the knob drawn for a long drag is limited to the stick radius, while the command is not affected', () => {
    const m = modelWithStick(300, 0);
    const view = m.stickView();
    expect(view.active).toBe(true);
    expect(Math.hypot(view.knobX, view.knobY)).toBeCloseTo(R, 10);
    expect(m.command().rotate).toBe(1);
    m.release(1);
    expect(m.stickView()).toMatchObject({ active: false, knobX: 0, knobY: 0 });
  });

  it('notifies listeners only about real changes, and the unsubscribe works', () => {
    const m = new TouchModel();
    let calls = 0;
    const stop = m.onChange(() => calls++);
    m.press(1, 'fire', 0, 0);
    expect(calls).toBe(1);
    m.move(1, 5, 5); // not the stick: nothing to draw
    expect(calls).toBe(1);
    m.release(1);
    expect(calls).toBe(2);
    m.releaseAll(); // nothing held
    expect(calls).toBe(2);
    stop();
    m.press(1, 'fire', 0, 0);
    expect(calls).toBe(2);
    expect(m.listenerCount).toBe(0);
  });
});
