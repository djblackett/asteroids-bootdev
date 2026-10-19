import { MUSIC_MAX_GAIN, VOLUME_STEP } from './audioConfig';

/** The two user-adjustable volumes. Mute is separate (it only affects the music, as before). */
export type VolumeChannel = 'music' | 'sfx';

/** The part of `Storage` the settings need, so tests can pass a fake and blocked storage can be `null`. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Forces a setting into 0..1 and onto the 1 % grid (no 0.30000000000000004). Garbage becomes `fallback`. */
export function clampVolume(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/** One press of the pause-screen control: a whole `VOLUME_STEP` up or down, snapping off-grid values first. */
export function stepVolume(value: number, direction: 1 | -1): number {
  const steps = Math.round(clampVolume(value) / VOLUME_STEP);
  return clampVolume((steps + direction) * VOLUME_STEP);
}

/** Actual music gain for a Music setting. */
export function musicGain(setting: number): number {
  return clampVolume(setting) * MUSIC_MAX_GAIN;
}

export function formatPercent(setting: number): string {
  return `${Math.round(clampVolume(setting) * 100)}%`;
}

/** `window.localStorage`, or null where merely touching it throws (blocked cookies, some private modes). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadVolume(storage: StorageLike | null, key: string, fallback: number): number {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined || raw.trim() === '') return fallback;
    return clampVolume(Number(raw), fallback);
  } catch {
    return fallback;
  }
}

export function saveVolume(storage: StorageLike | null, key: string, value: number): void {
  try {
    storage?.setItem(key, String(clampVolume(value)));
  } catch {
    // Private mode / blocked or full storage: the setting simply is not remembered.
  }
}

export function loadFlag(storage: StorageLike | null, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function saveFlag(storage: StorageLike | null, key: string, value: boolean): void {
  try {
    storage?.setItem(key, value ? '1' : '0');
  } catch {
    // Not remembered; see saveVolume.
  }
}
