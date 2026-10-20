import type Phaser from 'phaser';
import { browserGamepadReader, GamepadHub, type GamepadReader } from './gamepadHub';

const GAMEPAD_HUB_REGISTRY_KEY = 'gamepadHub';

/** Phaser's `Core.Events.PRE_STEP` and `DESTROY` values (plain strings, so this module needs no Phaser import and can be unit tested). */
export const PRE_STEP = 'prestep';
export const DESTROY = 'destroy';

/** The part of `Phaser.Game` the installer uses. */
export interface GameLike {
  events: { on(event: string, fn: () => void): unknown; once(event: string, fn: () => void): unknown; off(event: string, fn: () => void): unknown };
  registry: { set(key: string, value: unknown): unknown };
}

/** The target `installGamepadHub` listens on (the window in the browser; a fake in tests). */
interface PadHost extends EventTarget {
  performance?: { now(): number };
}

/**
 * Creates the one game-wide `GamepadHub`, polled once per frame before any scene updates, and wires the browser
 * lifecycle to it: losing focus, a hidden tab and regaining focus all make every pad neutral until its buttons have been
 * released (a held button is never reported again by the browser, so it must not be trusted after the gap), and
 * the browser's `gamepadconnected` / `gamepaddisconnected` events trigger an immediate extra poll. Everything is undone
 * when the game is destroyed. Scenes never add listeners of their own to the window for pads.
 */
export function installGamepadHub(
  game: GameLike,
  reader: GamepadReader = browserGamepadReader(),
  host: PadHost = window,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'> = document,
): GamepadHub {
  const hub = new GamepadHub(reader, () => host.performance?.now() ?? 0);
  game.registry.set(GAMEPAD_HUB_REGISTRY_KEY, hub);

  const poll = (): void => hub.poll();
  const onBlur = (): void => hub.disarmAll('window lost focus');
  const onFocus = (): void => hub.disarmAll('window regained focus');
  const onVisibility = (): void => hub.disarmAll(doc.hidden ? 'tab hidden' : 'tab visible again');
  game.events.on(PRE_STEP, poll);
  host.addEventListener('gamepadconnected', poll);
  host.addEventListener('gamepaddisconnected', poll);
  host.addEventListener('blur', onBlur);
  host.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', onVisibility);
  game.events.once(DESTROY, () => {
    game.events.off(PRE_STEP, poll);
    host.removeEventListener('gamepadconnected', poll);
    host.removeEventListener('gamepaddisconnected', poll);
    host.removeEventListener('blur', onBlur);
    host.removeEventListener('focus', onFocus);
    doc.removeEventListener('visibilitychange', onVisibility);
    hub.disarmAll('game destroyed');
  });
  return hub;
}

export function getGamepadHub(scene: Phaser.Scene): GamepadHub {
  return scene.registry.get(GAMEPAD_HUB_REGISTRY_KEY) as GamepadHub;
}
