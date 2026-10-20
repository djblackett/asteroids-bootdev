import type { PlayerInput } from '../core/player';
import type { GamepadHub } from './gamepadHub';
import { mergeInputs } from './gamepadMapping';
import type { HeldKeys } from './heldKeys';
import { readPlayerInput, type KeyScheme } from './keyboardControls';

/**
 * One normalised `PlayerInput` per player: that player's keyboard scheme, merged with the pad assigned to them (if any and
 * only while it is connected and armed). The simulation cannot tell the sources apart. `mergeInputs` holds the policy for
 * a player who has both: the keyboard wins an axis it is pushing, the pad's analogue value is used otherwise. When touch controls
 * are given, their command is merged in last under the same policy (their buttons are OR-ed; it is neutral when nobody is touching).
 */
export function readPlayerInputs(
  held: Pick<HeldKeys, 'isAnyDown'>,
  hub: Pick<GamepadHub, 'command'>,
  schemes: readonly KeyScheme[],
  touch?: { command(): PlayerInput },
): PlayerInput[] {
  const count = schemes.length === 2 ? 2 : 1;
  return schemes.map((scheme, i) => {
    const merged = mergeInputs(readPlayerInput(held, scheme), hub.command(i === 1 ? 1 : 0, count));
    // The touch screen drives Player 1 only (touch play is one-player); keyboard and pad keep the axes they push.
    return i === 0 && touch ? mergeInputs(merged, touch.command()) : merged;
  });
}
