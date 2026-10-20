import { stickRadiusFor, TOUCH_CONTROLS, type TouchControl, type TouchModel } from './touchModel';

/**
 * Wires browser Pointer Events to a `TouchModel`. It owns every listener it adds (all removed by `destroy`), and it is written
 * against the small structural types below so the lifecycle rules (cancel, release outside, focus loss, rotation) are unit
 * tested with fake event targets instead of a browser.
 *
 * Design:
 *  - `pointerdown` is listened to on each control's own element, so the control a finger belongs to is decided once, where it
 *    landed, and the finger keeps it (pointer capture where the browser has it).
 *  - `pointermove` / `pointerup` / `pointercancel` / `lostpointercapture` are listened to on the window, not on the elements: they
 *    reach the window whether or not capture worked, so a finger that slides off its button, or lifts outside it, is still
 *    tracked and released.
 *  - `preventDefault()` on `pointerdown` stops the browser synthesising compatibility mouse events and a click afterwards, which
 *    would otherwise reach the Phaser canvas under a control that has just disappeared (a ghost tap on RESUME after tapping PAUSE).
 *  - Pause is a *tap*: it fires on release only if the finger is still on the button, so a sliding thumb cannot pause by accident.
 *  - The D-pad's finger is measured against the pad's *current* rectangle (read on press, on every move, and when the viewport
 *    changes), so a plain resize under a held thumb (a browser toolbar sliding away) re-aims it instead of leaving a stale direction.
 *  - Entering or leaving fullscreen lets go of every finger, like a rotation: the layout is about to move under them.
 */

/** Handlers receive the browser's own event objects; the real DOM types are looser than anything a structural fake can state. */
export type Listener = (event: any) => void;

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  pointerType?: string;
  button?: number;
  preventDefault(): void;
}

export interface ControlElement {
  addEventListener(type: string, listener: Listener, options?: unknown): void;
  removeEventListener(type: string, listener: Listener, options?: unknown): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  getBoundingClientRect(): RectLike;
}

export interface BindingHost {
  addEventListener(type: string, listener: Listener, options?: unknown): void;
  removeEventListener(type: string, listener: Listener, options?: unknown): void;
  innerWidth: number;
  innerHeight: number;
}

export interface BindingDocument {
  addEventListener(type: string, listener: Listener, options?: unknown): void;
  removeEventListener(type: string, listener: Listener, options?: unknown): void;
  hidden: boolean;
}

export interface ViewportChange {
  width: number;
  height: number;
  portrait: boolean;
  /** Portrait <-> landscape flipped (as opposed to a plain resize, e.g. a browser toolbar sliding away). */
  orientationChanged: boolean;
}

export interface TouchBindingOptions {
  elements: Readonly<Record<TouchControl, ControlElement>>;
  model: TouchModel;
  host: BindingHost;
  doc: BindingDocument;
  /** The PAUSE button was tapped (finger down and up on it). */
  onPauseTap: () => void;
  /** Called after any resize / rotation, once the model has been told what to do about it. */
  onViewport?: (change: ViewportChange) => void;
  /** Called whenever the binding let go of every held control for a lifecycle reason ('blur', 'hidden', 'pagehide', 'orientation', 'fullscreen'). */
  onLifecycleRelease?: (reason: string) => void;
}

export interface TouchBinding {
  destroy(): void;
  isPortrait(): boolean;
}

const inside = (rect: RectLike, x: number, y: number): boolean => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

export function bindTouchControls(options: TouchBindingOptions): TouchBinding {
  const { elements, model, host, doc } = options;
  const cleanups: Array<() => void> = [];
  const on = (target: BindingHost | BindingDocument | ControlElement, type: string, listener: Listener): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const syncDpad = (): void => {
    const r = elements.dpad.getBoundingClientRect();
    model.setDpadGeometry((r.left + r.right) / 2, (r.top + r.bottom) / 2, Math.min(r.right - r.left, r.bottom - r.top) / 2);
  };

  const isPortrait = (): boolean => host.innerHeight > host.innerWidth;
  let portrait = isPortrait();

  const onDown = (control: TouchControl) => (event: PointerLike): void => {
    // Only the primary button of a mouse; touches and pens always report button 0.
    if (event.button !== undefined && event.button > 0) return;
    // A hidden control (display: none) cannot receive events, but a stale one in the same frame as a mode change could.
    if (!model.isEnabled) return;
    event.preventDefault();
    if (control === 'stick') model.setStickRadius(stickRadiusFor(host.innerWidth, host.innerHeight));
    if (control === 'dpad') syncDpad();
    if (!model.press(event.pointerId, control, event.clientX, event.clientY)) return;
    try {
      elements[control].setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer is already gone, or capture is unsupported: the window-level listeners below still track it.
    }
  };
  for (const control of TOUCH_CONTROLS) on(elements[control], 'pointerdown', onDown(control));

  on(host, 'pointermove', ((event: PointerLike) => {
    if (!model.has(event.pointerId)) return;
    if (model.controlOf(event.pointerId) === 'dpad') syncDpad();
    model.move(event.pointerId, event.clientX, event.clientY);
  }));

  on(host, 'pointerup', ((event: PointerLike) => {
    const control = model.release(event.pointerId);
    if (control === 'pause' && inside(elements.pause.getBoundingClientRect(), event.clientX, event.clientY)) options.onPauseTap();
  }));

  // A cancelled pointer (a system gesture took the touch, the browser decided it was a scroll) and a lost capture (the element was
  // hidden or removed under the finger) never count as a tap: they only let go.
  const letGo = ((event: PointerLike) => void model.release(event.pointerId));
  on(host, 'pointercancel', letGo);
  on(host, 'lostpointercapture', letGo);

  const lifecycleRelease = (reason: string): void => {
    if (model.releaseAll()) options.onLifecycleRelease?.(reason);
  };
  on(host, 'blur', (() => lifecycleRelease('blur')));
  on(host, 'pagehide', (() => lifecycleRelease('pagehide')));
  on(doc, 'visibilitychange', (() => {
    if (doc.hidden) lifecycleRelease('hidden');
  }));
  // Fullscreen on / off (standard and webkit-prefixed event names) moves every control; the new size arrives with the resize that follows.
  const onFullscreenChange = (): void => {
    lifecycleRelease('fullscreen');
    options.onViewport?.({ width: host.innerWidth, height: host.innerHeight, portrait: isPortrait(), orientationChanged: false });
  };
  on(doc, 'fullscreenchange', onFullscreenChange);
  on(doc, 'webkitfullscreenchange', onFullscreenChange);
  on(host, 'contextmenu', ((event: PointerLike) => event.preventDefault()));

  const onViewport = (): void => {
    const now = isPortrait();
    const orientationChanged = now !== portrait;
    portrait = now;
    // Fingers are only let go when the orientation really flips: browser chrome sliding in and out fires plain resizes.
    if (orientationChanged) lifecycleRelease('orientation');
    if (model.holds('dpad')) syncDpad();
    options.onViewport?.({ width: host.innerWidth, height: host.innerHeight, portrait: now, orientationChanged });
  };
  on(host, 'resize', onViewport);
  on(host, 'orientationchange', onViewport);

  return {
    destroy: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      model.releaseAll();
    },
    isPortrait,
  };
}
