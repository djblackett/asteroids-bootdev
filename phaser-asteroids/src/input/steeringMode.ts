/**
 * Which touch steering control the player uses: the floating analogue `joystick` or the fixed digital `dpad`. The choice is
 * remembered in localStorage (`asteroids.touchSteering`); anything else in storage is ignored, so a stale or hand-edited value can
 * never leave the game with no way to steer. Blocked storage (private windows) just means the choice is not remembered.
 *
 * Same shape as `InputModeController`: a tiny holder with `set`, `onChange` and no DOM or Phaser, unit tested with a fake storage.
 */

import type { StorageLike } from '../audio/audioSettings';
import type { SteeringMode } from './touchModel';

export const STEERING_STORAGE_KEY = 'asteroids.touchSteering';

/** What a player who has never chosen gets. The joystick is the original control; the D-pad is one tap away on the title and pause screens. */
export const DEFAULT_STEERING: SteeringMode = 'joystick';

export function parseStoredSteering(raw: string | null | undefined): SteeringMode | null {
  return raw === 'joystick' || raw === 'dpad' ? raw : null;
}

export class SteeringController {
  private current: SteeringMode;
  private readonly listeners = new Set<(mode: SteeringMode) => void>();

  constructor(private readonly storage: StorageLike | null) {
    this.current = this.readStored() ?? DEFAULT_STEERING;
  }

  get mode(): SteeringMode {
    return this.current;
  }

  /** The player's explicit choice: applied now and remembered for next time. */
  set(mode: SteeringMode): void {
    if (mode === this.current) return;
    this.current = mode;
    this.writeStored(mode);
    for (const listener of [...this.listeners]) listener(mode);
  }

  onChange(listener: (mode: SteeringMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private readStored(): SteeringMode | null {
    try {
      return parseStoredSteering(this.storage?.getItem(STEERING_STORAGE_KEY));
    } catch {
      return null; // storage blocked: the choice just is not remembered
    }
  }

  private writeStored(mode: SteeringMode): void {
    try {
      this.storage?.setItem(STEERING_STORAGE_KEY, mode);
    } catch {
      // not remembered; the mode still applies for this visit
    }
  }
}
