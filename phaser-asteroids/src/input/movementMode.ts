/**
 * Which way the player flies the ship on a touch screen. Three choices, offered side by side on the CONTROLS page:
 *
 *   classic      the fixed D-pad: rotate left / right, thrust forward (the original controls, unchanged; the default).
 *   pointToFly   the floating stick names the heading the ship should face; it turns toward it and flies along its nose.
 *   assisted     the same stick names where to travel; the nose turns toward it and the flight direction is steered there faster.
 *
 * The choice is remembered in localStorage (`asteroids.touchMovement`); anything else in storage is ignored, so a stale or
 * hand-edited value can never leave the game with no way to steer. Blocked storage (private windows) just means the choice is not
 * remembered.
 *
 * Migration. Before this experiment the choice was `asteroids.touchSteering` = `dpad` | `joystick`, where `joystick` was a *relative*
 * analogue stick (left / right rotates, up thrusts). That is not either of the new absolute-direction stick modes, so it is never
 * reinterpreted as one: a saved `joystick` (and a saved `dpad`) both start as Classic D-Pad, the experiment's control group (see
 * `migrateLegacySteering`). The old key is left alone, not read again and not deleted, so a build that still uses it is unaffected.
 *
 * Same shape as `InputModeController`: a tiny holder with `set`, `onChange` and no DOM or Phaser, unit tested with a fake storage.
 */

import type { StorageLike } from '../audio/audioSettings';

export type MovementMode = 'classic' | 'pointToFly' | 'assisted';

export const MOVEMENT_MODES: readonly MovementMode[] = ['classic', 'pointToFly', 'assisted'];

export const MOVEMENT_STORAGE_KEY = 'asteroids.touchMovement';

/** The key the D-pad / relative-joystick choice was saved under before the movement experiment. Read for documentation and tests only. */
export const LEGACY_STEERING_STORAGE_KEY = 'asteroids.touchSteering';

/** What a player who has never chosen gets: the original D-pad, so the new modes are opt-in while they are being compared. */
export const DEFAULT_MOVEMENT: MovementMode = 'classic';

/** What the CONTROLS page prints for each mode: the button caption and the one-line explanation of the lit one. */
export const MOVEMENT_LABELS: Readonly<Record<MovementMode, { name: string; blurb: string }>> = {
  classic: { name: 'CLASSIC D-PAD', blurb: 'Rotate and thrust with the D-pad. The original controls.' },
  pointToFly: { name: 'POINT-TO-FLY', blurb: 'Point where you want the ship to face. It turns that way and flies.' },
  assisted: { name: 'ASSISTED FLIGHT', blurb: 'Point where you want to go. The ship turns and steers its flight toward it.' },
};

export function parseStoredMovement(raw: string | null | undefined): MovementMode | null {
  return MOVEMENT_MODES.find((mode) => mode === raw) ?? null;
}

/**
 * A pre-experiment `asteroids.touchSteering` value -> the movement mode it starts as. Always Classic D-Pad: `dpad` is exactly that
 * control, and the relative `joystick` is not offered any more and must not pass as Point-to-Fly or Assisted Flight.
 */
export function migrateLegacySteering(_raw: string | null | undefined): MovementMode {
  return 'classic';
}

export class MovementController {
  private current: MovementMode;
  private readonly listeners = new Set<(mode: MovementMode) => void>();

  constructor(private readonly storage: StorageLike | null) {
    this.current = this.readStored() ?? this.readLegacy() ?? DEFAULT_MOVEMENT;
  }

  get mode(): MovementMode {
    return this.current;
  }

  /** The player's explicit choice: applied now and remembered for next time. */
  set(mode: MovementMode): void {
    if (mode === this.current) return;
    this.current = mode;
    this.writeStored(mode);
    for (const listener of [...this.listeners]) listener(mode);
  }

  onChange(listener: (mode: MovementMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private readStored(): MovementMode | null {
    try {
      return parseStoredMovement(this.storage?.getItem(MOVEMENT_STORAGE_KEY));
    } catch {
      return null; // storage blocked: the choice just is not remembered
    }
  }

  /** Only consulted when nothing is saved under the new key. Nothing is written back, so the legacy value stays as it was. */
  private readLegacy(): MovementMode | null {
    try {
      const raw = this.storage?.getItem(LEGACY_STEERING_STORAGE_KEY);
      return raw === null || raw === undefined ? null : migrateLegacySteering(raw);
    } catch {
      return null;
    }
  }

  private writeStored(mode: MovementMode): void {
    try {
      this.storage?.setItem(MOVEMENT_STORAGE_KEY, mode);
    } catch {
      // not remembered; the mode still applies for this visit
    }
  }
}
