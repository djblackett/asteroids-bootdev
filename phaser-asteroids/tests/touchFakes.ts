import type { BindingDocument, BindingHost, ControlElement, RectLike } from '../src/input/touchBinding';
import type { AbilityLabels, TouchLayer, TouchView } from '../src/input/touchControls';
import type { DpadView, SteeringMode, StickView, TouchControl } from '../src/input/touchModel';
import { TOUCH_CONTROLS } from '../src/input/touchModel';

/** An EventTarget that also counts its listeners, so "everything was removed" can be asserted. */
export class CountingTarget extends EventTarget {
  private readonly all = new Map<string, Set<unknown>>();
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (!fn) return;
    (this.all.get(type) ?? this.all.set(type, new Set()).get(type)!).add(fn);
    super.addEventListener(type, fn, options);
  }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    if (!fn) return;
    this.all.get(type)?.delete(fn);
    super.removeEventListener(type, fn, options);
  }
  get listenerTotal(): number {
    let total = 0;
    for (const set of this.all.values()) total += set.size;
    return total;
  }
}

export class FakeElement extends CountingTarget implements ControlElement {
  captured = new Set<number>();
  /** Set to make `setPointerCapture` throw, like a browser that refuses (the pointer is already gone). */
  captureThrows = false;
  constructor(public rect: RectLike) {
    super();
  }
  setPointerCapture(id: number): void {
    if (this.captureThrows) throw new Error('NotFoundError');
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  getBoundingClientRect(): RectLike {
    return this.rect;
  }
}

export class FakeHost extends CountingTarget implements BindingHost {
  innerWidth = 844;
  innerHeight = 390;
}

export class FakeDoc extends CountingTarget implements BindingDocument {
  hidden = false;
}

export interface PointerOptions {
  pointerType?: string;
  button?: number;
}

/** A pointer event as the binding sees it: a plain `Event` carrying the fields it reads. `defaultPrevented` is recorded. */
export function pointer(type: string, id: number, x = 0, y = 0, options: PointerOptions = {}): Event & { pointerId: number; clientX: number; clientY: number; prevented: boolean } {
  const event = new Event(type, { cancelable: true }) as Event & { pointerId: number; clientX: number; clientY: number; pointerType: string; button: number; prevented: boolean };
  event.pointerId = id;
  event.clientX = x;
  event.clientY = y;
  event.pointerType = options.pointerType ?? 'touch';
  event.button = options.button ?? 0;
  event.prevented = false;
  const original = event.preventDefault.bind(event);
  event.preventDefault = () => {
    event.prevented = true;
    original();
  };
  return event;
}

/** Where each control sits on the fake 844 x 390 landscape screen (a rough match of the real layout). */
export const LAYOUT: Readonly<Record<TouchControl, RectLike>> = {
  stick: { left: 0, top: 0, right: 388, bottom: 390 },
  // The D-pad: a 170 px disc, bottom left (centre 105, 275). It shares the left side with the (hidden) stick zone, as on the real screen.
  dpad: { left: 20, top: 190, right: 190, bottom: 360 },
  fire: { left: 700, top: 240, right: 810, bottom: 350 },
  laser: { left: 610, top: 276, right: 680, bottom: 346 },
  boost: { left: 718, top: 150, right: 792, bottom: 224 },
  pause: { left: 774, top: 10, right: 826, bottom: 62 },
};

export function fakeElements(): Record<TouchControl, FakeElement> {
  const out = {} as Record<TouchControl, FakeElement>;
  for (const control of TOUCH_CONTROLS) out[control] = new FakeElement(LAYOUT[control]);
  return out;
}

export const centre = (rect: RectLike): { x: number; y: number } => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

/** A view that records what it was asked to draw. */
export class FakeView implements TouchView {
  readonly elements: Readonly<Record<TouchControl, FakeElement>> = fakeElements();
  active = false;
  layer: TouchLayer = 'off';
  portrait = false;
  stick: StickView | null = null;
  dpad: DpadView | null = null;
  steering: SteeringMode | null = null;
  pressed: Partial<Record<TouchControl, boolean>> = {};
  abilities: AbilityLabels | null = null;
  destroyed = false;
  setActive(active: boolean): void {
    this.active = active;
  }
  setLayer(layer: TouchLayer): void {
    this.layer = layer;
  }
  setPortrait(portrait: boolean): void {
    this.portrait = portrait;
  }
  renderStick(stick: StickView): void {
    this.stick = stick;
  }
  renderDpad(dpad: DpadView): void {
    this.dpad = dpad;
  }
  setSteering(mode: SteeringMode): void {
    this.steering = mode;
  }
  setPressed(control: TouchControl, pressed: boolean): void {
    this.pressed[control] = pressed;
  }
  setAbilities(labels: AbilityLabels): void {
    this.abilities = labels;
  }
  destroy(): void {
    this.destroyed = true;
  }
}
