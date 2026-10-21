/**
 * What Escape (and the controller's BACK button) means in a run, as one decision so the keyboard and the controller cannot drift apart:
 *
 *   playing            -> pause
 *   pause menu, root   -> resume
 *   pause menu, a page -> back to the page it came from (never resume, never leave)
 *   game over          -> the title screen (the run is already over; nothing is lost)
 *
 * Leaving a run in progress is never done from here: only the RETURN TO MENU button does that, after its second press.
 */
export interface BackEnv {
  /** The run has ended. */
  readonly gameOver: boolean;
  /** The game is paused (the pause menu is, or is about to be, on screen). */
  readonly paused: boolean;
  /** The pause menu has actually been built. The frame after a pause it has not, and a second press then has nothing to act on. */
  readonly menuShown: boolean;
  /** Closes the open pause sub-page; false when the menu is on its root page (nothing to close). */
  menuBack(): boolean;
  pause(): void;
  /** Resumes from the pause menu, quietening any cannon that is held (see `GameScene.resumeFromMenu`). */
  resume(): void;
  /** Ends the finished run and shows the title screen. */
  leaveFinishedRun(): void;
}

export type BackOutcome = 'paused' | 'resumed' | 'closed-page' | 'left' | 'ignored';

export function handleBack(env: BackEnv): BackOutcome {
  if (env.gameOver) {
    env.leaveFinishedRun();
    return 'left';
  }
  if (!env.paused) {
    env.pause();
    return 'paused';
  }
  if (!env.menuShown) return 'ignored';
  if (env.menuBack()) return 'closed-page';
  env.resume();
  return 'resumed';
}
