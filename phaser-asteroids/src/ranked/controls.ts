import type { PlayerInput } from '../core/player';
import type { MovementMode } from '../input/movementMode';

/**
 * The control scheme reported alongside a ranked run, for later fairness analysis (keyboard vs touch vs pad). It is INFORMATIONAL and
 * UNTRUSTED: a modified client can send any value, and the server never uses it to accept, reject or rank a score.
 */
export type ControlScheme = 'keyboard' | 'gamepad' | 'touch-classic' | 'touch-point' | 'touch-assisted' | 'mixed' | 'unknown';

const TOUCH_SCHEME: Record<MovementMode, ControlScheme> = {
  classic: 'touch-classic',
  pointToFly: 'touch-point',
  assisted: 'touch-assisted',
};

/** Whether an input is doing anything (a pad or finger that is merely connected does not count as "used"). */
export function isActiveInput(input: PlayerInput): boolean {
  return input.rotate !== 0 || input.move !== 0 || input.shoot || !!input.laser || !!input.boost || !!input.steer;
}

/** Remembers which sources actually produced input during a run. One source -> that scheme; more than one -> `mixed`. */
export class ControlTracker {
  private readonly used = new Set<ControlScheme>();

  observe(sources: { keyboard: PlayerInput; gamepad: PlayerInput; touch: PlayerInput | null }, touchMovement: MovementMode): void {
    if (isActiveInput(sources.keyboard)) this.used.add('keyboard');
    if (isActiveInput(sources.gamepad)) this.used.add('gamepad');
    if (sources.touch && isActiveInput(sources.touch)) this.used.add(TOUCH_SCHEME[touchMovement]);
  }

  scheme(): ControlScheme {
    if (this.used.size === 0) return 'unknown';
    if (this.used.size === 1) return [...this.used][0]!;
    return 'mixed';
  }
}
