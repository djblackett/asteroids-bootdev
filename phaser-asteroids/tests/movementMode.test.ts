import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVEMENT,
  LEGACY_STEERING_STORAGE_KEY,
  migrateLegacySteering,
  MOVEMENT_LABELS,
  MOVEMENT_MODES,
  MOVEMENT_STORAGE_KEY,
  MovementController,
  parseStoredMovement,
} from '../src/input/movementMode';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError');
  },
  setItem(): void {
    throw new Error('QuotaExceededError');
  },
};

describe('movement mode: Classic D-Pad, Point-to-Fly or Assisted Flight', () => {
  it('offers exactly three modes, in menu order, each with a caption and an explanation', () => {
    expect(MOVEMENT_MODES).toEqual(['classic', 'pointToFly', 'assisted']);
    expect(MOVEMENT_MODES.map((m) => MOVEMENT_LABELS[m].name)).toEqual(['CLASSIC D-PAD', 'POINT-TO-FLY', 'ASSISTED FLIGHT']);
    for (const mode of MOVEMENT_MODES) expect(MOVEMENT_LABELS[mode].blurb.length).toBeGreaterThan(20);
    expect(new Set(MOVEMENT_MODES.map((m) => MOVEMENT_LABELS[m].blurb)).size).toBe(3);
  });

  it('starts as Classic D-Pad when nothing was ever chosen', () => {
    expect(DEFAULT_MOVEMENT).toBe('classic');
    expect(new MovementController(new MemoryStorage()).mode).toBe('classic');
  });

  it('keeps a saved choice, for each of the three modes', () => {
    for (const mode of MOVEMENT_MODES) {
      const storage = new MemoryStorage();
      storage.data.set(MOVEMENT_STORAGE_KEY, mode);
      expect(new MovementController(storage).mode).toBe(mode);
    }
  });

  it('remembers a choice for next time, in every direction', () => {
    const storage = new MemoryStorage();
    const first = new MovementController(storage);
    first.set('assisted');
    expect(storage.data.get(MOVEMENT_STORAGE_KEY)).toBe('assisted');
    expect(new MovementController(storage).mode).toBe('assisted');
    first.set('pointToFly');
    expect(new MovementController(storage).mode).toBe('pointToFly');
    first.set('classic');
    expect(new MovementController(storage).mode).toBe('classic');
  });

  it('ignores anything in storage that is not one of the three modes (falls back to Classic)', () => {
    for (const junk of ['', 'CLASSIC', 'dpad', 'joystick', 'point-to-fly', 'null', '1', '{"mode":"assisted"}', 'assisted ']) {
      const storage = new MemoryStorage();
      storage.data.set(MOVEMENT_STORAGE_KEY, junk);
      expect(new MovementController(storage).mode).toBe('classic');
    }
    expect(parseStoredMovement(null)).toBeNull();
    expect(parseStoredMovement(undefined)).toBeNull();
    expect(parseStoredMovement('pointToFly')).toBe('pointToFly');
  });

  it('works without storage, and with storage that throws (private windows): the choice applies for the visit', () => {
    for (const storage of [null, throwing]) {
      const c = new MovementController(storage);
      expect(c.mode).toBe('classic');
      expect(() => c.set('assisted')).not.toThrow();
      expect(c.mode).toBe('assisted');
    }
  });

  it('tells listeners about real changes only, and stops when unsubscribed', () => {
    const c = new MovementController(new MemoryStorage());
    const seen: string[] = [];
    const stop = c.onChange((mode) => seen.push(mode));
    c.set('classic'); // already Classic: no news
    c.set('pointToFly');
    c.set('pointToFly');
    c.set('assisted');
    c.set('classic');
    expect(seen).toEqual(['pointToFly', 'assisted', 'classic']);
    stop();
    c.set('assisted');
    expect(seen).toEqual(['pointToFly', 'assisted', 'classic']);
    expect(c.listenerCount).toBe(0);
  });

  it('does not write storage for a no-op', () => {
    const storage = new MemoryStorage();
    new MovementController(storage).set('classic');
    expect(storage.data.size).toBe(0);
  });
});

describe('legacy touchSteering preference migration', () => {
  it('a saved relative JOYSTICK is NOT reinterpreted as Point-to-Fly or Assisted Flight: it starts as Classic D-Pad', () => {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_STEERING_STORAGE_KEY, 'joystick');
    expect(new MovementController(storage).mode).toBe('classic');
    expect(migrateLegacySteering('joystick')).toBe('classic');
  });

  it('a saved D-PAD choice is the same control as Classic D-Pad', () => {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_STEERING_STORAGE_KEY, 'dpad');
    expect(new MovementController(storage).mode).toBe('classic');
  });

  it('an unrecognised legacy value is Classic too', () => {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_STEERING_STORAGE_KEY, 'nonsense');
    expect(new MovementController(storage).mode).toBe('classic');
  });

  it('the new key wins over the legacy one', () => {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_STEERING_STORAGE_KEY, 'joystick');
    storage.data.set(MOVEMENT_STORAGE_KEY, 'assisted');
    expect(new MovementController(storage).mode).toBe('assisted');
  });

  it('migrating never writes or deletes anything: the legacy value stays exactly as it was', () => {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_STEERING_STORAGE_KEY, 'joystick');
    new MovementController(storage);
    expect([...storage.data]).toEqual([[LEGACY_STEERING_STORAGE_KEY, 'joystick']]);
    // Only an explicit choice creates the new key.
    new MovementController(storage).set('pointToFly');
    expect(storage.data.get(LEGACY_STEERING_STORAGE_KEY)).toBe('joystick');
    expect(storage.data.get(MOVEMENT_STORAGE_KEY)).toBe('pointToFly');
  });
});
