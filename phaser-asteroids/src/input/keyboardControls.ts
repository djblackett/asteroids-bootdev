import type { PlayerInput } from '../core/player';
import type { HeldKeys } from './heldKeys';

/** Physical key names (`KeyboardEvent.code`) for each continuous control. */
export interface KeyScheme {
  rotateLeft: readonly string[];
  rotateRight: readonly string[];
  forward: readonly string[];
  backward: readonly string[];
  shoot: readonly string[];
  laser: readonly string[];
  boost: readonly string[];
}

/** Player 1 as in the Python game (WASD + Space). Arrow keys are accepted too while there is only one player. */
export const SOLO_KEYS: KeyScheme = {
  rotateLeft: ['KeyA', 'ArrowLeft'],
  rotateRight: ['KeyD', 'ArrowRight'],
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  shoot: ['Space'],
  laser: ['KeyE'],
  boost: ['ShiftLeft', 'ShiftRight'],
};

/**
 * Converts the held keys into the simulation's `PlayerInput`. Mirrors Python's `Player.update`: every control is
 * checked on its own (no else-if chain between turning, moving, shooting, laser and boost), and only *opposing*
 * keys share a result, where the later check (D / S) wins.
 */
export function readPlayerInput(held: Pick<HeldKeys, 'isAnyDown'>, scheme: KeyScheme = SOLO_KEYS): PlayerInput {
  let rotate = 0;
  if (held.isAnyDown(scheme.rotateLeft)) rotate = -1;
  if (held.isAnyDown(scheme.rotateRight)) rotate = 1;
  let move = 0;
  if (held.isAnyDown(scheme.forward)) move = 1;
  if (held.isAnyDown(scheme.backward)) move = -1;
  return {
    rotate,
    move,
    shoot: held.isAnyDown(scheme.shoot),
    laser: held.isAnyDown(scheme.laser),
    boost: held.isAnyDown(scheme.boost),
  };
}
