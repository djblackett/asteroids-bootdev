import type { AudioDirector } from '../../audio/phaserAudio';
import type { GameSetup } from '../../gameSetup';
import type { HapticManager } from '../../haptics/hapticManager';
import type { GamepadHub } from '../../input/gamepadHub';
import type { InputModeController } from '../../input/inputMode';
import type { SteeringController } from '../../input/steeringMode';

/**
 * Everything the menu pages need to read or change, handed over by the scene that shows them. The title screen and the pause screen
 * build their pages from the same context type, so a setting is written once and works in both places; what differs between them is
 * only `where` and which of the `actions` exist.
 */
export interface MenuContext {
  /** The title screen (before a run) or the pause screen (during one). Pages hide what cannot change mid-run. */
  readonly where: 'title' | 'pause';
  readonly audio: AudioDirector;
  readonly haptics: HapticManager;
  readonly inputMode: InputModeController;
  readonly steering: SteeringController;
  readonly pads: GamepadHub;
  /** The title screen's choices (also what the current run was started with). */
  setup(): GameSetup;
  /** Title screen only: changes the choices (a no-op while paused). */
  patchSetup(change: (setup: GameSetup) => GameSetup): void;
  setPlayers(count: 1 | 2): void;
  /** Milliseconds, for short-lived labels (a vibration test result). */
  now(): number;
  readonly actions: {
    /** Title: starts the run. */
    play(): void;
    /** Pause: resumes the run. */
    resume(): void;
    /** Pause: abandons the run and shows the title screen. */
    toMenu(): void;
    /** Title: flips between touch and keyboard / controller controls (the page is rebuilt for the new mode). */
    switchInputMode(): void;
  };
}

/** Whether the on-screen touch controls are the active input (a phone's normal state). Their menus and help are about fingers, not keys. */
export const isTouchUi = (ctx: MenuContext): boolean => ctx.inputMode.isTouch;

/** What a page can do to the menu around it: open a submenu, or go back to the page it came from. */
export interface PageNav {
  open(id: string): void;
  back(): void;
}
