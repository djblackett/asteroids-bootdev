import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED, PLAYER_TURN_SPEED } from '../src/core/constants';
import type { GameSim } from '../src/core/game';
import { HeldKeys } from '../src/input/heldKeys';
import { readPlayerInput, SOLO_KEYS } from '../src/input/keyboardControls';
import { FRAME, quietSim } from './helpers';

/** A tiny stand-in for `window` that counts the listeners currently attached. */
class FakeWindow extends EventTarget {
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.listeners++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

class FakeDocument extends EventTarget {
  hidden = false;
}

function setup() {
  const win = new FakeWindow();
  const doc = new FakeDocument();
  const held = new HeldKeys();
  const detach = held.attach(win, doc);
  const send = (type: 'keydown' | 'keyup', code: string, repeat = false): void => {
    win.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
  };
  return {
    win,
    doc,
    held,
    detach,
    down: (...codes: string[]) => codes.forEach((c) => send('keydown', c)),
    up: (...codes: string[]) => codes.forEach((c) => send('keyup', c)),
    repeat: (code: string) => send('keydown', code, true),
  };
}

/** Runs `seconds` of simulation, polling the held keys every frame exactly as GameScene does. */
function play(sim: GameSim, held: HeldKeys, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) sim.step(FRAME, readPlayerInput(held, SOLO_KEYS));
}

const travelled = (sim: GameSim, from: { x: number; y: number }): number =>
  Math.hypot(sim.player.position.x - from.x, sim.player.position.y - from.y);

describe('mapping held keys to PlayerInput', () => {
  const cases: Array<[string, string[], Record<string, number | boolean>]> = [
    ['forward + left', ['KeyW', 'KeyA'], { move: 1, rotate: -1, shoot: false }],
    ['forward + right', ['KeyW', 'KeyD'], { move: 1, rotate: 1, shoot: false }],
    ['backward + left', ['KeyS', 'KeyA'], { move: -1, rotate: -1, shoot: false }],
    ['backward + right', ['KeyS', 'KeyD'], { move: -1, rotate: 1, shoot: false }],
    ['forward + left + shoot', ['KeyW', 'KeyA', 'Space'], { move: 1, rotate: -1, shoot: true }],
    ['forward + right + shoot', ['KeyW', 'KeyD', 'Space'], { move: 1, rotate: 1, shoot: true }],
    ['backward + left + shoot', ['KeyS', 'KeyA', 'Space'], { move: -1, rotate: -1, shoot: true }],
    ['backward + right + shoot', ['KeyS', 'KeyD', 'Space'], { move: -1, rotate: 1, shoot: true }],
    ['turn + shoot only', ['KeyD', 'Space'], { move: 0, rotate: 1, shoot: true }],
    ['arrow keys behave like WASD', ['ArrowDown', 'ArrowLeft', 'Space'], { move: -1, rotate: -1, shoot: true }],
    ['movement + laser', ['KeyW', 'KeyD', 'KeyE'], { move: 1, rotate: 1, laser: true }],
    ['movement + boost (left shift)', ['KeyW', 'KeyD', 'ShiftLeft'], { move: 1, rotate: 1, boost: true }],
    ['movement + boost (right shift)', ['KeyS', 'KeyA', 'ShiftRight'], { move: -1, rotate: -1, boost: true }],
    [
      'everything at once',
      ['KeyW', 'KeyA', 'Space', 'KeyE', 'ShiftLeft'],
      { move: 1, rotate: -1, shoot: true, laser: true, boost: true },
    ],
  ];

  it.each(cases)('%s', (_name, keys, expected) => {
    const { held, down } = setup();
    down(...keys);
    expect(readPlayerInput(held)).toMatchObject(expected);
  });

  it('opposing keys resolve like Python (the later check, D / S, wins) without affecting unrelated controls', () => {
    const { held, down } = setup();
    down('KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space');
    expect(readPlayerInput(held)).toMatchObject({ rotate: 1, move: -1, shoot: true });
  });

  it('does not depend on the order the keys went down', () => {
    for (const order of [
      ['KeyW', 'KeyA', 'Space'],
      ['Space', 'KeyA', 'KeyW'],
      ['KeyA', 'Space', 'KeyW'],
    ]) {
      const { held, down } = setup();
      down(...order);
      expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: -1, shoot: true });
    }
  });
});

describe('simultaneous keys drive the simulation', () => {
  const start = { x: 640, y: 360 };
  const movePlusTurn = [
    ['KeyW', 'KeyA'],
    ['KeyW', 'KeyD'],
    ['KeyS', 'KeyA'],
    ['KeyS', 'KeyD'],
  ] as const;

  it.each(movePlusTurn)('%s + %s: the ship turns AND moves', (move, turn) => {
    const sim = quietSim();
    const { held, down } = setup();
    down(move, turn);
    play(sim, held, 0.3);
    const turned = turn === 'KeyD' ? sim.player.rotation : 360 - sim.player.rotation;
    expect(turned).toBeCloseTo(PLAYER_TURN_SPEED * 0.3, 0);
    expect(travelled(sim, start)).toBeGreaterThan(PLAYER_SPEED * 0.3 * 0.6);
  });

  it.each(movePlusTurn)('%s + %s + Space: the ship turns, moves AND fires', (move, turn) => {
    const sim = quietSim();
    const { held, down } = setup();
    down(move, turn, 'Space');
    play(sim, held, 0.7);
    expect(sim.player.rotation).not.toBe(0);
    expect(travelled(sim, start)).toBeGreaterThan(50);
    expect(sim.shots.length).toBeGreaterThanOrEqual(2); // 0.3 s cooldown: shots at 0, 0.3 and 0.6 s
  });

  it('forward + turn + shoot keeps firing for seconds, not just once', () => {
    const sim = quietSim();
    const { held, down } = setup();
    down('KeyW', 'KeyD', 'Space');
    let fired = 0;
    for (let i = 0; i < 180; i++) {
      const events = sim.step(FRAME, readPlayerInput(held));
      if (events.some((e) => e.type === 'shot_fired')) fired++;
      sim.player.position = { x: 640, y: 360 }; // stay clear of the wall so only input is under test
    }
    expect(fired).toBeGreaterThanOrEqual(9); // 3 s / 0.3 s cooldown
  });

  it('movement + laser: the beam fires while the ship keeps turning and moving', () => {
    const sim = quietSim();
    const { held, down } = setup();
    down('KeyW', 'KeyD', 'KeyE');
    play(sim, held, 0.15); // a beam lives 0.3 s
    expect(sim.lasers.length).toBe(1);
    expect(sim.player.laser.shotsRemaining).toBe(14);
    expect(sim.player.rotation).toBeGreaterThan(30);
    expect(travelled(sim, start)).toBeGreaterThan(20);
  });

  it('movement + boost: boosting is faster, and turning continues', () => {
    const plain = quietSim();
    const boosted = quietSim();
    const a = setup();
    const b = setup();
    a.down('KeyW', 'KeyD');
    b.down('KeyW', 'KeyD', 'ShiftLeft');
    play(plain, a.held, 0.4);
    play(boosted, b.held, 0.4);
    expect(boosted.player.boost.active).toBe(true);
    expect(boosted.player.rotation).toBeCloseTo(plain.player.rotation, 0);
    expect(travelled(boosted, start)).toBeGreaterThan(travelled(plain, start) * 1.3);
  });

  it('boost disables the cannon even with Space held (the Python rule) without disturbing movement', () => {
    const sim = quietSim();
    const { held, down } = setup();
    down('KeyW', 'KeyA', 'ShiftLeft', 'Space');
    sim.step(FRAME, readPlayerInput(held)); // boost starts after the cannon check in the same frame, as in Python
    const fired: string[] = [];
    for (let i = 0; i < 30; i++) sim.step(FRAME, readPlayerInput(held)).forEach((e) => fired.push(e.type));
    expect(sim.player.boost.active).toBe(true);
    expect(fired).not.toContain('shot_fired');
    expect(travelled(sim, start)).toBeGreaterThan(100);
  });

  it('releasing one key leaves the others working', () => {
    const sim = quietSim();
    const { held, down, up } = setup();
    down('KeyW', 'KeyD', 'Space');
    play(sim, held, 0.2);
    up('KeyD');
    const rotation = sim.player.rotation;
    const at = { ...sim.player.position };
    const fired = (): number => sim.shots.length;
    const shotsBefore = fired();
    play(sim, held, 0.4);
    expect(sim.player.rotation).toBeCloseTo(rotation, 5); // turning stopped...
    expect(travelled(sim, at)).toBeGreaterThan(PLAYER_SPEED * 0.4 * 0.8); // ...moving continues...
    expect(fired()).toBeGreaterThan(shotsBefore); // ...and so does shooting
    up('Space');
    const stopped = { ...sim.player.position };
    const events: string[] = [];
    for (let i = 0; i < 24; i++) sim.step(FRAME, readPlayerInput(held)).forEach((e) => events.push(e.type));
    expect(events).not.toContain('shot_fired');
    expect(travelled(sim, stopped)).toBeGreaterThan(PLAYER_SPEED * 0.4 * 0.8); // W still held
  });

  it('a laser key that is already held does not fire until it is released and pressed again', () => {
    const sim = quietSim();
    const { held, down, up } = setup();
    down('KeyE');
    sim.player.laser.keyHeld = true; // what GameScene.ignoreHeldAbilityKeys does at the start of a run / on resume
    play(sim, held, 0.2);
    expect(sim.lasers.length).toBe(0);
    up('KeyE');
    play(sim, held, 0.05);
    down('KeyE');
    play(sim, held, 0.05);
    expect(sim.lasers.length).toBe(1);
  });
});

describe('HeldKeys reliability', () => {
  it('ignores browser auto-repeat: one release is enough', () => {
    const { held, down, up, repeat } = setup();
    down('KeyW');
    for (let i = 0; i < 25; i++) repeat('KeyW');
    expect(held.isDown('KeyW')).toBe(true);
    up('KeyW');
    expect(held.isDown('KeyW')).toBe(false);
  });

  it('auto-repeat of one key never disturbs the others', () => {
    const { held, down, repeat } = setup();
    down('KeyW', 'KeyD', 'Space');
    for (let i = 0; i < 10; i++) repeat('Space');
    expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: 1, shoot: true });
  });

  it('survives a pause: nothing but real key events changes what is held', () => {
    const sim = quietSim();
    const { held, down, up } = setup();
    down('KeyW', 'KeyD');
    play(sim, held, 0.1);
    // The player pauses and resumes: GameScene stops calling sim.step and never touches the held keys.
    expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: 1 });
    play(sim, held, 0.1);
    up('KeyW', 'KeyD');
    expect(readPlayerInput(held)).toMatchObject({ move: 0, rotate: 0 });
  });

  it('a key released while paused stays released after resuming', () => {
    const { held, down, up } = setup();
    down('KeyW', 'KeyD');
    up('KeyD'); // released during the pause
    expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: 0 });
  });

  it('forgets every key on window blur and recovers when a still-held key repeats', () => {
    const { held, win, down, repeat } = setup();
    down('KeyW', 'KeyD', 'Space');
    win.dispatchEvent(new Event('blur'));
    expect(held.snapshot().size).toBe(0);
    repeat('KeyW'); // the key really is still down: the OS keeps repeating it after focus returns
    expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: 0, shoot: false });
    down('KeyD');
    expect(readPlayerInput(held)).toMatchObject({ move: 1, rotate: 1 });
  });

  it('forgets every key when the tab is hidden, but not when it becomes visible', () => {
    const { held, doc, down } = setup();
    down('KeyW');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(held.snapshot().size).toBe(0);
    doc.hidden = false;
    down('KeyA');
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(held.isDown('KeyA')).toBe(true);
  });

  it('releasing Cmd forgets keys whose keyup macOS swallowed', () => {
    const { held, down, up } = setup();
    down('MetaLeft', 'KeyW');
    up('MetaLeft');
    expect(held.snapshot().size).toBe(0);
  });

  it('a release for a key that was never pressed is harmless', () => {
    const { held, down, up } = setup();
    down('KeyW');
    up('KeyZ');
    expect(held.isDown('KeyW')).toBe(true);
  });

  it('adds only its own listeners and removes them all on detach (game destroy / hot reload)', () => {
    const win = new FakeWindow();
    const doc = new FakeDocument();
    const held = new HeldKeys();
    for (let round = 0; round < 5; round++) {
      const detach = held.attach(win, doc);
      expect(win.listeners).toBe(3);
      detach();
      expect(win.listeners).toBe(0);
    }
    held.attach(win, doc)();
    win.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
    expect(held.isDown('KeyW')).toBe(false);
  });

  it('is unaffected when an event object is delivered twice (Phaser 4.2.1 replays its queue)', () => {
    const { held, win } = setup();
    const event = Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false });
    win.dispatchEvent(event);
    win.dispatchEvent(event);
    win.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
    expect(held.isDown('KeyW')).toBe(false);
  });
});
