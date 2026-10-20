import Phaser from 'phaser';
import { browserStorage } from '../audio/audioSettings';
import { HapticManager } from './hapticManager';
import { HapticSettings } from './hapticSettings';
import { NavigatorVibrationAdapter } from './vibrationAdapter';

const HAPTICS_REGISTRY_KEY = 'haptics';

/**
 * Creates the one game-wide haptic manager (and its saved HAPTICS setting). Created once in BootScene, kept in the registry like the
 * audio director and the touch controls, so a retry or a trip to the title screen never builds a second one or a second set of
 * listeners. Asking again returns the first. Everything is removed when the game is destroyed.
 */
export function installHaptics(game: Phaser.Game): HapticManager {
  const existing = game.registry.get(HAPTICS_REGISTRY_KEY) as HapticManager | undefined;
  if (existing) return existing;
  const manager = new HapticManager({ adapter: new NavigatorVibrationAdapter(), settings: new HapticSettings(browserStorage()) });
  manager.attachLifecycle(window, document);
  game.registry.set(HAPTICS_REGISTRY_KEY, manager);
  game.events.once(Phaser.Core.Events.DESTROY, () => manager.dispose());
  return manager;
}

export function getHaptics(scene: Phaser.Scene): HapticManager {
  return scene.registry.get(HAPTICS_REGISTRY_KEY) as HapticManager;
}
