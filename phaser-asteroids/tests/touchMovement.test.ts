import { describe, expect, it } from 'vitest';
import {
  ASSIST_TRAVEL_TURN_SPEED,
  BOOST_SPEED_MULTIPLIER,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_TURN_SPEED,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  TOUCH_STEER_TURN_SPEED,
} from '../src/core/constants';
import { directionToHeading, getForwardVector, shortestAngleDelta, turnToward, type Vec2 } from '../src/core/math';
import { createPlayer, NO_INPUT, respawnPlayer, updatePlayer, type PlayerInput, type PlayerState, type SteerRequest } from '../src/core/player';
import { mergeInputs } from '../src/input/gamepadMapping';
import { HeldKeys } from '../src/input/heldKeys';
import { keySchemesFor } from '../src/input/keyboardControls';
import { readPlayerInputs } from '../src/input/playerInputs';
import { TouchControls } from '../src/input/touchControls';
import { DIRECTION_DEAD_ZONE, DIRECTION_DEAD_ZONE_HELD, TouchModel, type StickStyle } from '../src/input/touchModel';
import { FRAME, quietSim, rock } from './helpers';
import { FakeDoc, FakeHost, FakeView, LAYOUT, centre, pointer } from './touchFakes';

/**
 * Point-to-Fly and Assisted Flight. The ship in this game has NO inertia: it moves PLAYER_SPEED along its direction of travel only
 * while thrust is held and stops the moment it is released (the only velocity is a short wall-bounce impulse). So "momentum" never
 * appears below; what is tested is where the nose points, where the ship travels, and that nothing else changes.
 *
 * Headings use the simulation's own convention (Pygame): 0 = Down, 90 = Left, 180 = Up, 270 = Right.
 */

const DOWN = 0;
const LEFT = 90;
const UP = 180;
const RIGHT = 270;

const point = (heading: number): SteerRequest => ({ heading, mode: 'point' });
const assist = (heading: number): SteerRequest => ({ heading, mode: 'assist' });
const stick = (steer: SteerRequest | null, extra: Partial<PlayerInput> = {}): PlayerInput =>
  steer ? { ...NO_INPUT, move: 1, steer, ...extra } : { ...NO_INPUT, ...extra };

function ship(x = 640, y = 360, rotation = 0): PlayerState {
  const p = createPlayer(x, y);
  p.rotation = rotation;
  return p;
}

function fly(p: PlayerState, input: PlayerInput, seconds: number, fps = 60): void {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) updatePlayer(p, input, 1 / fps);
}

/** Unsigned angle between two headings, 0..180. */
const apart = (a: number, b: number): number => Math.abs(shortestAngleDelta(a, b));
/** The heading a displacement points along. */
const headingOf = (d: Vec2): number => directionToHeading(d.x, d.y);

describe('angle helpers', () => {
  it('turn a screen direction into the simulation heading, for all eight directions', () => {
    const cases: Array<[number, number, number]> = [
      [0, 1, DOWN],
      [-1, 0, LEFT],
      [0, -1, UP],
      [1, 0, RIGHT],
      [1, -1, 225], // up-right
      [-1, -1, 135], // up-left
      [1, 1, 315], // down-right
      [-1, 1, 45], // down-left
    ];
    for (const [x, y, heading] of cases) expect(directionToHeading(x, y)).toBeCloseTo(heading, 9);
  });

  it('is the inverse of getForwardVector: a ship at that heading flies exactly the way the thumb points', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const f = getForwardVector(deg);
      expect(apart(directionToHeading(f.x, f.y), deg)).toBeLessThan(1e-9);
    }
    expect(directionToHeading(0, 0)).toBe(0);
  });

  it('shortestAngleDelta takes the short way round the wrap, and picks +180 for an exact reversal', () => {
    expect(shortestAngleDelta(350, 10)).toBeCloseTo(20, 9);
    expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20, 9);
    expect(shortestAngleDelta(0, 90)).toBeCloseTo(90, 9);
    expect(shortestAngleDelta(90, 0)).toBeCloseTo(-90, 9);
    expect(shortestAngleDelta(0, 180)).toBe(180);
    expect(shortestAngleDelta(180, 0)).toBe(180);
    expect(shortestAngleDelta(45, 45 + 360)).toBeCloseTo(0, 9);
    expect(shortestAngleDelta(0, 181)).toBeCloseTo(-179, 9);
    expect(shortestAngleDelta(0, 179)).toBeCloseTo(179, 9);
  });

  it('turnToward is limited by maxStep, never overshoots, wraps into [0, 360) and ignores a negative step', () => {
    expect(turnToward(0, 90, 10)).toBe(10);
    expect(turnToward(0, 5, 10)).toBe(5);
    expect(turnToward(355, 10, 10)).toBeCloseTo(5, 9);
    expect(turnToward(5, 350, 10)).toBeCloseTo(355, 9);
    expect(turnToward(100, 100, 10)).toBe(100);
    expect(turnToward(100, 200, -5)).toBe(100);
    for (const start of [0, 359.9, 180, 90]) for (const target of [0, 90, 180, 270, 359]) {
      const r = turnToward(start, target, 7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});

describe('the joystick through TouchModel: absolute direction, dead zone, release', () => {
  const R = 60;
  function stickModel(style: StickStyle = 'point'): TouchModel {
    const m = new TouchModel();
    m.setStickRadius(R);
    m.setSteering('joystick');
    m.setStickStyle(style);
    m.press(1, 'stick', 300, 300);
    return m;
  }
  const push = (m: TouchModel, dx: number, dy: number): void => m.move(1, 300 + dx, 300 + dy);

  it('reports the heading of the thumb, relative to the stick centre, in screen terms', () => {
    const d = R * 0.8;
    const cases: Array<[string, number, number, number]> = [
      ['up', 0, -d, UP],
      ['down', 0, d, DOWN],
      ['left', -d, 0, LEFT],
      ['right', d, 0, RIGHT],
      ['up-right', d, -d, 225],
      ['up-left', -d, -d, 135],
      ['down-right', d, d, 315],
      ['down-left', -d, d, 45],
    ];
    for (const style of ['point', 'assist'] as const) {
      for (const [name, dx, dy, heading] of cases) {
        const m = stickModel(style);
        push(m, dx, dy);
        const c = m.command();
        expect(c.steer?.heading, `${style} ${name}`).toBeCloseTo(heading, 9);
        expect(c.steer?.mode).toBe(style === 'assist' ? 'assist' : 'point');
        expect(c.move).toBe(1);
        expect(c.rotate).toBe(0);
      }
    }
  });

  it('is absolute: it does not matter where the thumb first landed, only where it is relative to that point', () => {
    for (const [ax, ay] of [[40, 80], [300, 200], [500, 340]] as const) {
      const m = new TouchModel();
      m.setStickRadius(R);
      m.setStickStyle('point');
      m.press(1, 'stick', ax, ay);
      m.move(1, ax + 50, ay);
      expect(m.command().steer?.heading).toBeCloseTo(RIGHT, 9);
    }
  });

  it('full deflection and a light push give the same request: direction only, no magnitude', () => {
    const light = stickModel();
    push(light, 0, -R * 0.4);
    const hard = stickModel();
    push(hard, 0, -R * 3);
    expect(light.command()).toEqual(hard.command());
  });

  it('does nothing inside the dead zone, however it wobbles', () => {
    const m = stickModel();
    expect(m.command().steer).toBeUndefined(); // landing alone is neutral
    for (const [dx, dy] of [[3, 3], [-5, 2], [0, -R * DIRECTION_DEAD_ZONE * 0.9], [R * 0.2, R * 0.1]] as const) {
      push(m, dx, dy);
      const c = m.command();
      expect(c.steer).toBeUndefined();
      expect(c.move).toBe(0);
      expect(c.rotate).toBe(0);
    }
  });

  it('switches on just outside the dead zone, and only lets go below the smaller held threshold (no flicker on the edge)', () => {
    const m = stickModel();
    push(m, 0, -R * (DIRECTION_DEAD_ZONE + 0.01));
    expect(m.command().steer).toBeDefined();
    push(m, 0, -R * (DIRECTION_DEAD_ZONE - 0.03)); // between the two thresholds: still steering
    expect(m.command().steer).toBeDefined();
    push(m, 0, -R * (DIRECTION_DEAD_ZONE_HELD - 0.02));
    expect(m.command().steer).toBeUndefined();
    push(m, 0, -R * (DIRECTION_DEAD_ZONE - 0.03)); // not yet back in: it needs the full dead zone again
    expect(m.command().steer).toBeUndefined();
    push(m, 0, -R * (DIRECTION_DEAD_ZONE + 0.02));
    expect(m.command().steer).toBeDefined();
  });

  it('lifting the finger, or cancelling it, clears the request at once', () => {
    for (const how of ['release', 'releaseAll'] as const) {
      const m = stickModel();
      push(m, R, 0);
      expect(m.command().steer).toBeDefined();
      if (how === 'release') m.release(1);
      else m.releaseAll();
      expect(m.command()).toEqual(NO_INPUT);
      // A fresh touch starts neutral, not where the last one ended.
      m.press(2, 'stick', 100, 100);
      expect(m.command().steer).toBeUndefined();
    }
  });

  it('rapid changes of direction are followed exactly, one request per move', () => {
    const m = stickModel();
    const d = R * 0.9;
    const seq: Array<[number, number, number]> = [
      [d, 0, RIGHT],
      [-d, 0, LEFT],
      [0, -d, UP],
      [0, d, DOWN],
      [d, -d, 225],
      [-d, d, 45],
    ];
    for (const [dx, dy, heading] of seq) {
      push(m, dx, dy);
      expect(m.command().steer?.heading).toBeCloseTo(heading, 9);
    }
  });

  it('a second finger on the stick is ignored, and FIRE / LASER / BOOST work beside it', () => {
    const m = stickModel();
    push(m, R, 0);
    expect(m.press(2, 'stick', 100, 100)).toBe(false);
    m.press(3, 'fire', 700, 300);
    m.press(4, 'laser', 650, 300);
    m.press(5, 'boost', 750, 190);
    const c = m.command();
    expect(c).toMatchObject({ shoot: true, laser: true, boost: true, move: 1, rotate: 0 });
    expect(c.steer?.heading).toBeCloseTo(RIGHT, 9);
    m.release(3);
    expect(m.command()).toMatchObject({ shoot: false, laser: true, boost: true });
    expect(m.command().steer).toBeDefined();
  });

  it('the legacy relative stick is untouched, and the D-pad never carries a heading', () => {
    const relative = stickModel('relative');
    push(relative, R, -R);
    expect(relative.command()).toMatchObject({ rotate: 1, move: 1 });
    expect(relative.command().steer).toBeUndefined();

    const dpad = new TouchModel();
    dpad.setSteering('dpad');
    dpad.setDpadGeometry(100, 300, 80);
    dpad.press(1, 'dpad', 100, 240);
    expect(dpad.command()).toEqual({ ...NO_INPUT, move: 1 });
  });

  it('changing the stick style lets go of everything held', () => {
    const m = stickModel('point');
    push(m, R, 0);
    m.press(2, 'fire', 700, 300);
    m.setStickStyle('assist');
    expect(m.command()).toEqual(NO_INPUT);
    expect(m.activePointers).toBe(0);
  });
});

describe('Point-to-Fly: the nose turns toward the stick and the ship flies along it', () => {
  it('turns toward each principal direction by the shortest way', () => {
    // [start rotation, target, expected sign of the first turn]
    const cases: Array<[number, number, number]> = [
      [0, LEFT, 1],
      [0, RIGHT, -1], // 270 is nearer by going backwards
      [0, UP, 1], // exactly opposite: +180, so clockwise-in-the-sim, stable
      [UP, DOWN, 1],
      [350, 10, 1],
      [10, 350, -1],
      [LEFT, 225, 1],
      [RIGHT, 45, 1],
    ];
    for (const [start, target, sign] of cases) {
      const p = ship(640, 360, start);
      updatePlayer(p, stick(point(target)), FRAME);
      expect(Math.sign(shortestAngleDelta(start, p.rotation)), `${start} -> ${target}`).toBe(sign);
    }
  });

  it('settles exactly on every principal and diagonal direction, and stays there', () => {
    for (const target of [DOWN, LEFT, UP, RIGHT, 45, 135, 225, 315]) {
      const p = ship(640, 360, 123);
      fly(p, stick(point(target)), 1); // far longer than the longest turn
      expect(p.rotation).toBeCloseTo(target, 6);
      fly(p, stick(point(target)), 0.5);
      expect(p.rotation).toBeCloseTo(target, 6);
    }
  });

  it('rotates smoothly at a limited rate instead of snapping', () => {
    const p = ship(640, 360, 0);
    let last = p.rotation;
    for (let i = 0; i < 60; i++) {
      updatePlayer(p, stick(point(UP)), FRAME);
      const step = Math.abs(shortestAngleDelta(last, p.rotation));
      expect(step).toBeLessThanOrEqual(TOUCH_STEER_TURN_SPEED * FRAME + 1e-9);
      last = p.rotation;
    }
    // Not there after one frame; 180 degrees at the turn rate takes 0.6 s.
    const q = ship(640, 360, 0);
    updatePlayer(q, stick(point(UP)), FRAME);
    expect(q.rotation).toBeCloseTo(TOUCH_STEER_TURN_SPEED * FRAME, 9);
    const r = ship(640, 360, 0);
    fly(r, stick(point(UP)), 0.3);
    expect(r.rotation).toBeCloseTo(90, 6);
    fly(r, stick(point(UP)), 0.3);
    expect(r.rotation).toBeCloseTo(UP, 6);
  });

  it('starts out at the same turn rate as Classic', () => {
    expect(TOUCH_STEER_TURN_SPEED).toBe(PLAYER_TURN_SPEED);
  });

  it('thrusts at the normal speed along the nose the whole time it turns (the path curves)', () => {
    const p = ship(640, 360, DOWN);
    let last = { ...p.position };
    for (let i = 0; i < 30; i++) {
      updatePlayer(p, stick(point(UP)), FRAME);
      const step = Math.hypot(p.position.x - last.x, p.position.y - last.y);
      expect(step).toBeCloseTo(PLAYER_SPEED * FRAME, 6);
      last = { ...p.position };
    }
    // Still turning, so it has not yet gone straight up: it has drifted sideways while swinging round.
    expect(Math.abs(p.position.x - 640)).toBeGreaterThan(10);
    expect(p.travelHeading).toBeNull();
  });

  it('flies where the nose points, which is where the stick pointed once the turn is done', () => {
    for (const target of [DOWN, LEFT, UP, RIGHT]) {
      const p = ship(640, 360, target);
      const start = { ...p.position };
      fly(p, stick(point(target)), 0.25);
      const d = { x: p.position.x - start.x, y: p.position.y - start.y };
      expect(apart(headingOf(d), target)).toBeLessThan(1e-6);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(PLAYER_SPEED * 0.25, 4);
    }
  });

  it('stops steering and thrusting on release: no more turning, no more travel, no hidden velocity', () => {
    const p = ship(640, 360, DOWN);
    fly(p, stick(point(LEFT)), 0.1);
    const rotation = p.rotation;
    const position = { ...p.position };
    fly(p, NO_INPUT, 1);
    expect(p.rotation).toBe(rotation);
    expect(p.position).toEqual(position);
    expect(p.velocity).toEqual({ x: 0, y: 0 }); // the bounce impulse is the only velocity this game has, and it was not touched
    expect(p.isMoving).toBe(false);
  });

  it('follows rapid reversals of the stick without overshoot, and spinning the stick round does not spin the ship further', () => {
    const p = ship();
    let last = p.rotation;
    for (let i = 0; i < 120; i++) {
      updatePlayer(p, stick(point(i % 2 === 0 ? LEFT : RIGHT)), FRAME);
      expect(Math.abs(shortestAngleDelta(last, p.rotation))).toBeLessThanOrEqual(TOUCH_STEER_TURN_SPEED * FRAME + 1e-9);
      last = p.rotation;
    }

    // The thumb circles the stick twice in four seconds. The ship's total turning (unwrapped) can never exceed the thumb's plus
    // one half-turn of lag, and it ends up facing the thumb: it never winds itself up.
    const q = ship();
    let thumb = 0;
    let turned = 0;
    last = q.rotation;
    for (let i = 0; i < 240; i++) {
      thumb += 3; // 180 deg/s
      updatePlayer(q, stick(point(thumb % 360)), FRAME);
      turned += shortestAngleDelta(last, q.rotation);
      last = q.rotation;
    }
    expect(Math.abs(turned)).toBeLessThanOrEqual(720 + 1);
    expect(apart(q.rotation, thumb % 360)).toBeLessThan(5);
  });

  it('does not touch the wrap of the rotation: always in [0, 360)', () => {
    const p = ship(640, 360, 359);
    for (const target of [1, 359, 0, 180, 270]) {
      fly(p, stick(point(target)), 0.2);
      expect(p.rotation).toBeGreaterThanOrEqual(0);
      expect(p.rotation).toBeLessThan(360);
    }
  });
});

describe('Assisted Flight: the direction of travel is steered toward the stick, ahead of the nose', () => {
  it('turns the nose exactly as Point-to-Fly does (the same smooth, rate-limited turn)', () => {
    for (const [start, target] of [[0, UP], [350, 10], [LEFT, RIGHT], [45, 315]] as const) {
      const a = ship(640, 360, start);
      const b = ship(640, 360, start);
      for (let i = 0; i < 40; i++) {
        updatePlayer(a, stick(assist(target)), FRAME);
        updatePlayer(b, stick(point(target)), FRAME);
        expect(a.rotation).toBeCloseTo(b.rotation, 9);
      }
    }
  });

  it('flies toward every principal direction from the first frame, at the normal speed', () => {
    for (const target of [DOWN, LEFT, UP, RIGHT, 45, 135, 225, 315]) {
      const p = ship(640, 360, 200); // nose pointing somewhere unrelated
      const start = { ...p.position };
      updatePlayer(p, stick(assist(target)), FRAME);
      const d = { x: p.position.x - start.x, y: p.position.y - start.y };
      expect(apart(headingOf(d), target), `${target}`).toBeLessThan(1e-6);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(PLAYER_SPEED * FRAME, 6);
    }
  });

  it('bends its direction of travel toward a new stick direction at a bounded rate, with no jump', () => {
    const p = ship(640, 360, RIGHT);
    fly(p, stick(assist(RIGHT)), 0.5);
    expect(p.travelHeading).toBeCloseTo(RIGHT, 9);

    // The player now wants UP: a 90 degree change. The travel direction swings across over several frames.
    const trail: number[] = [];
    let last = { ...p.position };
    const errors: number[] = [];
    for (let i = 0; i < 12; i++) {
      updatePlayer(p, stick(assist(UP)), FRAME);
      const d = { x: p.position.x - last.x, y: p.position.y - last.y };
      trail.push(headingOf(d));
      errors.push(apart(headingOf(d), UP));
      last = { ...p.position };
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(PLAYER_SPEED * FRAME, 6); // never a burst of speed
    }
    expect(apart(trail[0] as number, RIGHT)).toBeCloseTo(ASSIST_TRAVEL_TURN_SPEED * FRAME, 6); // one bounded step, not a jump
    for (let i = 1; i < errors.length; i++) expect(errors[i] as number).toBeLessThanOrEqual((errors[i - 1] as number) + 1e-9);
    expect(errors[0] as number).toBeGreaterThan(70);
    expect(errors[errors.length - 1] as number).toBeLessThan(1e-6); // 90 deg at 600 deg/s = 9 frames
    // ...while the nose, limited to 300 deg/s, is still on its way: travel is ahead of where the ship is facing.
    expect(apart(p.rotation, UP)).toBeGreaterThan(10);
  });

  it('shows the difference to Point-to-Fly under identical input: same start, same stick, different trajectory', () => {
    const make = (): PlayerState => ship(400, 360, RIGHT);
    const a = make(); // Assisted
    const b = make(); // Point-to-Fly
    // Both are flying right, then the player flicks the stick to UP and holds it.
    fly(a, stick(assist(RIGHT)), 0.3);
    fly(b, stick(point(RIGHT)), 0.3);
    expect(a.position).toEqual(b.position);
    expect(a.rotation).toBeCloseTo(b.rotation, 9);

    const startA = { ...a.position };
    const startB = { ...b.position };
    const rows: Array<{ t: number; sidewaysA: number; sidewaysB: number; upA: number; upB: number }> = [];
    for (let i = 1; i <= 24; i++) {
      updatePlayer(a, stick(assist(UP)), FRAME);
      updatePlayer(b, stick(point(UP)), FRAME);
      rows.push({
        t: i * FRAME,
        sidewaysA: a.position.x - startA.x,
        sidewaysB: b.position.x - startB.x,
        upA: startA.y - a.position.y,
        upB: startB.y - b.position.y,
      });
    }
    const end = rows[rows.length - 1]!;
    // Assisted gets going up sooner and wastes less sideways, at every moment after the first frame.
    for (const r of rows.slice(1)) {
      expect(r.upA).toBeGreaterThan(r.upB);
      expect(r.sidewaysA).toBeLessThan(r.sidewaysB);
    }
    // And the gap is something a player would feel, not a rounding error: at least 15 px (about 4 ship radii... 0.75 radius) after 0.4 s.
    expect(end.upA - end.upB).toBeGreaterThan(15);
    expect(end.sidewaysB - end.sidewaysA).toBeGreaterThan(15);
    // Both obey the same speed: neither travelled farther than PLAYER_SPEED allows.
    for (const [p, start] of [[a, startA], [b, startB]] as const) {
      expect(Math.hypot(p.position.x - start.x, p.position.y - start.y)).toBeLessThanOrEqual(PLAYER_SPEED * 24 * FRAME + 1e-6);
    }
    // Once both noses are round, the two modes are the same again (the ships end on parallel courses).
    fly(a, stick(assist(UP)), 0.5);
    fly(b, stick(point(UP)), 0.5);
    expect(a.rotation).toBeCloseTo(b.rotation, 9);
  });

  it('reverses faster than Point-to-Fly, but not instantly', () => {
    const turnaround = (request: (h: number) => SteerRequest): number => {
      const p = ship(640, 360, RIGHT);
      fly(p, stick(request(RIGHT)), 0.2);
      let last = { ...p.position };
      for (let i = 1; i <= 120; i++) {
        updatePlayer(p, stick(request(LEFT)), FRAME);
        const d = { x: p.position.x - last.x, y: p.position.y - last.y };
        last = { ...p.position };
        if (apart(headingOf(d), LEFT) < 1) return i;
      }
      return Infinity;
    };
    const assisted = turnaround(assist);
    const pointed = turnaround(point);
    expect(assisted).toBeGreaterThan(Math.floor(180 / (ASSIST_TRAVEL_TURN_SPEED * FRAME)) - 1); // not a jump
    expect(assisted).toBeLessThan(pointed);
    expect(pointed / assisted).toBeGreaterThan(1.5);
  });

  it('coasts on release: it simply stops, forgets its travel direction and keeps no velocity', () => {
    const p = ship(640, 360, 0);
    fly(p, stick(assist(RIGHT)), 0.3);
    expect(p.travelHeading).not.toBeNull();
    const position = { ...p.position };
    updatePlayer(p, NO_INPUT, FRAME);
    expect(p.position).toEqual(position);
    expect(p.travelHeading).toBeNull();
    expect(p.velocity).toEqual({ x: 0, y: 0 });
    // The next push starts straight from the stick's own direction, not from the one before the release.
    const before = { ...p.position };
    updatePlayer(p, stick(assist(UP)), FRAME);
    expect(apart(headingOf({ x: p.position.x - before.x, y: p.position.y - before.y }), UP)).toBeLessThan(1e-6);
  });

  it('never teleports, never stops short and never exceeds its speed: every frame moves exactly PLAYER_SPEED * dt', () => {
    const p = ship(640, 360, 0);
    let last = { ...p.position };
    for (let i = 0; i < 240; i++) {
      const target = (i * 37) % 360; // a restless thumb
      updatePlayer(p, stick(assist(target)), FRAME);
      const step = Math.hypot(p.position.x - last.x, p.position.y - last.y);
      if (p.position.x > PLAYER_RADIUS + 1 && p.position.x < SCREEN_WIDTH - PLAYER_RADIUS - 1 && p.position.y > PLAYER_RADIUS + 1 && p.position.y < SCREEN_HEIGHT - PLAYER_RADIUS - 1) {
        expect(step).toBeCloseTo(PLAYER_SPEED * FRAME, 6);
      } else {
        expect(step).toBeLessThanOrEqual(PLAYER_SPEED * FRAME + 1e-6 + 150 * FRAME); // a wall may nudge it back by its bounce impulse
      }
      last = { ...p.position };
    }
  });

  it('keeps Boost: 2.5x the distance along the same travel direction, FIRE still held off while boosting', () => {
    const plain = ship(300, 360, RIGHT);
    const boosted = ship(300, 360, RIGHT);
    boosted.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    const ahead = stick(assist(RIGHT), { boost: true, shoot: true });
    let shots = 0;
    for (let i = 0; i < 20; i++) {
      updatePlayer(plain, stick(assist(RIGHT)), FRAME);
      shots += updatePlayer(boosted, ahead, FRAME).shots.length;
    }
    expect((boosted.position.x - 300) / (plain.position.x - 300)).toBeCloseTo(BOOST_SPEED_MULTIPLIER, 6);
    expect(boosted.position.y).toBeCloseTo(360, 6);
    expect(shots).toBe(0);

    // A boost that starts mid-turn multiplies the corrected direction, not the nose's.
    const q = ship(300, 360, RIGHT);
    fly(q, stick(assist(RIGHT)), 0.2);
    q.boost = { active: true, timer: 3, cooldown: 8, keyHeld: true };
    const from = { ...q.position };
    updatePlayer(q, stick(assist(UP), { boost: true }), FRAME);
    const d = { x: q.position.x - from.x, y: q.position.y - from.y };
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(PLAYER_SPEED * BOOST_SPEED_MULTIPLIER * FRAME, 6);
  });

  it('the boost / laser buttons beside the stick still activate once per press', () => {
    const p = ship();
    const first = updatePlayer(p, stick(assist(UP), { boost: true, laser: true }), FRAME);
    expect(first.boostStarted).toBe(true);
    expect(first.laser).not.toBeNull();
    const second = updatePlayer(p, stick(assist(UP), { boost: true, laser: true }), FRAME);
    expect(second.boostStarted).toBe(false);
    expect(second.laser).toBeNull();
  });

  it('keeps the walls: a ship driven into one is clamped inside and bounced, never wrapped', () => {
    for (const target of [RIGHT, LEFT, UP, DOWN]) {
      const p = ship(640, 360, target);
      let bounced = false;
      for (let i = 0; i < 400; i++) {
        const r = updatePlayer(p, stick(assist(target)), FRAME);
        bounced ||= r.bounce !== null;
        expect(p.position.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-6);
        expect(p.position.x).toBeLessThanOrEqual(SCREEN_WIDTH - PLAYER_RADIUS + 1e-6);
        expect(p.position.y).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-6);
        expect(p.position.y).toBeLessThanOrEqual(SCREEN_HEIGHT - PLAYER_RADIUS + 1e-6);
      }
      expect(bounced).toBe(true);
    }
  });

  it('is not frame-rate dependent: 30, 60 and 144 fps end up in the same place', () => {
    const script = (p: PlayerState, fps: number): void => {
      const legs: Array<[number, number]> = [[RIGHT, 0.5], [UP, 0.5], [225, 0.5], [LEFT, 0.5]];
      for (const [target, seconds] of legs) fly(p, stick(assist(target)), seconds, fps);
    };
    const results = [30, 60, 144, 240].map((fps) => {
      const p = ship(640, 360, DOWN);
      script(p, fps);
      return p;
    });
    const reference = results[1] as PlayerState;
    for (const p of results) {
      expect(Math.hypot(p.position.x - reference.position.x, p.position.y - reference.position.y)).toBeLessThan(14); // about one 30 fps frame of travel
      expect(apart(p.rotation, reference.rotation)).toBeLessThan(1e-6);
    }
    // The same through the full simulation, which slices long frames into sub-steps.
    const viaSim = [30, 60, 144].map((fps) => {
      const sim = quietSim();
      const input = stick(assist(UP));
      for (let i = 0; i < fps * 0.3; i++) sim.step(1 / fps, input);
      return sim.player;
    });
    const simRef = viaSim[1] as PlayerState;
    for (const p of viaSim) expect(Math.hypot(p.position.x - simRef.position.x, p.position.y - simRef.position.y)).toBeLessThan(14);
  });
});

describe('no assistance unless the touch stick asks for it', () => {
  it('Classic, keyboard and gamepad inputs (no steer) move the ship exactly as before', () => {
    const a = ship(640, 360, 33);
    const b = ship(640, 360, 33);
    const input: PlayerInput = { rotate: 0.6, move: 1, shoot: false };
    for (let i = 0; i < 90; i++) {
      updatePlayer(a, input, FRAME);
      updatePlayer(b, { ...input, steer: undefined }, FRAME);
    }
    expect(a.position).toEqual(b.position);
    expect(a.rotation).toBe(b.rotation);
    expect(a.travelHeading).toBeNull();
    // ...and the numbers are the classic ones: turning at 300 deg/s * 0.6, moving at 300 px/s.
    expect(a.rotation).toBeCloseTo((33 + 0.6 * PLAYER_TURN_SPEED * 1.5) % 360, 6);
  });

  it('a Point-to-Fly request never sets a travel direction', () => {
    const p = ship();
    fly(p, stick(point(UP)), 1);
    expect(p.travelHeading).toBeNull();
  });

  it('a rotate command from another device beats the stick for the nose and switches the assistance off', () => {
    const p = ship(640, 360, 0);
    updatePlayer(p, { rotate: 1, move: 1, shoot: false, steer: assist(UP) }, FRAME);
    expect(p.rotation).toBeCloseTo(PLAYER_TURN_SPEED * FRAME, 9);
    expect(p.travelHeading).toBeNull();
  });

  it('mergeInputs keeps the touch stick request only while the keyboard / pad is not steering', () => {
    const touch: PlayerInput = { rotate: 0, move: 1, shoot: false, steer: point(UP) };
    expect(mergeInputs(NO_INPUT, touch).steer).toEqual(point(UP));
    expect(mergeInputs({ ...NO_INPUT, rotate: 1 }, touch).steer).toBeUndefined();
    expect(mergeInputs({ ...NO_INPUT, move: 1 }, touch).steer).toBeUndefined();
    // And no `steer` key at all when nobody asked, so the merged inputs of keyboard and gamepad players are what they always were.
    expect('steer' in mergeInputs(NO_INPUT, NO_INPUT)).toBe(false);
    expect('steer' in mergeInputs({ ...NO_INPUT, rotate: 1 }, touch)).toBe(false);
  });

  it('through readPlayerInputs: a held key beats the touch stick; with nothing held the stick drives Player 1', () => {
    const m = new TouchModel();
    m.setStickRadius(60);
    m.setStickStyle('point');
    m.press(1, 'stick', 100, 300);
    m.move(1, 100, 240);
    const none = { command: (): PlayerInput => ({ ...NO_INPUT }) };
    const schemes = keySchemesFor(1);
    const idle = new HeldKeys();
    expect(readPlayerInputs(idle, none, schemes, m)[0]?.steer?.heading).toBeCloseTo(UP, 9);
    const turning = new HeldKeys();
    turning.press('KeyA');
    expect(readPlayerInputs(turning, none, schemes, m)[0]?.steer).toBeUndefined();
  });

  it('respawning forgets the travel direction', () => {
    const p = ship();
    fly(p, stick(assist(UP)), 0.2);
    expect(p.travelHeading).not.toBeNull();
    respawnPlayer(p, 640, 360);
    expect(p.travelHeading).toBeNull();
  });
});

describe('Assisted Flight inside the real simulation', () => {
  it('does not make the ship safer: an asteroid on its path still costs a life, and a stick does not give invulnerability', () => {
    const sim = quietSim();
    const lives = sim.player.lives;
    const { x, y } = sim.player.position;
    sim.asteroids.push(rock(x + 60, y, 40));
    for (let i = 0; i < 40; i++) sim.step(FRAME, stick(assist(RIGHT)));
    expect(sim.player.lives).toBe(lives - 1);
  });

  it('still shoots from the nose: Assisted Flight can travel one way while facing and firing another', () => {
    const sim = quietSim();
    sim.player.rotation = DOWN;
    const events = sim.step(FRAME, stick(assist(RIGHT), { shoot: true }));
    expect(events.some((e) => e.type === 'shot_fired')).toBe(true);
    const shot = sim.shots[0]!;
    // The shot leaves along the nose, which has barely begun to turn toward RIGHT, while the ship itself is already travelling RIGHT.
    expect(apart(headingOf(shot.velocity), sim.player.rotation)).toBeLessThan(1e-6);
    expect(apart(sim.player.rotation, RIGHT)).toBeGreaterThan(80);
    expect(sim.player.position.x).toBeGreaterThan(640);
  });

  it('switching movement mode mid-run keeps the run: position, lives, score, weapons and power-ups survive, and the next frame is plain', () => {
    const sim = quietSim();
    for (let i = 0; i < 30; i++) sim.step(FRAME, stick(assist(UP)));
    sim.player.score = 1234;
    sim.player.rapidFire = { active: true, timer: 5 };
    sim.player.shieldActive = true;
    sim.player.laser.shotsRemaining = 2;
    const before = {
      position: { ...sim.player.position },
      rotation: sim.player.rotation,
      lives: sim.player.lives,
      score: sim.player.score,
      time: sim.time,
    };
    expect(sim.player.travelHeading).not.toBeNull();

    // The player pauses and picks another mode: the touch layer reports a neutral command until the next touch.
    sim.step(FRAME, NO_INPUT);
    expect(sim.player.travelHeading).toBeNull();
    expect(sim.player.position).toEqual(before.position);
    expect(sim.player.rotation).toBe(before.rotation);
    expect(sim.player.lives).toBe(before.lives);
    expect(sim.player.score).toBe(before.score);
    expect(sim.player.rapidFire.active).toBe(true);
    expect(sim.player.shieldActive).toBe(true);
    expect(sim.player.laser.shotsRemaining).toBe(2);
    expect(sim.time).toBeGreaterThan(before.time);
    expect(sim.isGameOver).toBe(false);
  });
});

describe('TouchControls: switching movement mode', () => {
  function rig() {
    const view = new FakeView();
    const host = new FakeHost();
    const doc = new FakeDoc();
    const touch = new TouchControls(view, host, doc);
    touch.setActive(true);
    touch.setLayer('play');
    const stickDown = (id: number, x: number, y: number): void => void view.elements.stick.dispatchEvent(pointer('pointerdown', id, x, y));
    const padDown = (id: number, x: number, y: number): void => void view.elements.dpad.dispatchEvent(pointer('pointerdown', id, x, y));
    const buttonDown = (control: 'fire' | 'laser' | 'boost', id: number): void => {
      const p = centre(LAYOUT[control]);
      view.elements[control].dispatchEvent(pointer('pointerdown', id, p.x, p.y));
    };
    const move = (id: number, x: number, y: number): void => void host.dispatchEvent(pointer('pointermove', id, x, y));
    return { view, host, doc, touch, stickDown, padDown, buttonDown, move };
  }

  it('each mode shows the right control and reads the thumb its own way', () => {
    const r = rig();
    r.touch.setMovement('classic');
    expect(r.view.steering).toBe('dpad');
    expect(r.touch.model.stickStyle).toBe('relative');
    r.touch.setMovement('pointToFly');
    expect(r.view.steering).toBe('joystick');
    expect(r.touch.model.stickStyle).toBe('point');
    r.touch.setMovement('assisted');
    expect(r.view.steering).toBe('joystick');
    expect(r.touch.model.stickStyle).toBe('assist');
  });

  it('Point-to-Fly and Assisted Flight use one joystick: the same element, radius and dead zone', () => {
    const results = (['pointToFly', 'assisted'] as const).map((mode) => {
      const r = rig();
      r.touch.setMovement(mode);
      r.stickDown(1, 200, 300);
      const inside = (() => {
        r.move(1, 200 + 5, 300);
        return r.touch.command().steer;
      })();
      r.move(1, 200, 300 - 50);
      return { inside, command: r.touch.command(), view: r.view.stick, radius: r.touch.model.stickRadius };
    });
    expect(results[0]?.inside).toBeUndefined();
    expect(results[1]?.inside).toBeUndefined();
    expect(results[0]?.command.steer?.heading).toBeCloseTo(results[1]?.command.steer?.heading ?? -1, 9);
    expect(results[0]?.view).toEqual(results[1]?.view);
    expect(results[0]?.radius).toBe(results[1]?.radius);
  });

  it('switching with fingers on the stick and every button lets go of all of it, and the commands are neutral', () => {
    for (const to of ['classic', 'pointToFly', 'assisted'] as const) {
      const r = rig();
      r.touch.setMovement('assisted');
      r.stickDown(1, 100, 300);
      r.move(1, 100 + 50, 300);
      r.buttonDown('fire', 2);
      r.buttonDown('laser', 3);
      r.buttonDown('boost', 4);
      expect(r.touch.command()).toMatchObject({ shoot: true, laser: true, boost: true, move: 1 });
      if (to === 'assisted') r.touch.setMovement('pointToFly'); // switching to a different mode
      else r.touch.setMovement(to);
      expect(r.touch.command()).toEqual(NO_INPUT);
      expect(r.touch.model.activePointers).toBe(0);
      // The fingers that are still down keep moving and do nothing: no stale thrust, no ghost FIRE.
      r.move(1, 100 + 60, 300 - 20);
      expect(r.touch.command()).toEqual(NO_INPUT);
    }
  });

  it('a mode change in the pause menu leaves the buttons unpressed: nothing is activated by it', () => {
    const r = rig();
    r.touch.setMovement('pointToFly');
    r.touch.setLayer('menu'); // paused: the model lets go of everything
    r.touch.setMovement('assisted');
    r.touch.setMovement('classic');
    r.touch.setMovement('pointToFly');
    r.touch.setLayer('play');
    expect(r.touch.command()).toEqual(NO_INPUT);
    for (const control of ['fire', 'laser', 'boost'] as const) expect(r.view.pressed[control]).toBeFalsy();
  });

  it('the D-pad (Classic) still produces plain rotate / move commands with no steer, exactly as before', () => {
    const r = rig();
    r.touch.setMovement('classic');
    r.padDown(1, 105, 275 - 60); // top of the pad: forward
    expect(r.touch.command()).toEqual({ ...NO_INPUT, move: 1 });
    expect(r.touch.command().steer).toBeUndefined();
  });

  it('lifting the stick ends the request; the next touch starts neutral', () => {
    const r = rig();
    r.touch.setMovement('assisted');
    r.stickDown(1, 100, 300);
    r.move(1, 150, 300);
    expect(r.touch.command().steer?.mode).toBe('assist');
    r.host.dispatchEvent(pointer('pointerup', 1, 150, 300));
    expect(r.touch.command()).toEqual(NO_INPUT);
    r.stickDown(2, 400, 200);
    expect(r.touch.command().steer).toBeUndefined();
  });

  it('losing focus, cancelling, or hiding the page leaves no stuck thrust', () => {
    for (const ending of ['blur', 'pointercancel', 'pagehide', 'hidden'] as const) {
      const r = rig();
      r.touch.setMovement('pointToFly');
      r.stickDown(1, 100, 300);
      r.move(1, 100, 240);
      expect(r.touch.command().move).toBe(1);
      if (ending === 'pointercancel') r.host.dispatchEvent(pointer('pointercancel', 1));
      else if (ending === 'hidden') {
        r.doc.hidden = true;
        r.doc.dispatchEvent(new Event('visibilitychange'));
      } else r.host.dispatchEvent(new Event(ending));
      expect(r.touch.command(), ending).toEqual(NO_INPUT);
    }
  });
});
