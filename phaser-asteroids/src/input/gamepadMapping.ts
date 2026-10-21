import type { PlayerInput } from '../core/player';

/**
 * Turns one raw gamepad snapshot into the normalised commands the game uses. Pure: no browser APIs, so every rule here is
 * unit tested with synthetic snapshots.
 *
 * Python reference (`Player.update`, `gamepad_N` branch, pygame 2 / SDL on Windows with an Xbox pad):
 *   rotate  = left stick X (axis 0), used as the analogue value itself once |x| > 0.15
 *   move    = -left stick Y (axis 1), same dead zone, so pushing up is forward and the ship slows with a lighter push
 *   shoot   = right trigger (axis 5) > 0.5, OR the A button (button 0)
 *   laser   = X (button 2), once per press        boost = B (button 1), once per press
 *   pause   = Start (JOYBUTTONDOWN 7, SDL's numbering)      menus: A confirms, D-pad navigates
 * The browser's "standard" mapping numbers the same physical buttons differently (triggers are buttons 6 / 7, Start is 9,
 * the D-pad is 12-15), so the same *physical* controls are mapped, not the same indices.
 */

/** Python's `abs(axis) > 0.15`. */
export const STICK_DEADZONE = 0.15;
/** Python's `right_trigger > 0.5`. */
export const TRIGGER_THRESHOLD = 0.5;
/** Threshold for treating an ordinary (non-trigger) button as down when only its analogue `value` is trustworthy. */
export const BUTTON_THRESHOLD = 0.5;

export interface PadButtonSnapshot {
  pressed: boolean;
  value: number;
}

/** A plain copy of the fields of a browser `Gamepad` the game reads. */
export interface GamepadSnapshot {
  index: number;
  id: string;
  /** `'standard'` or `''` (anything else the browser could not map). */
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: readonly PadButtonSnapshot[];
}

/** Controls by what they are called on an Xbox-style pad, whatever their index on the device. */
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'trigger' | 'back' | 'start' | 'up' | 'down' | 'left' | 'right';

export const PAD_BUTTONS: readonly PadButton[] = ['a', 'b', 'x', 'y', 'lb', 'rb', 'trigger', 'back', 'start', 'up', 'down', 'left', 'right'];

/** `standard`: the browser's standard mapping. `generic`: any other device, read with Python's raw SDL indices. */
export type PadLayout = 'standard' | 'generic';

interface LayoutSpec {
  axisX: number;
  axisY: number;
  /** Right trigger as a button (analogue `value`), or null. */
  triggerButton: number | null;
  /** Right trigger as an axis (rests at 0 or -1, pulled towards +1), or null. */
  triggerAxis: number | null;
  buttons: Readonly<Partial<Record<PadButton, number>>>;
}

const LAYOUTS: Readonly<Record<PadLayout, LayoutSpec>> = {
  standard: {
    axisX: 0,
    axisY: 1,
    triggerButton: 7,
    triggerAxis: null,
    buttons: { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 },
  },
  // Python's own indices, for devices the browser does not map: the sticks on axes 0 / 1, the trigger on axis 5, the face
  // buttons 0 / 1 / 2, Start 7. No D-pad (on raw devices it is a hat or an unpredictable axis) and no bumpers.
  generic: {
    axisX: 0,
    axisY: 1,
    triggerButton: null,
    triggerAxis: 5,
    buttons: { a: 0, b: 1, x: 2, y: 3, back: 6, start: 7 },
  },
};

export function layoutOf(snapshot: Pick<GamepadSnapshot, 'mapping'>): PadLayout {
  return snapshot.mapping === 'standard' ? 'standard' : 'generic';
}

const finite = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * One stick axis: 0 inside the dead zone, otherwise the raw deflection clamped to [-1, 1]. Like Python the value is *not*
 * rescaled past the dead zone, so full deflection turns / flies exactly as fast as the keyboard and a light touch is
 * slower. Dead zone and sign are applied per axis, so a drifting vertical axis never turns the ship.
 */
export function stickAxis(value: number | undefined, deadzone = STICK_DEADZONE): number {
  const v = finite(value);
  if (Math.abs(v) <= deadzone) return 0;
  return Math.max(-1, Math.min(1, v));
}

const down = (b: PadButtonSnapshot | undefined, threshold = BUTTON_THRESHOLD): boolean => {
  if (!b) return false;
  const v = finite(b.value);
  // A device that sets `pressed` but leaves `value` at 0 is a digital button.
  return v >= threshold || (b.pressed && v === 0);
};

/** Every control of the pad that is down, by name. */
export function heldButtons(snapshot: GamepadSnapshot): Set<PadButton> {
  const spec = LAYOUTS[layoutOf(snapshot)];
  const held = new Set<PadButton>();
  for (const name of PAD_BUTTONS) {
    const index = spec.buttons[name];
    if (index !== undefined && down(snapshot.buttons[index])) held.add(name);
  }
  if (spec.triggerButton !== null && down(snapshot.buttons[spec.triggerButton], TRIGGER_THRESHOLD)) held.add('trigger');
  if (spec.triggerAxis !== null && finite(snapshot.axes[spec.triggerAxis]) > TRIGGER_THRESHOLD) held.add('trigger');
  return held;
}

/** Whether anything on the device is pressed or pulled, including controls the game does not use (guards "armed"). */
export function anythingHeld(snapshot: GamepadSnapshot): boolean {
  if (snapshot.buttons.some((b) => down(b, 0.25))) return true;
  const spec = LAYOUTS[layoutOf(snapshot)];
  return spec.triggerAxis !== null && finite(snapshot.axes[spec.triggerAxis]) > 0.25;
}

/**
 * The player command a pad produces. The stick wins; the D-pad (standard layout only) is a digital fallback that only
 * counts while the stick is inside its dead zone, so the two can never fight over the same axis. Opposite D-pad
 * directions cancel.
 */
export function padToInput(snapshot: GamepadSnapshot, held: ReadonlySet<PadButton> = heldButtons(snapshot)): PlayerInput {
  const spec = LAYOUTS[layoutOf(snapshot)];
  let rotate = stickAxis(snapshot.axes[spec.axisX]);
  let move = -stickAxis(snapshot.axes[spec.axisY]);
  if (rotate === 0) rotate = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  if (move === 0) move = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
  return {
    rotate: rotate + 0, // `+ 0` turns -0 into 0
    move: move + 0,
    shoot: held.has('trigger') || held.has('a'),
    laser: held.has('x'),
    boost: held.has('b'),
  };
}

/**
 * Combines the commands of two devices that drive the same ship (a keyboard and a pad). Policy, per axis: if the keyboard
 * is pushing that axis it wins outright, otherwise the pad's analogue value is used, so steering can never be contradictory
 * and a keyboard player always has full authority. Buttons (shoot / laser / boost) are simply OR-ed.
 */
export function mergeInputs(keyboard: PlayerInput, pad: PlayerInput): PlayerInput {
  return {
    rotate: keyboard.rotate !== 0 ? keyboard.rotate : pad.rotate,
    move: keyboard.move !== 0 ? keyboard.move : pad.move,
    shoot: keyboard.shoot || pad.shoot,
    laser: !!(keyboard.laser || pad.laser),
    boost: !!(keyboard.boost || pad.boost),
  };
}

/** Shortens a browser gamepad id for display: `Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e ...)` -> `Xbox 360 Controller`. */
export function shortPadName(id: string, max = 26): string {
  const name = id.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Controller';
  return name.length > max ? `${name.slice(0, max - 1)}~` : name;
}

/** Text for the "view the controller mapping" screen and for the docs: what each control does, in game terms. */
export const PAD_MAPPING_LINES: readonly string[] = [
  'LEFT STICK  left / right  -  Rotate  (push harder = turn faster)',
  'LEFT STICK  up / down     -  Forward / Backward',
  'D-PAD  -  Rotate / Move when the stick is centred',
  'RT or A  -  Shoot (hold to keep firing)',
  'X  -  Laser Beam         B  -  Boost',
  'START  -  Pause / Resume',
  'Paused: D-PAD moves, A selects, B goes back, BACK = Main Menu',
  'After Game Over: A  -  Retry        BACK  -  Main Menu',
];

export const PAD_MENU_LINES: readonly string[] = [
  'Any button wakes a controller; then press:',
  'LB = Player 1      RB = Player 2      A = join, or press the lit button',
  'D-PAD = move around the menu      B = back      X = next music track      Y = Controls',
];
