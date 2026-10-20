/**
 * "Tap again to confirm" for an action that is costly to do by accident (here: leaving touch controls for the keyboard screen, which
 * hides every touch control). The first tap only arms it; a second tap within `windowMs` confirms; if nobody taps again the arming
 * lapses on its own. Time is passed in (the scene's clock), so it is a pure object, unit tested without Phaser or a real clock.
 */
export class ConfirmTap {
  private armedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowMs = 3000) {}

  /** A tap at time `now` (ms). Returns true when it confirms an earlier tap, false when it only arms. */
  tap(now: number): boolean {
    if (this.isArmed(now)) {
      this.armedAt = Number.NEGATIVE_INFINITY;
      return true;
    }
    this.armedAt = now;
    return false;
  }

  /** Whether a tap at `now` would confirm. */
  isArmed(now: number): boolean {
    return now - this.armedAt >= 0 && now - this.armedAt < this.windowMs;
  }

  disarm(): void {
    this.armedAt = Number.NEGATIVE_INFINITY;
  }
}
