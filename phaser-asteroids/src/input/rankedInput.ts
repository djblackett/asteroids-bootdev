import type { GamepadHub } from './gamepadHub';
import type { InputModeController } from './inputMode';

/** Browsers cannot enumerate keyboards. On a coarse-pointer device, a key press confirms one is available. */
export function rankedInputAvailable(mode: InputModeController, pads: GamepadHub, keyboardSeen: boolean): boolean {
  return mode.isTouch || !mode.env.coarsePrimaryPointer || keyboardSeen || pads.padFor(0, 1) !== null;
}
