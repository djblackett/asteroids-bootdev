import { FIXED_DT, FIXED_TICK_RATE, MAX_ACCUMULATOR_DT } from './constants';

/**
 * Manages fixed-timestep simulation ticking in variable-refresh browser environments.
 *
 * Requirements addressed:
 * 1. Independent of refresh rate (60Hz, 90Hz, 120Hz, 144Hz devices produce the same ticks).
 * 2. Pausing freezes the accumulator; no ticks advance while paused.
 * 3. Tab suspension/blur and frame stalls are capped at `maxAccumulatorDt` (0.25s / 15 ticks max),
 *    preventing the spiral of death while preserving deterministic consecutive tick advancement.
 */
export class FixedStepRunner {
  private accumulator = 0;
  private currentTick = 0;
  private isPaused = false;

  constructor(
    readonly tickRate: number = FIXED_TICK_RATE,
    readonly fixedDt: number = FIXED_DT,
    readonly maxAccumulatorDt: number = MAX_ACCUMULATOR_DT,
  ) {}

  get tick(): number {
    return this.currentTick;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (paused) {
      // Discard accumulated time immediately on pause
      this.accumulator = 0;
    }
  }

  /**
   * Advances the clock by `frameDt` seconds.
   *
   * @param frameDt Real elapsed wall-clock seconds since the last frame.
   * @param onTick Callback executed for each discrete simulation tick.
   * @returns Number of ticks executed in this update.
   */
  update(frameDt: number, onTick: (tick: number, fixedDt: number) => void): number {
    if (this.isPaused || frameDt <= 0) return 0;

    // Policy: Frame stalls and tab suspension deltas are clamped to prevent
    // large catch-up bursts ("spiral of death").
    const delta = Math.min(frameDt, this.maxAccumulatorDt);
    this.accumulator += delta;

    let ticksExecuted = 0;
    while (this.accumulator >= this.fixedDt - 1e-9) {
      onTick(this.currentTick, this.fixedDt);
      this.currentTick++;
      this.accumulator -= this.fixedDt;
      ticksExecuted++;
    }
    if (Math.abs(this.accumulator) < 1e-9) {
      this.accumulator = 0;
    }

    return ticksExecuted;
  }

  reset(startTick = 0): void {
    this.accumulator = 0;
    this.currentTick = startTick;
    this.isPaused = false;
  }
}
