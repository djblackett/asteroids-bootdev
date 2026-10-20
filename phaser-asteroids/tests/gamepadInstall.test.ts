import { describe, expect, it } from 'vitest';
import { DESTROY, installGamepadHub, PRE_STEP, type GameLike } from '../src/input/gameGamepads';
import { NO_INPUT } from '../src/core/player';
import { B, FakePads } from './padFakes';

/** The browser wiring around the hub, with a fake game, window and document: no Phaser, no DOM, no hardware. */

class FakeTarget extends EventTarget {
  hidden = false;
  performance = { now: () => 1234 };
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    if (!fn) return;
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
    super.addEventListener(type, fn);
  }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    if (!fn) return;
    this.listeners.get(type)?.delete(fn);
    super.removeEventListener(type, fn);
  }
}

function rig() {
  const handlers = new Map<string, Set<() => void>>();
  const game: GameLike = {
    events: {
      on: (e, fn) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(fn),
      once(e, fn) {
        const wrapped = (): void => {
          handlers.get(e)?.delete(wrapped);
          fn();
        };
        this.on(e, wrapped);
      },
      off: (e, fn) => void handlers.get(e)?.delete(fn),
    },
    registry: { set: (key, value) => void registry.set(key, value) },
  };
  const registry = new Map<string, unknown>();
  const pads = new FakePads();
  const host = new FakeTarget();
  const doc = new FakeTarget();
  const hub = installGamepadHub(game, pads.read, host, doc);
  const emit = (e: string): void => handlers.get(e)?.forEach((fn) => fn());
  return { game, registry, pads, host, doc, hub, emit, handlers };
}

describe('installGamepadHub', () => {
  it('stores the hub in the registry and polls it once per frame (before scenes)', () => {
    const r = rig();
    expect(r.registry.get('gamepadHub')).toBe(r.hub);
    r.pads.set({});
    expect(r.hub.pads()).toHaveLength(0);
    r.emit(PRE_STEP);
    expect(r.hub.pads()).toHaveLength(1);
  });

  it("the browser's connect / disconnect events poll immediately instead of waiting for the next frame", () => {
    const r = rig();
    r.pads.set({});
    r.host.dispatchEvent(new Event('gamepadconnected'));
    expect(r.hub.pads()).toHaveLength(1);
    r.pads.set(null, 0);
    r.host.dispatchEvent(new Event('gamepaddisconnected'));
    expect(r.hub.pads()).toHaveLength(0);
  });

  const driven = (r: ReturnType<typeof rig>) => {
    r.pads.set({});
    r.emit(PRE_STEP);
    r.hub.assign(r.hub.pads()[0]!.key, 1, 2);
    r.pads.set({ axes: { 0: 1 }, buttons: { [B.RT]: 1 } });
    r.emit(PRE_STEP);
    expect(r.hub.command(1, 2).shoot).toBe(true);
  };

  it('window blur, a hidden tab and focus returning all make the pad neutral until its buttons are released', () => {
    for (const trigger of [(r: ReturnType<typeof rig>) => r.host.dispatchEvent(new Event('blur')), (r: ReturnType<typeof rig>) => { r.doc.hidden = true; r.doc.dispatchEvent(new Event('visibilitychange')); }, (r: ReturnType<typeof rig>) => r.host.dispatchEvent(new Event('focus'))]) {
      const r = rig();
      driven(r);
      trigger(r);
      expect(r.hub.command(1, 2)).toEqual(NO_INPUT);
      r.emit(PRE_STEP); // still holding everything
      expect(r.hub.command(1, 2)).toEqual(NO_INPUT);
      r.pads.set({ axes: { 0: 1 } });
      r.emit(PRE_STEP);
      expect(r.hub.command(1, 2).rotate).toBe(1);
    }
  });

  it('destroying the game removes every listener it added and leaves the pads neutral', () => {
    const r = rig();
    driven(r);
    expect(r.host.count('blur')).toBe(1);
    expect(r.doc.count('visibilitychange')).toBe(1);
    r.emit(DESTROY);
    for (const type of ['gamepadconnected', 'gamepaddisconnected', 'blur', 'focus']) expect(r.host.count(type), type).toBe(0);
    expect(r.doc.count('visibilitychange')).toBe(0);
    expect(r.handlers.get(PRE_STEP)?.size ?? 0).toBe(0);
    expect(r.hub.command(1, 2)).toEqual(NO_INPUT);
  });
});
