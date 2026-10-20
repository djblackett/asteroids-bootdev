import { GamepadHub, type GamepadReader } from '../src/input/gamepadHub';
import type { GamepadSnapshot } from '../src/input/gamepadMapping';

export const XBOX_ID = 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)';
export const OTHER_ID = '054c-09cc-Wireless Controller';

/** Standard-mapping button indices. */
export const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export interface PadSpec {
  index?: number;
  id?: string;
  mapping?: string;
  connected?: boolean;
  /** Axis values by index; missing axes are 0. */
  axes?: Partial<Record<number, number>>;
  /** Buttons by index: `true` = fully pressed, a number = analogue value. */
  buttons?: Partial<Record<number, boolean | number>>;
  axisCount?: number;
  buttonCount?: number;
}

/** A synthetic browser-gamepad snapshot. */
export function padSnap(spec: PadSpec = {}): GamepadSnapshot {
  const mapping = spec.mapping ?? 'standard';
  const axes = Array.from({ length: spec.axisCount ?? (mapping === 'standard' ? 4 : 6) }, (_, i) => spec.axes?.[i] ?? 0);
  const buttons = Array.from({ length: spec.buttonCount ?? 17 }, (_, i) => {
    const v = spec.buttons?.[i];
    const value = v === true ? 1 : typeof v === 'number' ? v : 0;
    return { pressed: v === true || (typeof v === 'number' && v >= 0.5), value };
  });
  return { index: spec.index ?? 0, id: spec.id ?? XBOX_ID, mapping, connected: spec.connected ?? true, axes, buttons };
}

/** An injectable reader whose slots a test sets directly, standing in for `navigator.getGamepads()`. */
export class FakePads {
  readonly slots: Array<GamepadSnapshot | null> = [null, null, null, null];
  throwNext = false;
  readonly read: GamepadReader = () => {
    if (this.throwNext) throw new Error('getGamepads blocked');
    return this.slots;
  };

  set(spec: PadSpec | null, index = spec?.index ?? 0): void {
    this.slots[index] = spec === null ? null : padSnap({ ...spec, index });
  }
}

export interface HubRig {
  hub: GamepadHub;
  pads: FakePads;
  clock: { t: number };
}

export function makeHub(): HubRig {
  const pads = new FakePads();
  const clock = { t: 0 };
  return { hub: new GamepadHub(pads.read, () => clock.t), pads, clock };
}

/** A pad plugged in and idle (so it is armed), polled once. Returns its key. */
export function plugIn(rig: HubRig, index = 0, spec: PadSpec = {}): number {
  rig.pads.set({ ...spec }, index);
  rig.hub.poll();
  const view = rig.hub.pads().find((p) => p.index === index);
  if (!view) throw new Error('pad did not connect');
  return view.key;
}
