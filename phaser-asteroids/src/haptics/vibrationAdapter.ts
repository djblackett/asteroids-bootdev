/**
 * The only place that talks to the browser's Vibration API. Everything above it (the haptic manager, the menus) sees this small interface,
 * so tests use a recording fake, and controller rumble can later be added as a second adapter without touching the event mapping.
 */
export interface VibrationAdapter {
  /** Whether the API exists at all. True does NOT prove the phone has a motor, or that the browser will allow it right now. */
  readonly supported: boolean;
  /** Starts a vibration, replacing any running one. @returns false if there is no API or the browser refused (no user gesture yet, ...). Never throws. */
  vibrate(pattern: number | readonly number[]): boolean;
  /** Stops a running vibration (`navigator.vibrate(0)`). Never throws. */
  cancel(): void;
}

/** The slice of `Navigator` used here. */
export interface VibrateNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

/** `navigator.vibrate`, if the browser has it: Android Chrome / Firefox. iPhone Safari has no such function and simply gets `supported === false`. */
export class NavigatorVibrationAdapter implements VibrationAdapter {
  constructor(private readonly nav: VibrateNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator) {}

  get supported(): boolean {
    return typeof this.nav?.vibrate === 'function';
  }

  vibrate(pattern: number | readonly number[]): boolean {
    if (!this.nav || typeof this.nav.vibrate !== 'function') return false;
    try {
      return this.nav.vibrate(typeof pattern === 'number' ? pattern : [...pattern]) === true;
    } catch {
      return false; // some embedders throw instead of returning false
    }
  }

  cancel(): void {
    if (!this.nav || typeof this.nav.vibrate !== 'function') return;
    try {
      this.nav.vibrate(0);
    } catch {
      // nothing to stop, or the browser will not say
    }
  }
}
