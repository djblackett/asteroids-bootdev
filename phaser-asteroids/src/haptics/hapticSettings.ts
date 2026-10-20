/**
 * The HAPTICS: ON / OFF choice. Remembered in localStorage (`asteroids.haptics`, "1" / "0", the same convention as the music mute);
 * anything else in storage is ignored, and blocked storage just means the choice is not remembered. It is OFF until the player
 * deliberately turns it on (an experimental feature, and a phone that buzzes unasked is a bad surprise).
 *
 * Same shape as `SteeringController`: a tiny holder with `set`, `onChange`, no DOM and no Phaser.
 */

import type { StorageLike } from '../audio/audioSettings';

export const HAPTICS_STORAGE_KEY = 'asteroids.haptics';

export const DEFAULT_HAPTICS_ENABLED = false;

export function parseStoredHaptics(raw: string | null | undefined): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

export class HapticSettings {
  private current: boolean;
  private readonly listeners = new Set<(enabled: boolean) => void>();

  constructor(private readonly storage: StorageLike | null) {
    this.current = this.readStored() ?? DEFAULT_HAPTICS_ENABLED;
  }

  get enabled(): boolean {
    return this.current;
  }

  /** The player's explicit choice: applied now and remembered for next time. */
  set(enabled: boolean): void {
    if (enabled === this.current) return;
    this.current = enabled;
    this.writeStored(enabled);
    for (const listener of [...this.listeners]) listener(enabled);
  }

  toggle(): boolean {
    this.set(!this.current);
    return this.current;
  }

  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private readStored(): boolean | null {
    try {
      return parseStoredHaptics(this.storage?.getItem(HAPTICS_STORAGE_KEY));
    } catch {
      return null; // storage blocked: the choice just is not remembered
    }
  }

  private writeStored(enabled: boolean): void {
    try {
      this.storage?.setItem(HAPTICS_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // not remembered; the choice still applies for this visit
    }
  }
}
