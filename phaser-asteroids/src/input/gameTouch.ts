import Phaser from 'phaser';
import { browserStorage } from '../audio/audioSettings';
import { SystemOverlay } from '../ui/systemOverlay';
import { TouchOverlay } from '../ui/touchOverlay';
import { browserFullscreenEnvironment, FullscreenController } from './fullscreen';
import { browserInputEnvironment, InputModeController } from './inputMode';
import { MovementController } from './movementMode';
import { TouchControls } from './touchControls';

const TOUCH_REGISTRY_KEY = 'touchControls';
const MODE_REGISTRY_KEY = 'inputMode';
const MOVEMENT_REGISTRY_KEY = 'touchMovement';
const FULLSCREEN_REGISTRY_KEY = 'fullscreen';

/** Entering or leaving fullscreen resizes the page; some browsers finish after the event, so the canvas is re-fitted a few times. */
const REFIT_DELAYS_MS = [0, 120, 400];

/**
 * Creates the one game-wide input-mode controller, steering choice, fullscreen controller and touch control layer, and keeps them
 * in step: touch controls exist exactly while the mode is `touch`, and the movement mode (D-pad or one of the two joystick modes) follows the saved choice. Created
 * once in BootScene; everything (DOM, window listeners, timers) is removed when the game is destroyed.
 */
export function installTouchControls(game: Phaser.Game): {
  mode: InputModeController;
  touch: TouchControls;
  movement: MovementController;
  fullscreen: FullscreenController;
} {
  const storage = browserStorage();
  const mode = new InputModeController(browserInputEnvironment(), window.location.search, storage);
  const movement = new MovementController(storage);
  const fullscreen = new FullscreenController(browserFullscreenEnvironment());
  const touch = new TouchControls(new TouchOverlay(document, new SystemOverlay(document, fullscreen)), window, document);
  touch.setMovement(movement.mode);
  touch.setActive(mode.isTouch);
  const stopModeEvents = mode.onChange((next) => touch.setActive(next === 'touch'));
  const stopMovementEvents = movement.onChange((next) => touch.setMovement(next));

  // The page just changed size. The overlay is CSS (fixed to the viewport) and follows by itself; the canvas needs Phaser to re-fit.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stopFullscreenEvents = fullscreen.onChange(() => {
    for (const delay of REFIT_DELAYS_MS) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        game.scale.refresh();
      }, delay);
      timers.add(timer);
    }
  });

  game.registry.set(MODE_REGISTRY_KEY, mode);
  game.registry.set(TOUCH_REGISTRY_KEY, touch);
  game.registry.set(MOVEMENT_REGISTRY_KEY, movement);
  game.registry.set(FULLSCREEN_REGISTRY_KEY, fullscreen);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    stopModeEvents();
    stopMovementEvents();
    stopFullscreenEvents();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    fullscreen.destroy();
    touch.destroy();
  });
  return { mode, touch, movement, fullscreen };
}

export function getTouchControls(scene: Phaser.Scene): TouchControls {
  return scene.registry.get(TOUCH_REGISTRY_KEY) as TouchControls;
}

export function getInputMode(scene: Phaser.Scene): InputModeController {
  return scene.registry.get(MODE_REGISTRY_KEY) as InputModeController;
}

export function getMovement(scene: Phaser.Scene): MovementController {
  return scene.registry.get(MOVEMENT_REGISTRY_KEY) as MovementController;
}
