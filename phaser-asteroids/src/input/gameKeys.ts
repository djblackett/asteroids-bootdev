import Phaser from 'phaser';
import { HeldKeys } from './heldKeys';

const HELD_KEYS_REGISTRY_KEY = 'heldKeys';

/** Creates the one game-wide `HeldKeys`, listening on the window until the game is destroyed. */
export function installHeldKeys(game: Phaser.Game): HeldKeys {
  const held = new HeldKeys();
  const detach = held.attach(window, document);
  game.registry.set(HELD_KEYS_REGISTRY_KEY, held);
  game.events.once(Phaser.Core.Events.DESTROY, detach);
  return held;
}

export function getHeldKeys(scene: Phaser.Scene): HeldKeys {
  return scene.registry.get(HELD_KEYS_REGISTRY_KEY) as HeldKeys;
}
