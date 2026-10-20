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
 *   FIRE held           -> shoot     (continuous while any finger is on it)
 *   LASER / BOOST held  -> laser / boost "key is down" (the player turns that into one activation per press)
 *
 * Every finger is bound to the control it *started* on, by pointer id, until it lifts or is cancelled. Sliding onto another
 * button does nothing and a finger that leaves its button keeps holding it, so controls can never swap or double-fire.
 */

export type TouchControl = 'stick' | 'fire' | 'laser' | 'boost' | 'pause';

export const TOUCH_CONTROLS: readonly TouchControl[] = ['stick', 'fire', 'laser', 'boost', 'pause'];

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

  setStickRadius(radius: number): void {
    if (radius > 0 && radius !== this.radius) {
      this.radius = radius;
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
    if (this.owner.has(pointerId)) this.release(pointerId);
    if (control === 'stick') {
      if (this.stickPointer !== null) return false;
      this.stickPointer = pointerId;
      this.anchorX = x;
      this.anchorY = y;
      this.dx = 0;
      this.dy = 0;
    }
    this.owner.set(pointerId, control);
    this.changed();
    return true;
  }

  /** The pointer moved. Only the stick's finger matters; everything else is ignored (a button is held, not dragged). */
  move(pointerId: number, x: number, y: number): void {
    if (pointerId !== this.stickPointer) return;
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
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
    }
    this.changed();
    return control;
  }

  /** Everything neutral at once (focus lost, orientation change, pause, game over). Returns whether anything was held. */
  releaseAll(): boolean {
    const any = this.owner.size > 0;
    this.owner.clear();
    this.stickPointer = null;
    this.dx = 0;
    this.dy = 0;
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
    const { rotate, move } = stickToAxes(this.dx, this.dy, this.radius);
    return { rotate, move, shoot: this.holds('fire'), laser: this.holds('laser'), boost: this.holds('boost') };
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
