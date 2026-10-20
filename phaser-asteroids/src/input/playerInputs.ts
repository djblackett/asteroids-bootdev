import type { PlayerInput } from '../core/player';
import type { GamepadHub } from './gamepadHub';
import { mergeInputs } from './gamepadMapping';
import type { HeldKeys } from './heldKeys';
import { readPlayerInput, type KeyScheme } from './keyboardControls';

/**
 * One normalised `PlayerInput` per player: that player's keyboard scheme, merged with the pad assigned to them (if any and
 * only while it is connected and armed). The simulation cannot tell the sources apart. `mergeInputs` holds the policy for
 * a player who has both: the keyboard wins an axis it is pushing, the pad's analogue value is used otherwise.
 */
export function readPlayerInputs(held: Pick<HeldKeys, 'isAnyDown'>, hub: Pick<GamepadHub, 'command'>, schemes: readonly KeyScheme[]): PlayerInput[] {
  const count = schemes.length === 2 ? 2 : 1;
  return schemes.map((scheme, i) => mergeInputs(readPlayerInput(held, scheme), hub.command(i === 1 ? 1 : 0, count)));
}
