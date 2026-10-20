/**
 * "Tap again to confirm" for an action that is costly to do by accident (leaving touch controls for the keyboard screen, which hides
 * every touch control; abandoning a paused run). The first tap only arms it; a second tap within `windowMs` confirms; if nobody taps again the arming
 * lapses on its own. A second touch less than `minGapMs` after the first is part of the same accidental contact (two fingers or a palm
 * landing together, a bouncing thumb), not a confirmation: it is ignored and the question stays up. Time is passed in (the scene's
 * clock), so it is a pure object, unit tested without Phaser or a real clock.
 */
export const CONFIRM_MIN_GAP_MS = 300;

export class ConfirmTap {
  private armedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs = 3000,
    private readonly minGapMs = CONFIRM_MIN_GAP_MS,
  ) {}

  /** A tap at time `now` (ms). Returns true when it confirms an earlier tap, false when it only arms (or comes too soon to count). */
  tap(now: number): boolean {
    const since = now - this.armedAt;
    if (since >= 0 && since < this.minGapMs) return false;
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
