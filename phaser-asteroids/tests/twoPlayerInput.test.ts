import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import { NO_INPUT } from '../src/core/player';
import { HeldKeys } from '../src/input/heldKeys';
import {
  keySchemesFor,
  P1_KEYS,
  P2_KEYS_ARROWS,
  P2_KEYS_IJKL,
  readPlayerInput,
  schemeCodes,
  SOLO_KEYS,
  type KeyScheme,
} from '../src/input/keyboardControls';
import { FRAME, eventsOfType, quietCoop } from './helpers';

/** Phase 4 / Milestone 3: two players on one keyboard. */

const press = (...codes: string[]): HeldKeys => {
  const held = new HeldKeys();
  for (const c of codes) held.press(c);
  return held;
};

const LAYOUTS: Array<[string, KeyScheme]> = [
  ['arrows', P2_KEYS_ARROWS],
  ['ijkl', P2_KEYS_IJKL],
];

/** Keys the page or browser uses itself; a game key here would double up or be dangerous. */
const RESERVED = ['KeyP', 'KeyM', 'KeyR', 'Escape', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab', 'F5', 'F11', 'F12'];

describe('key schemes', () => {
  it.each(LAYOUTS)('Player 1 and Player 2 (%s) share no key', (_name, p2) => {
    const p1Codes = new Set(schemeCodes(P1_KEYS));
    for (const code of schemeCodes(p2)) expect(p1Codes.has(code), code).toBe(false);
  });

  it.each(LAYOUTS)('no game key is a pause / mute / retry / menu key or a modifier that triggers browser shortcuts (%s)', (_name, p2) => {
    for (const code of [...schemeCodes(P1_KEYS), ...schemeCodes(p2)]) expect(RESERVED, code).not.toContain(code);
  });

  it('Python mappings are kept where practical: WASD + Space + E + Left Shift; arrows + Enter + Right Shift', () => {
    expect(P1_KEYS).toEqual({
      rotateLeft: ['KeyA'],
      rotateRight: ['KeyD'],
      forward: ['KeyW'],
      backward: ['KeyS'],
      shoot: ['Space'],
      laser: ['KeyE'],
      boost: ['ShiftLeft'],
    });
    expect(P2_KEYS_ARROWS.rotateLeft).toEqual(['ArrowLeft']);
    expect(P2_KEYS_ARROWS.forward).toEqual(['ArrowUp']);
    expect(P2_KEYS_ARROWS.shoot).toContain('Enter');
    expect(P2_KEYS_ARROWS.laser).toEqual(['ShiftRight']);
  });

  it("Player 2's boost is not Right Ctrl (Ctrl + W would close the browser tab while Player 1 holds W)", () => {
    expect(P2_KEYS_ARROWS.boost).not.toContain('ControlRight');
    expect(P2_KEYS_ARROWS.boost).toEqual(['Period']);
  });

  it('the one-player scheme still accepts WASD or arrows and either Shift', () => {
    expect(readPlayerInput(press('ArrowUp', 'ArrowLeft', 'ShiftRight'), SOLO_KEYS)).toMatchObject({ move: 1, rotate: -1, boost: true });
    expect(readPlayerInput(press('KeyW', 'KeyD', 'ShiftLeft'), SOLO_KEYS)).toMatchObject({ move: 1, rotate: 1, boost: true });
  });

  it('keySchemesFor: one scheme for one player, two for two (with the chosen Player 2 layout)', () => {
    expect(keySchemesFor(1)).toEqual([SOLO_KEYS]);
    expect(keySchemesFor(2, 'arrows')).toEqual([P1_KEYS, P2_KEYS_ARROWS]);
    expect(keySchemesFor(2, 'ijkl')).toEqual([P1_KEYS, P2_KEYS_IJKL]);
  });
});

describe('one player\'s keys never drive the other', () => {
  it.each(LAYOUTS)('every Player 1 key leaves Player 2 (%s) idle and vice versa', (_name, p2Scheme) => {
    for (const code of schemeCodes(P1_KEYS)) {
      expect(readPlayerInput(press(code), p2Scheme), code).toEqual(NO_INPUT);
      expect(readPlayerInput(press(code), P1_KEYS), code).not.toEqual(NO_INPUT);
    }
    for (const code of schemeCodes(p2Scheme)) {
      expect(readPlayerInput(press(code), P1_KEYS), code).toEqual(NO_INPUT);
      expect(readPlayerInput(press(code), p2Scheme), code).not.toEqual(NO_INPUT);
    }
  });

  it('the arrow keys do nothing for Player 1 in a two-player game', () => {
    expect(readPlayerInput(press('ArrowUp', 'ArrowLeft', 'Enter', 'ShiftRight'), P1_KEYS)).toEqual(NO_INPUT);
  });

  it('opposite keys on one ship resolve as in Python (D and S win), independently per ship', () => {
    const held = press('KeyA', 'KeyD', 'ArrowUp', 'ArrowDown');
    expect(readPlayerInput(held, P1_KEYS)).toMatchObject({ rotate: 1, move: 0 });
    expect(readPlayerInput(held, P2_KEYS_ARROWS)).toMatchObject({ rotate: 0, move: -1 });
  });
});

describe('both players at once', () => {
  it.each(LAYOUTS)('all controls of both ships held together all arrive (%s)', (_name, p2) => {
    const all = press(...schemeCodes(P1_KEYS).filter((c) => c !== 'KeyS' && c !== 'KeyA'), ...schemeCodes(p2).filter((c) => !['NumpadEnter'].includes(c)));
    const a = readPlayerInput(all, P1_KEYS);
    const b = readPlayerInput(all, p2);
    expect(a).toEqual({ rotate: 1, move: 1, shoot: true, laser: true, boost: true });
    expect(b).toMatchObject({ shoot: true, laser: true, boost: true });
  });

  it('realistic hand positions: P1 W+D+Space+E, P2 Up+Left+Enter+RightShift', () => {
    const held = press('KeyW', 'KeyD', 'Space', 'KeyE', 'ArrowUp', 'ArrowLeft', 'Enter', 'ShiftRight');
    expect(readPlayerInput(held, P1_KEYS)).toEqual({ rotate: 1, move: 1, shoot: true, laser: true, boost: false });
    expect(readPlayerInput(held, P2_KEYS_ARROWS)).toEqual({ rotate: -1, move: 1, shoot: true, laser: true, boost: false });
  });

  it('releasing one player\'s keys leaves the other player\'s untouched', () => {
    const held = press('KeyW', 'Space', 'ArrowUp', 'Enter');
    held.release('KeyW');
    held.release('Space');
    expect(readPlayerInput(held, P1_KEYS)).toEqual(NO_INPUT);
    expect(readPlayerInput(held, P2_KEYS_ARROWS)).toMatchObject({ move: 1, shoot: true });
  });

  it('window blur clears every key of both players, so nothing sticks', () => {
    const held = new HeldKeys();
    const target = new EventTarget();
    held.attach(target);
    for (const code of ['KeyW', 'Space', 'ArrowUp', 'Enter']) target.dispatchEvent(Object.assign(new Event('keydown'), { code }));
    expect(readPlayerInput(held, P2_KEYS_ARROWS).move).toBe(1);
    target.dispatchEvent(new Event('blur'));
    expect(readPlayerInput(held, P1_KEYS)).toEqual(NO_INPUT);
    expect(readPlayerInput(held, P2_KEYS_ARROWS)).toEqual(NO_INPUT);
  });

  it('driving two ships from one key set: both move, turn and shoot independently for a second', () => {
    const sim = quietCoop();
    const held = press('KeyW', 'KeyD', 'Space', 'ArrowDown', 'ArrowLeft', 'Enter');
    const events = [];
    for (let i = 0; i < 60; i++) events.push(...sim.step(FRAME, readPlayerInput(held, P1_KEYS), readPlayerInput(held, P2_KEYS_ARROWS)));
    const shots = eventsOfType(events, 'shot_fired');
    expect(shots.filter((e) => e.player === 1).length).toBeGreaterThanOrEqual(3);
    expect(shots.filter((e) => e.player === 2).length).toBeGreaterThanOrEqual(3);
    expect(sim.player.rotation).toBeCloseTo(300, 0); // turned right for 1 s at 300 deg/s
    expect(sim.player2?.rotation).toBeCloseTo(60, 0); // turned left for 1 s: -300 deg = 60
    expect(Math.abs((sim.player.position.x - 320) + (sim.player.position.y - 360))).toBeGreaterThan(10);
    expect(sim.player2?.position.y).not.toBe(360);
  });

  it('an ability key held across a death or pause does not fire afterwards (one activation per press)', () => {
    const sim = new GameSim({ startCooldown: 0, ufos: false, config: { playerCount: 2 } });
    sim.spawner.spawnTimer = -1e9;
    // The scene marks held ability keys as used when play (re)starts, exactly like this:
    const held = press('KeyE', 'ShiftLeft', 'ShiftRight', 'Period');
    sim.player.laser.keyHeld = !!readPlayerInput(held, P1_KEYS).laser;
    sim.player.boost.keyHeld = !!readPlayerInput(held, P1_KEYS).boost;
    if (sim.player2) {
      sim.player2.laser.keyHeld = !!readPlayerInput(held, P2_KEYS_ARROWS).laser;
      sim.player2.boost.keyHeld = !!readPlayerInput(held, P2_KEYS_ARROWS).boost;
    }
    const events = sim.step(FRAME, readPlayerInput(held, P1_KEYS), readPlayerInput(held, P2_KEYS_ARROWS));
    expect(eventsOfType(events, 'laser_fired')).toHaveLength(0);
    expect(eventsOfType(events, 'boost_started')).toHaveLength(0);
  });
});
