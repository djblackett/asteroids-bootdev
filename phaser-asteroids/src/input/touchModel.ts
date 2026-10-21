import { directionToHeading } from '../core/math';
import type { PlayerInput } from '../core/player';
import { stickAxis } from './gamepadMapping';

/**
 * The touch screen's side of the input pipeline: pointer events (already reduced to "this pointer went down on this control at
 * x, y") in, one normalised `PlayerInput` out. Pure: no DOM, no Phaser, so every rule is unit tested with synthetic pointers,
 * and the simulation cannot tell a thumb from a keyboard or a pad.
 *
 * Mapping (the same semantics as the gamepad's left stick, see gamepadMapping.ts):
 *   stick left / right  -> rotate    (analogue, the gamepad's dead zone, full deflection = the keyboard's full turn)
 *   stick up / down     -> move      (up = forward)
 *   D-pad left / right  -> rotate    (digital: -1, 0 or 1, exactly the keyboard's A / D)
 *   D-pad up / down     -> move      (digital: up = forward, exactly W / S)
 *   FIRE held           -> shoot     (continuous while any finger is on it)
 *   LASER / BOOST held  -> laser / boost "key is down" (the player turns that into one activation per press)
 *
 * Exactly one steering control is live at a time (`SteeringMode`): the floating joystick or the fixed D-pad. A press on the other
 * one is refused, and switching mode lets go of everything.
 *
 * The joystick can read the thumb two ways (`StickStyle`). `relative` is the original analogue stick above (left / right turns, up
 * flies) and is only kept for compatibility: no menu offers it any more. `point` and `assist` are the two movement experiments: the
 * thumb's direction from the stick's centre is an absolute screen direction, turned into a heading with the simulation's own
 * conventions, and the command carries it as `steer` (see `SteerRequest`). Same stick, same geometry, same dead zone for both.
 *
 * Every finger is bound to the control it *started* on, by pointer id, until it lifts or is cancelled. Sliding onto another
 * button does nothing and a finger that leaves its button keeps holding it, so controls can never swap or double-fire.
 */

export type TouchControl = 'stick' | 'dpad' | 'fire' | 'laser' | 'boost' | 'pause';

export const TOUCH_CONTROLS: readonly TouchControl[] = ['stick', 'dpad', 'fire', 'laser', 'boost', 'pause'];

/** Which steering control is live: the floating analogue `joystick` or the fixed digital `dpad`. */
export type SteeringMode = 'joystick' | 'dpad';

export const STEERING_MODES: readonly SteeringMode[] = ['joystick', 'dpad'];

/** How the joystick reads the thumb: the legacy `relative` analogue stick, or an absolute direction for Point-to-Fly / Assisted Flight. */
export type StickStyle = 'relative' | 'point' | 'assist';

/**
 * Directional sticks: the thumb must be this far from the stick's centre (fraction of the radius) before a direction is requested,
 * and once it is, only falls back to nothing below the smaller figure. The gap keeps a thumb resting on the edge from flickering
 * between "steer" and "coast". 0.25 of the 52-72 px radius is a 13-18 px circle: a tap or a nervous thumb never steers.
 */
export const DIRECTION_DEAD_ZONE = 0.25;
export const DIRECTION_DEAD_ZONE_HELD = 0.18;

/** Distance (CSS px) the thumb travels from where it landed to reach full deflection, bounded so tiny and huge screens both work. */
export const STICK_RADIUS_MIN = 52;
export const STICK_RADIUS_MAX = 72;
const STICK_RADIUS_FRACTION = 0.15;

/** Full-deflection distance for a viewport: 15 % of the shorter side, within [52, 72] CSS px. */
export function stickRadiusFor(width: number, height: number): number {
  const short = Math.min(width, height);
  if (!Number.isFinite(short) || short <= 0) return STICK_RADIUS_MIN;
  return Math.min(STICK_RADIUS_MAX, Math.max(STICK_RADIUS_MIN, Math.round(short * STICK_RADIUS_FRACTION)));
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Thumb displacement (dx, dy in CSS px, y down) -> stick axes. Each axis is clamped to [-1, 1] on its own (a square gate, like
 * the keyboard: pushing into a corner turns AND flies at full rate) and then run through the gamepad's `stickAxis`, so the
 * dead zone is the controller's 0.15. Up is forward, so `move` is the negated vertical axis.
 */
export function stickToAxes(dx: number, dy: number, radius: number): { rotate: number; move: number } {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { rotate: 0, move: 0 };
  return {
    rotate: stickAxis(clamp1(dx / radius)) + 0, // `+ 0` turns -0 into 0
    move: -stickAxis(clamp1(dy / radius)) + 0,
  };
}

/**
 * D-pad geometry. The pad is a circle whose eight sectors are 45 degrees each (four directions plus four diagonals), so a
 * diagonal is as easy to hit as a cardinal and one thumb can hold Up + Left. The centre is a dead zone, so a thumb resting on the
 * hub is neutral. Finger positions are measured from the pad's centre and may be anywhere on the screen: a thumb that slides off
 * the pad keeps its direction (by angle) until it lifts, like a finger that slides off a button.
 */
export const DPAD_DEAD_ZONE = 0.22;
/** Once a direction is held it survives a slightly smaller push, so a thumb hovering on the hub's edge does not flicker. */
export const DPAD_DEAD_ZONE_HELD = 0.14;
/** An axis switches on when the thumb is 22.5 degrees past the other axis (tan 22.5 = 0.414: eight equal sectors)... */
const DPAD_ENTER = Math.tan(Math.PI / 8);
/** ...and stays on until it is about 19.8 degrees (tan = 0.36): a 2.7 degree hysteresis, so sliding along a boundary is stable. */
const DPAD_STAY = 0.36;

export interface DpadDirection {
  /** -1 left (counterclockwise), 0, +1 right (clockwise). */
  rotate: -1 | 0 | 1;
  /** -1 back, 0, +1 forward. */
  move: -1 | 0 | 1;
}

export const DPAD_NEUTRAL: DpadDirection = { rotate: 0, move: 0 };

/**
 * Thumb offset from the pad's centre (dx, dy in CSS px, y down) -> a digital direction. `previous` is the direction the thumb
 * held a moment ago; it only widens the sectors that are already on (hysteresis). A thumb in the centre is neutral, and so is
 * an unusable radius or non-finite input.
 */
export function dpadDirection(dx: number, dy: number, radius: number, previous: DpadDirection = DPAD_NEUTRAL): DpadDirection {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return DPAD_NEUTRAL;
  const held = previous.rotate !== 0 || previous.move !== 0;
  if (Math.hypot(dx, dy) < radius * (held ? DPAD_DEAD_ZONE_HELD : DPAD_DEAD_ZONE)) return DPAD_NEUTRAL;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const horizontal = ax > (previous.rotate !== 0 ? DPAD_STAY : DPAD_ENTER) * ay;
  const vertical = ay > (previous.move !== 0 ? DPAD_STAY : DPAD_ENTER) * ax;
  return {
    rotate: horizontal ? (dx < 0 ? -1 : 1) : 0,
    move: vertical ? (dy < 0 ? 1 : -1) : 0,
  };
}

/** What the on-screen D-pad should look like. */
export interface DpadView {
  /** A finger is on the pad. */
  active: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** What the on-screen joystick should look like; copied out so the view never holds the model's mutable state. */
export interface StickView {
  active: boolean;
  /** Where the thumb landed (the base of the stick). */
  anchorX: number;
  anchorY: number;
  /** Knob offset from the anchor, limited to the stick radius (a circle, for drawing only). */
  knobX: number;
  knobY: number;
  radius: number;
}

export class TouchModel {
  /** pointer id -> the control it is bound to. A pointer is in here from press to release / cancel, nothing else. */
  private readonly owner = new Map<number, TouchControl>();
  private stickPointer: number | null = null;
  private anchorX = 0;
  private anchorY = 0;
  private dx = 0;
  private dy = 0;
  private radius = STICK_RADIUS_MIN;
  private steering: SteeringMode = 'joystick';
  private style: StickStyle = 'relative';
  /** A directional stick is past its dead zone (with hysteresis), so the command carries a heading. */
  private pointing = false;
  private dpadPointer: number | null = null;
  /** Where the D-pad is on screen (centre and radius, CSS px), set by whoever can read the element's rectangle. */
  private padX = 0;
  private padY = 0;
  private padRadius = 0;
  private padDir: DpadDirection = DPAD_NEUTRAL;
  /** The D-pad finger's last position, kept so a pad that moved or resized under a held thumb can re-aim it. */
  private padFingerX = 0;
  private padFingerY = 0;
  private enabled = true;
  private listeners = new Set<() => void>();
  /** Bumped on every change a view would draw; lets a renderer skip frames where nothing happened. */
  revision = 0;

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** A disabled model ignores presses and reports a neutral command; disabling also lets go of everything held. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
    this.changed();
  }

  get steeringMode(): SteeringMode {
    return this.steering;
  }

  /** Chooses the live steering control. Everything is let go, so no turn or thrust from the old control can outlive the switch. */
  setSteering(mode: SteeringMode): void {
    if (mode === this.steering) return;
    this.steering = mode;
    this.releaseAll();
    this.changed();
  }

  get stickStyle(): StickStyle {
    return this.style;
  }

  /** Chooses how the joystick reads the thumb. Everything is let go, so a direction from the old style cannot outlive the switch. */
  setStickStyle(style: StickStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.releaseAll();
    this.changed();
  }

  /** The D-pad's centre and radius in the same coordinates as pointer events (CSS px). Cheap to call repeatedly. */
  setDpadGeometry(centreX: number, centreY: number, radius: number): void {
    if (!(radius > 0) || !Number.isFinite(centreX) || !Number.isFinite(centreY)) return;
    if (centreX === this.padX && centreY === this.padY && radius === this.padRadius) return;
    this.padX = centreX;
    this.padY = centreY;
    this.padRadius = radius;
    this.retargetDpad();
  }

  setStickRadius(radius: number): void {
    if (radius > 0 && radius !== this.radius) {
      this.radius = radius;
      this.updatePointing();
      this.changed();
    }
  }

  get stickRadius(): number {
    return this.radius;
  }

  /**
   * A pointer went down on `control` at (x, y). Returns whether the model took it (false when disabled, or when the stick is
   * already held by another finger: the extra finger is simply ignored and never tracked, so it cannot leak).
   */
  press(pointerId: number, control: TouchControl, x: number, y: number): boolean {
    if (!this.enabled) return false;
    // Only the live steering control takes touches: its sibling is hidden, but a stale event in the same frame must not leak.
    if (control === 'stick' && this.steering !== 'joystick') return false;
    if (control === 'dpad' && this.steering !== 'dpad') return false;
    if (this.owner.has(pointerId)) this.release(pointerId);
    if (control === 'dpad') {
      // One finger steers; a second one on the pad is ignored (never tracked, so it cannot leak). No geometry yet = unusable.
      if (this.dpadPointer !== null || !(this.padRadius > 0)) return false;
      this.dpadPointer = pointerId;
      this.padFingerX = x;
      this.padFingerY = y;
      this.padDir = dpadDirection(x - this.padX, y - this.padY, this.padRadius);
      this.owner.set(pointerId, control);
      this.changed();
      return true;
    }
    if (control === 'stick') {
      if (this.stickPointer !== null) return false;
      this.stickPointer = pointerId;
      this.anchorX = x;
      this.anchorY = y;
      this.dx = 0;
      this.dy = 0;
      this.pointing = false;
    }
    this.owner.set(pointerId, control);
    this.changed();
    return true;
  }

  /** The pointer moved. Only the stick's finger matters; everything else is ignored (a button is held, not dragged). */
  move(pointerId: number, x: number, y: number): void {
    if (pointerId === this.dpadPointer) {
      this.padFingerX = x;
      this.padFingerY = y;
      this.retargetDpad();
      return;
    }
    if (pointerId !== this.stickPointer) return;
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    this.updatePointing();
    this.changed();
  }

  /** The pointer lifted or was cancelled. Returns the control it held (null if it was not ours). */
  release(pointerId: number): TouchControl | null {
    const control = this.owner.get(pointerId);
    if (control === undefined) return null;
    this.owner.delete(pointerId);
    if (pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.dx = 0;
      this.dy = 0;
      this.pointing = false;
    }
    if (pointerId === this.dpadPointer) {
      this.dpadPointer = null;
      this.padDir = DPAD_NEUTRAL;
    }
    this.changed();
    return control;
  }

  /** Everything neutral at once (focus lost, orientation change, pause, game over). Returns whether anything was held. */
  releaseAll(): boolean {
    const any = this.owner.size > 0;
    this.owner.clear();
    this.stickPointer = null;
    this.dpadPointer = null;
    this.padDir = DPAD_NEUTRAL;
    this.dx = 0;
    this.dy = 0;
    this.pointing = false;
    if (any) this.changed();
    return any;
  }

  has(pointerId: number): boolean {
    return this.owner.has(pointerId);
  }

  controlOf(pointerId: number): TouchControl | null {
    return this.owner.get(pointerId) ?? null;
  }

  /** Whether any finger is currently on `control`. */
  holds(control: TouchControl): boolean {
    for (const c of this.owner.values()) if (c === control) return true;
    return false;
  }

  get activePointers(): number {
    return this.owner.size;
  }

  /** The command for this frame. Neutral unless fingers are down. */
  command(): PlayerInput {
    if (this.owner.size === 0) return { rotate: 0, move: 0, shoot: false, laser: false, boost: false };
    const buttons = { shoot: this.holds('fire'), laser: this.holds('laser'), boost: this.holds('boost') };
    if (this.dpadPointer === null && this.steering === 'joystick' && this.style !== 'relative') {
      // Directional stick: nothing to turn by hand. Past the dead zone the ship is asked to face (and fly) the thumb's way.
      if (!this.pointing) return { rotate: 0, move: 0, ...buttons };
      const heading = directionToHeading(this.dx, this.dy);
      return { rotate: 0, move: 1, ...buttons, steer: { heading, mode: this.style === 'assist' ? 'assist' : 'point' } };
    }
    const { rotate, move } = this.dpadPointer !== null ? this.padDir : stickToAxes(this.dx, this.dy, this.radius);
    return { rotate, move, ...buttons };
  }

  stickView(): StickView {
    const mag = Math.hypot(this.dx, this.dy);
    const k = mag > this.radius ? this.radius / mag : 1;
    return {
      active: this.stickPointer !== null,
      anchorX: this.anchorX,
      anchorY: this.anchorY,
      knobX: this.dx * k,
      knobY: this.dy * k,
      radius: this.radius,
    };
  }

  dpadView(): DpadView {
    const { rotate, move } = this.padDir;
    return { active: this.dpadPointer !== null, up: move > 0, down: move < 0, left: rotate < 0, right: rotate > 0 };
  }

  /** The directional stick's dead zone, with hysteresis: in at `DIRECTION_DEAD_ZONE`, out again only below `DIRECTION_DEAD_ZONE_HELD`. */
  private updatePointing(): void {
    const reach = Math.hypot(this.dx, this.dy) / this.radius;
    this.pointing = reach >= (this.pointing ? DIRECTION_DEAD_ZONE_HELD : DIRECTION_DEAD_ZONE);
  }

  /** Recomputes the D-pad direction from the finger's last position (it moved, or the pad moved or resized under it). */
  private retargetDpad(): void {
    if (this.dpadPointer === null) return;
    const next = dpadDirection(this.padFingerX - this.padX, this.padFingerY - this.padY, this.padRadius, this.padDir);
    if (next.rotate === this.padDir.rotate && next.move === this.padDir.move) return;
    this.padDir = next;
    this.changed();
  }

  /** Subscribes to changes the view cares about; returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
