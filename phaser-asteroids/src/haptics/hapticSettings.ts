/**
 * The HAPTICS: ON / OFF choice. Remembered in localStorage (`asteroids.haptics`, "1" / "0", the same convention as the music mute);
 * anything else in storage is ignored, and blocked storage just means the choice is not remembered. It is ON for a player who has
 * never chosen (after real-phone testing the feedback is a clear improvement) and a saved choice always wins: someone who turned it OFF
 * stays OFF, and nothing is ever written to storage until the player actually changes the switch. Nothing buzzes just because a menu is
 * on screen: only gameplay events (touch mode, a run in progress) and the TEST VIBRATION button ask for a vibration.
 *
 * Same shape as `SteeringController`: a tiny holder with `set`, `onChange`, no DOM and no Phaser.
 */

import type { StorageLike } from '../audio/audioSettings';

export const HAPTICS_STORAGE_KEY = 'asteroids.haptics';

/** What a player who has never chosen gets. */
export const DEFAULT_HAPTICS_ENABLED = true;

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
