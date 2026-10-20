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
 * Player 1 in a two-player game: the Python WASD cluster only. Arrow keys and Right Shift belong to Player 2 there, so
 * (unlike `SOLO_KEYS`) they are not accepted here.
 */
export const P1_KEYS: KeyScheme = {
  rotateLeft: ['KeyA'],
  rotateRight: ['KeyD'],
  forward: ['KeyW'],
  backward: ['KeyS'],
  shoot: ['Space'],
  laser: ['KeyE'],
  boost: ['ShiftLeft'],
};

/**
 * Player 2, Python's "keyboard_2" layout: arrows + Enter to shoot + Right Shift for the laser. Python's boost key, Right
 * Ctrl, is replaced by `.` (Period): in a browser Ctrl + W / T / N / Q close the tab or window and cannot be cancelled by a
 * page, and Player 1 holds W all the time. (`NumpadEnter` also shoots.)
 */
export const P2_KEYS_ARROWS: KeyScheme = {
  rotateLeft: ['ArrowLeft'],
  rotateRight: ['ArrowRight'],
  forward: ['ArrowUp'],
  backward: ['ArrowDown'],
  shoot: ['Enter', 'NumpadEnter'],
  laser: ['ShiftRight'],
  boost: ['Period'],
};

/**
 * An alternative for Player 2 when the arrow cluster ghosts or Enter / Right Shift will not register together with the
 * arrows: the right hand on I J K L (forward / left / back / right), `;` to shoot, U laser, O boost. None of these
 * collide with Player 1's keys or with pause (P), mute (M), retry (R) and menu (Esc).
 */
export const P2_KEYS_IJKL: KeyScheme = {
  rotateLeft: ['KeyJ'],
  rotateRight: ['KeyL'],
  forward: ['KeyI'],
  backward: ['KeyK'],
  shoot: ['Semicolon'],
  laser: ['KeyU'],
  boost: ['KeyO'],
};

export type P2KeyLayout = 'arrows' | 'ijkl';
export const P2_KEY_LAYOUTS: Readonly<Record<P2KeyLayout, KeyScheme>> = { arrows: P2_KEYS_ARROWS, ijkl: P2_KEYS_IJKL };

/** The key scheme of every player in a game, in player order. */
export function keySchemesFor(playerCount: 1 | 2, layout: P2KeyLayout = 'arrows'): readonly KeyScheme[] {
  return playerCount === 1 ? [SOLO_KEYS] : [P1_KEYS, P2_KEY_LAYOUTS[layout]];
}

/** Every `KeyboardEvent.code` a scheme listens to. */
export function schemeCodes(scheme: KeyScheme): string[] {
  return [...scheme.rotateLeft, ...scheme.rotateRight, ...scheme.forward, ...scheme.backward, ...scheme.shoot, ...scheme.laser, ...scheme.boost];
}

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
