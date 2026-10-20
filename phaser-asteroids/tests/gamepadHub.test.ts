import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import { browserGamepadReader, EVENT_LOG_MAX, type PadEvent } from '../src/input/gamepadHub';
import { B, makeHub, OTHER_ID, padSnap, plugIn, XBOX_ID, type HubRig, type PadSpec } from './padFakes';

/** The hub with synthetic snapshots: connection, arming, presses, assignment, focus and disconnect. No hardware needed. */

const set = (rig: HubRig, spec: PadSpec, index = 0): void => {
  rig.pads.set(spec, index);
  rig.hub.poll();
};

describe('connection', () => {
  it('starts with no controller and says so', () => {
    const rig = makeHub();
    rig.hub.poll();
    expect(rig.hub.pads()).toEqual([]);
    expect(rig.hub.status(2)).toMatchObject([{ kind: 'none' }]);
    expect(rig.hub.status(2)[0]?.text).toMatch(/No controller detected/);
  });

  it('detects a controller present before the page loaded (first poll) or plugged in later', () => {
    const rig = makeHub();
    rig.pads.set({}, 0);
    rig.hub.poll();
    expect(rig.hub.pads()).toHaveLength(1);
    rig.pads.set({ id: OTHER_ID }, 1);
    rig.hub.poll();
    expect(rig.hub.pads().map((p) => p.index)).toEqual([0, 1]);
  });

  it('a new controller is "detected but not assigned" and drives nobody', () => {
    const rig = makeHub();
    plugIn(rig);
    expect(rig.hub.status(2)[0]).toMatchObject({ kind: 'unassigned', slot: null });
    set(rig, { axes: { 0: 1 }, buttons: { [B.RT]: 1 } });
    expect(rig.hub.command(0, 2)).toEqual(NO_INPUT);
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
  });

  it('ignores a snapshot that says connected: false, and a getGamepads() that throws', () => {
    const rig = makeHub();
    rig.pads.set({ connected: false }, 0);
    rig.hub.poll();
    expect(rig.hub.pads()).toEqual([]);
    rig.pads.throwNext = true;
    rig.hub.poll();
    expect(rig.hub.isSupported).toBe(false);
    expect(rig.hub.status(1)[0]?.text).toMatch(/unavailable/);
    rig.pads.throwNext = false;
    rig.hub.poll();
    expect(rig.hub.isSupported).toBe(true);
  });

  it('reads at most four controllers', () => {
    const rig = makeHub();
    for (let i = 0; i < 4; i++) rig.pads.set({ id: `pad ${i}` }, i);
    rig.pads.slots.push(padSnap({ index: 4, id: 'pad 4' }));
    rig.hub.poll();
    expect(rig.hub.pads()).toHaveLength(4);
  });

  it('the browser reader copies the live Gamepad objects and tolerates a missing API', () => {
    const live = { index: 2, id: 'x', mapping: 'standard', connected: true, axes: [0.1, 0.2], buttons: [{ pressed: true, value: 1 }] } as unknown as Gamepad;
    const read = browserGamepadReader({ getGamepads: () => [null, null, live, null] });
    const snaps = read();
    expect(snaps[2]).toEqual({ index: 2, id: 'x', mapping: 'standard', connected: true, axes: [0.1, 0.2], buttons: [{ pressed: true, value: 1 }] });
    expect(snaps[0]).toBeNull();
    expect(() => browserGamepadReader(undefined)()).toThrow(/unavailable/);
    expect(() => browserGamepadReader({} as Navigator)()).toThrow(/unavailable/);
  });
});

describe('arming: a pad is only trusted after it was seen with every button released', () => {
  it('the press that woke the controller does not shoot; releasing it arms the pad', () => {
    const rig = makeHub();
    set(rig, { buttons: { [B.A]: true } });
    const key = rig.hub.pads()[0]?.key as number;
    rig.hub.assign(key, 1, 2);
    expect(rig.hub.pads()[0]?.armed).toBe(false);
    expect(rig.hub.command(1, 2).shoot).toBe(false);
    set(rig, { buttons: { [B.A]: true } });
    expect(rig.hub.command(1, 2).shoot).toBe(false);
    set(rig, {});
    expect(rig.hub.pads()[0]?.armed).toBe(true);
    set(rig, { buttons: { [B.A]: true } });
    expect(rig.hub.command(1, 2).shoot).toBe(true);
  });

  it('a stick pushed over while the pad is disarmed is ignored until all buttons are up (sticks do not block arming)', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { buttons: { [B.RT]: 1 } });
    rig.hub.disarmAll('test');
    set(rig, { buttons: { [B.RT]: 1 }, axes: { 0: 1 } });
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
    set(rig, { axes: { 0: 1 } });
    expect(rig.hub.command(1, 2).rotate).toBe(1);
  });

  it('an unused button (LT) still keeps the pad disarmed while held', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 0, 1);
    rig.hub.disarmAll('test');
    set(rig, { buttons: { [B.LT]: 0.6 } });
    expect(rig.hub.pads()[0]?.armed).toBe(false);
  });
});

describe('button presses (menus, pause, retry)', () => {
  it('a press is queued once per physical press, however long the button is held', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    for (let i = 0; i < 10; i++) set(rig, { buttons: { [B.START]: true } });
    expect(rig.hub.drainPresses()).toEqual([{ padKey: key, button: 'start' }]);
    set(rig, {});
    set(rig, { buttons: { [B.START]: true } });
    expect(rig.hub.drainPresses()).toEqual([{ padKey: key, button: 'start' }]);
  });

  it('a button already down when the pad connects is not a press', () => {
    const rig = makeHub();
    set(rig, { buttons: { [B.A]: true } });
    expect(rig.hub.drainPresses()).toEqual([]);
  });

  it('presses are queued in order, and drained presses are gone', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    set(rig, { buttons: { [B.LB]: true, [B.Y]: true } });
    expect(rig.hub.drainPresses().map((p) => p.button)).toEqual(['y', 'lb']);
    expect(rig.hub.drainPresses()).toEqual([]);
    set(rig, { buttons: { [B.RT]: 1 } });
    expect(rig.hub.drainPresses()).toEqual([{ padKey: key, button: 'trigger' }]);
  });

  it('discardPresses and a focus loss forget queued presses', () => {
    const rig = makeHub();
    plugIn(rig);
    set(rig, { buttons: { [B.A]: true } });
    rig.hub.discardPresses();
    expect(rig.hub.drainPresses()).toEqual([]);
    set(rig, {});
    set(rig, { buttons: { [B.A]: true } });
    rig.hub.disarmAll('blur');
    expect(rig.hub.drainPresses()).toEqual([]);
  });

  it('a button held through a focus loss is not reported as a new press when focus returns', () => {
    const rig = makeHub();
    plugIn(rig);
    set(rig, { buttons: { [B.START]: true } });
    rig.hub.drainPresses();
    rig.hub.disarmAll('window lost focus');
    set(rig, { buttons: { [B.START]: true } });
    expect(rig.hub.drainPresses()).toEqual([]);
  });

  it('the queue is bounded', () => {
    const rig = makeHub();
    plugIn(rig);
    for (let i = 0; i < 200; i++) {
      set(rig, { buttons: { [B.A]: true } });
      set(rig, {});
    }
    expect(rig.hub.drainPresses().length).toBeLessThanOrEqual(64);
  });
});

describe('assignment', () => {
  it('"join" puts the first pad on Player 2 in a two-player game (keyboard stays Player 1) and on Player 1 in a one-player game', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    expect(rig.hub.join(key, 2)).toBe(1);
    expect(rig.hub.padFor(1, 2)?.key).toBe(key);
    expect(rig.hub.padFor(0, 2)).toBeNull();

    const solo = makeHub();
    const soloKey = plugIn(solo);
    expect(solo.hub.join(soloKey, 1)).toBe(0);
    expect(solo.hub.padFor(0, 1)?.key).toBe(soloKey);
  });

  it('a second pad takes Player 1; a third gets nothing; no pad ever drives two players', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1, { id: OTHER_ID });
    const c = plugIn(rig, 2, { id: 'third' });
    expect(rig.hub.join(a, 2)).toBe(1);
    expect(rig.hub.join(b, 2)).toBe(0);
    expect(rig.hub.join(c, 2)).toBeNull();
    expect(rig.hub.padFor(0, 2)?.key).toBe(b);
    expect(rig.hub.padFor(1, 2)?.key).toBe(a);
    expect(rig.hub.playerOf(c, 2)).toBeNull();
  });

  it('assigning a pad to a player moves it (it can only drive one) and unassigns whoever had that player', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1, { id: OTHER_ID });
    rig.hub.assign(a, 1, 2);
    rig.hub.assign(a, 0, 2);
    expect(rig.hub.padFor(1, 2)).toBeNull();
    expect(rig.hub.padFor(0, 2)?.key).toBe(a);
    rig.hub.assign(b, 0, 2);
    expect(rig.hub.padFor(0, 2)?.key).toBe(b);
    expect(rig.hub.playerOf(a, 2)).toBeNull();
    expect(rig.hub.status(2).map((s) => s.kind)).toEqual(['unassigned', 'assigned']);
  });

  it('two controllers drive two players independently and never each other\'s ship', () => {
    const rig = makeHub();
    rig.hub.assign(plugIn(rig, 0), 0, 2);
    rig.hub.assign(plugIn(rig, 1, { id: OTHER_ID }), 1, 2);
    rig.pads.set({ axes: { 0: 1 }, buttons: { [B.RT]: 1 } }, 0);
    rig.pads.set({ id: OTHER_ID, axes: { 1: -1 }, buttons: { [B.X]: true } }, 1);
    rig.hub.poll();
    expect(rig.hub.command(0, 2)).toEqual({ rotate: 1, move: 0, shoot: true, laser: false, boost: false });
    expect(rig.hub.command(1, 2)).toEqual({ rotate: 0, move: 1, shoot: false, laser: true, boost: false });
  });

  it('"cycle" steps Player 2 -> Player 1 -> none in a two-player game, Player 1 -> none in a one-player game', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    const seen: Array<number | null> = [];
    for (let i = 0; i < 4; i++) {
      rig.hub.cycle(key, 2);
      seen.push(rig.hub.playerOf(key, 2));
    }
    expect(seen).toEqual([1, 0, null, 1]);
    rig.hub.assign(key, null, 2);
    const solo: Array<number | null> = [];
    for (let i = 0; i < 3; i++) {
      rig.hub.cycle(key, 1);
      solo.push(rig.hub.playerOf(key, 1));
    }
    expect(solo).toEqual([0, null, 0]);
  });

  it('switching between one and two players keeps a sensible owner: a Player 2 pad drives the single ship in a one-player game', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    rig.hub.poll();
    expect(rig.hub.padFor(0, 1)?.key).toBe(key);
    expect(rig.hub.padFor(1, 1)).toBeNull();
    set(rig, { axes: { 0: 0.5 } });
    expect(rig.hub.command(0, 1).rotate).toBe(0.5);
    expect(rig.hub.command(1, 1)).toEqual(NO_INPUT);
    expect(rig.hub.command(1, 2).rotate).toBe(0.5);
    expect(rig.hub.command(0, 2)).toEqual(NO_INPUT);
  });

  it('in a one-player game, assigning to "Player 2" lands on Player 1, and a second pad cannot also drive the single ship', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1, { id: OTHER_ID });
    rig.hub.assign(a, 1, 1);
    expect(rig.hub.playerOf(a, 1)).toBe(0);
    expect(rig.hub.join(b, 1)).toBeNull();
    expect(rig.hub.status(1).map((s) => s.kind)).toEqual(['assigned', 'unassigned']);
  });

  it('assigning a pad that is not connected does nothing', () => {
    const rig = makeHub();
    rig.hub.assign(999, 0, 2);
    expect(rig.hub.padFor(0, 2)).toBeNull();
  });
});

describe('disconnect and reconnect', () => {
  const driven = (rig: HubRig) => {
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { axes: { 0: 1, 1: -1 }, buttons: { [B.RT]: 1, [B.B]: true } });
    return key;
  };

  it('unplugging mid-action returns that player to neutral on the very next poll: nothing stays held', () => {
    const rig = makeHub();
    driven(rig);
    expect(rig.hub.command(1, 2)).toEqual({ rotate: 1, move: 1, shoot: true, laser: false, boost: true });
    rig.pads.set(null, 0);
    rig.hub.poll();
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
    expect(rig.hub.padFor(1, 2)).toBeNull();
  });

  it('also treats connected: false as gone', () => {
    const rig = makeHub();
    driven(rig);
    rig.pads.set({ connected: false, axes: { 0: 1 } }, 0);
    rig.hub.poll();
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
  });

  it('keeps a reservation but never claims the controller is available: status says DISCONNECTED', () => {
    const rig = makeHub();
    driven(rig);
    rig.pads.set(null, 0);
    rig.hub.poll();
    const lines = rig.hub.status(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'disconnected', slot: 1 });
    expect(lines[0]?.text).toMatch(/PLAYER 2.*DISCONNECTED/);
    expect(rig.hub.pads()).toEqual([]);
  });

  it('a pad with the same name reconnecting takes Player 2 back, but must be released before it fires (armed again)', () => {
    const rig = makeHub();
    driven(rig);
    rig.pads.set(null, 0);
    rig.hub.poll();
    set(rig, { buttons: { [B.A]: true } }, 2); // it comes back on another index, A still down from the wake-up press
    expect(rig.hub.padFor(1, 2)?.index).toBe(2);
    expect(rig.hub.status(2)[0]).toMatchObject({ kind: 'assigned', slot: 1 });
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
    set(rig, {}, 2);
    set(rig, { buttons: { [B.RT]: 1 } }, 2);
    expect(rig.hub.command(1, 2).shoot).toBe(true);
  });

  it('a different controller does not inherit the reservation, and may take the free player', () => {
    const rig = makeHub();
    driven(rig);
    rig.pads.set(null, 0);
    rig.hub.poll();
    const other = plugIn(rig, 1, { id: OTHER_ID });
    expect(rig.hub.padFor(1, 2)).toBeNull();
    expect(rig.hub.join(other, 2)).toBe(1);
    expect(rig.hub.status(2).map((s) => s.kind)).toEqual(['assigned']);
    // ...and the first pad coming back no longer reclaims Player 2.
    set(rig, {}, 0);
    expect(rig.hub.padFor(1, 2)?.key).toBe(other);
    expect(rig.hub.status(2).find((s) => s.text.includes('Xbox'))?.kind).toBe('unassigned');
  });

  it('an unassigned pad that was unplugged and returns stays unassigned (no stale claim)', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    rig.hub.assign(key, null, 2);
    rig.pads.set(null, 0);
    rig.hub.poll();
    set(rig, {});
    expect(rig.hub.padFor(1, 2)).toBeNull();
    expect(rig.hub.status(2)[0]).toMatchObject({ kind: 'unassigned' });
  });

  it('two identical controllers: the one that returns goes back to the player that had its index', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1);
    rig.hub.assign(a, 0, 2);
    rig.hub.assign(b, 1, 2);
    rig.pads.set(null, 1);
    rig.hub.poll();
    set(rig, {}, 1);
    expect(rig.hub.padFor(1, 2)?.index).toBe(1);
    expect(rig.hub.padFor(0, 2)?.index).toBe(0);
  });

  it('a different device appearing on the same index between two polls is a new controller', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { id: OTHER_ID });
    expect(rig.hub.padFor(1, 2)).toBeNull();
    expect(rig.hub.pads()[0]?.key).not.toBe(key);
  });

  it('emits connected / disconnected events with the player affected, once each', () => {
    const rig = makeHub();
    const events: PadEvent[] = [];
    rig.hub.onEvent((e) => events.push(e));
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    rig.pads.set(null, 0);
    rig.hub.poll();
    rig.hub.poll();
    expect(events.map((e) => e.type)).toEqual(['connected', 'assigned', 'disconnected']);
    const gone = events[2] as Extract<PadEvent, { type: 'disconnected' }>;
    expect(gone.slot).toBe(1);
    expect(gone.soloSlot).toBe(0);
  });
});

describe('focus, visibility and restarts', () => {
  it('losing focus makes an assigned pad neutral at once, keeps the assignment, and it resumes only after a release', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { axes: { 0: 1 }, buttons: { [B.RT]: 1 } });
    expect(rig.hub.command(1, 2).shoot).toBe(true);
    rig.hub.disarmAll('window lost focus');
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
    expect(rig.hub.playerOf(key, 2)).toBe(1);
    set(rig, { axes: { 0: 1 }, buttons: { [B.RT]: 1 } }); // still held when focus returns: not trusted
    expect(rig.hub.command(1, 2)).toEqual(NO_INPUT);
    set(rig, { axes: { 0: 1 } });
    expect(rig.hub.command(1, 2)).toMatchObject({ rotate: 1, shoot: false });
  });

  it('a (re)started run disarms everything so the A that pressed RETRY cannot fire', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { buttons: { [B.A]: true } });
    rig.hub.disarmAll('run started');
    set(rig, { buttons: { [B.A]: true } });
    expect(rig.hub.command(1, 2).shoot).toBe(false);
    set(rig, {});
    set(rig, { buttons: { [B.A]: true } });
    expect(rig.hub.command(1, 2).shoot).toBe(true);
  });

  it('notifies listeners, and unsubscribing leaves none behind (no stale listeners across scene changes)', () => {
    const rig = makeHub();
    const seen: string[] = [];
    const stop = rig.hub.onEvent((e) => seen.push(e.type));
    expect(rig.hub.listenerCount).toBe(1);
    rig.hub.disarmAll('x');
    stop();
    stop();
    expect(rig.hub.listenerCount).toBe(0);
    rig.hub.disarmAll('y');
    expect(seen).toEqual(['disarmed']);
    for (let i = 0; i < 50; i++) rig.hub.onEvent(() => undefined)();
    expect(rig.hub.listenerCount).toBe(0);
  });
});

describe('diagnostics are bounded and say where the commands go', () => {
  it('lists mapping, raw values, the normalised command and the receiving player', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    set(rig, { axes: { 0: 0.5 }, buttons: { [B.RT]: 0.8 } });
    const text = rig.hub.diagnosticLines(2).join('\n');
    expect(text).toContain('1 connected');
    expect(text).toContain('mapping="standard"');
    expect(text).toContain('raw axes 0:0.50');
    expect(text).toContain('7(0.80)');
    expect(text).toContain('rotate=0.50');
    expect(text).toContain('shoot=1');
    expect(text).toContain('goes to PLAYER 2');
    expect(rig.hub.diagnosticLines(2).join('\n')).toContain(XBOX_ID.split(' (')[0] as string);
  });

  it('the event log is bounded and records connections, assignments, disconnects and neutral resets', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 1, 2);
    rig.hub.disarmAll('window lost focus');
    rig.pads.set(null, 0);
    rig.hub.poll();
    const log = rig.hub.eventLog().join('\n');
    expect(log).toMatch(/connected #0/);
    expect(log).toMatch(/-> Player 2/);
    expect(log).toMatch(/inputs neutral: window lost focus/);
    expect(log).toMatch(/disconnected #0.*was Player 2/);
    for (let i = 0; i < 200; i++) rig.hub.disarmAll(`n${i}`);
    expect(rig.hub.eventLog()).toHaveLength(EVENT_LOG_MAX);
  });

  it('a pad that reports hundreds of buttons and axes does not blow up the report', () => {
    const rig = makeHub();
    rig.pads.set({ axisCount: 200, buttonCount: 400, buttons: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [i, true])) }, 0);
    rig.hub.poll();
    const lines = rig.hub.diagnosticLines(2);
    expect(lines.length).toBeLessThan(12);
    expect(lines.join('\n').length).toBeLessThan(1200);
  });
});

describe('the join policy follows the player count; deliberate choices do not', () => {
  it('a pad that joined Player 1 for a one-player game moves to Player 2 when a second player is chosen', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    expect(rig.hub.join(key, 1)).toBe(0);
    rig.hub.playerCountChanged(2);
    expect(rig.hub.playerOf(key, 2)).toBe(1);
    expect(rig.hub.padFor(0, 2)).toBeNull();
    // ...and still drives the single ship when the player count goes back down.
    rig.hub.playerCountChanged(1);
    expect(rig.hub.playerOf(key, 1)).toBe(0);
  });

  it('a pad the player put on Player 1 on purpose (LB) stays there', () => {
    const rig = makeHub();
    const key = plugIn(rig);
    rig.hub.assign(key, 0, 1);
    rig.hub.playerCountChanged(2);
    expect(rig.hub.playerOf(key, 2)).toBe(0);
  });

  it('does nothing when Player 2 already has a pad, and a reconnecting auto pad keeps its auto-ness', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1, { id: OTHER_ID });
    rig.hub.join(a, 1);
    rig.hub.assign(b, 1, 2);
    rig.hub.playerCountChanged(2);
    expect(rig.hub.playerOf(a, 2)).toBe(0);
    expect(rig.hub.playerOf(b, 2)).toBe(1);
  });
});

describe('a pad that cannot join says so instead of inviting a pointless press', () => {
  it('one player: a pad assigned to "Player 2" already drives the single ship, so a second pad cannot join', () => {
    const rig = makeHub();
    const a = plugIn(rig, 0);
    const b = plugIn(rig, 1, { id: OTHER_ID });
    rig.hub.assign(a, 1, 2);
    expect(rig.hub.join(b, 1)).toBeNull();
    expect(rig.hub.playerOf(a, 1)).toBe(0); // and the first pad is not displaced
    expect(rig.hub.status(1).find((s) => s.padKey === b)?.text).toMatch(/not used/);
  });

  it('two players: with both players holding a connected pad a third pad is "not used"; before that it can join', () => {
    const rig = makeHub();
    const [a, b, c] = [plugIn(rig, 0), plugIn(rig, 1, { id: OTHER_ID }), plugIn(rig, 2, { id: 'third' })];
    expect(rig.hub.status(2).every((s) => /press A to join/.test(s.text))).toBe(true);
    rig.hub.join(a, 2);
    rig.hub.join(b, 2);
    expect(rig.hub.status(2).find((s) => s.padKey === c)?.text).toMatch(/not used/);
  });
});
