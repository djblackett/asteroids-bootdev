/**
 * Android's system Back (button or gesture) inside the Capacitor app. Each scene registers what Back means while it is on screen; the
 * same in-game rules as Escape / the controller's BACK are reused, never re-implemented here:
 *
 *   title menu  -> `MenuController.back()` (close the open page; false on the root page)
 *   a run       -> `GameScene.goBack()` (pause, close a pause page, resume, leave a finished run; see `handleBack`)
 *
 * When the scene has nothing left to close (the title screen's root page, or no scene has registered yet) the answer is `exit`, and
 * the app goes to the background like any Android app on its first screen. A run in progress is never left by Back.
 *
 * Pure: no Phaser, no Capacitor. Browsers never call `dispatch` (they have no system Back), so nothing changes for them.
 */

/** @returns true when the game handled Back; false when there is nothing left to close. */
export type BackHandler = () => boolean;

export type BackDispatchResult = 'handled' | 'exit';

export class BackDispatcher {
  private handler: BackHandler | null = null;

  /**
   * Makes `handler` the meaning of Back. @returns a function that removes it again, and only it: a scene that shuts down after the
   * next scene has already registered cannot remove the newer handler.
   */
  setHandler(handler: BackHandler): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  get hasHandler(): boolean {
    return this.handler !== null;
  }

  dispatch(): BackDispatchResult {
    const handler = this.handler;
    if (!handler) return 'exit';
    try {
      return handler() ? 'handled' : 'exit';
    } catch (e) {
      // A broken handler must not turn Back into "leave the app" in the middle of a run.
      console.warn('[asteroids] Back handler failed', e);
      return 'handled';
    }
  }
}

/** The one dispatcher for the game (like `rankedSession`): scenes come and go, the native listener stays. */
export const nativeBack = new BackDispatcher();
