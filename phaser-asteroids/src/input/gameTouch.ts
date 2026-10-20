import Phaser from 'phaser';
import { browserStorage } from '../audio/audioSettings';
import { TouchOverlay } from '../ui/touchOverlay';
import { browserInputEnvironment, InputModeController } from './inputMode';
import { TouchControls } from './touchControls';

const TOUCH_REGISTRY_KEY = 'touchControls';
const MODE_REGISTRY_KEY = 'inputMode';

/**
 * Creates the one game-wide input-mode controller and touch control layer, and keeps them in step: touch controls exist exactly
 * while the mode is `touch`. Created once in BootScene; everything (DOM, window listeners) is removed when the game is destroyed.
 */
export function installTouchControls(game: Phaser.Game): { mode: InputModeController; touch: TouchControls } {
  const mode = new InputModeController(browserInputEnvironment(), window.location.search, browserStorage());
  const touch = new TouchControls(new TouchOverlay(document), window, document);
  touch.setActive(mode.isTouch);
  const stopModeEvents = mode.onChange((next) => touch.setActive(next === 'touch'));
  game.registry.set(MODE_REGISTRY_KEY, mode);
  game.registry.set(TOUCH_REGISTRY_KEY, touch);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    stopModeEvents();
    touch.destroy();
  });
  return { mode, touch };
}

export function getTouchControls(scene: Phaser.Scene): TouchControls {
  return scene.registry.get(TOUCH_REGISTRY_KEY) as TouchControls;
}

export function getInputMode(scene: Phaser.Scene): InputModeController {
  return scene.registry.get(MODE_REGISTRY_KEY) as InputModeController;
}
