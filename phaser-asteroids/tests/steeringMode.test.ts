import { describe, expect, it } from 'vitest';
import { DEFAULT_STEERING, parseStoredSteering, STEERING_STORAGE_KEY, SteeringController } from '../src/input/steeringMode';

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

describe('steering choice: D-pad or joystick', () => {
  it('starts as the D-pad when nothing was ever chosen', () => {
    expect(DEFAULT_STEERING).toBe('dpad');
    expect(new SteeringController(new MemoryStorage()).mode).toBe('dpad');
  });

  it('never overrides a saved choice: a player who explicitly chose the joystick keeps it', () => {
    const storage = new MemoryStorage();
    storage.data.set(STEERING_STORAGE_KEY, 'joystick'); // saved before the default changed, or chosen since
    expect(new SteeringController(storage).mode).toBe('joystick');
    // ...and it is still there after the controller has been created and used.
    const c = new SteeringController(storage);
    c.set('joystick');
    expect(storage.data.get(STEERING_STORAGE_KEY)).toBe('joystick');
    expect(new SteeringController(storage).mode).toBe('joystick');
  });

  it('a saved D-pad choice is kept too', () => {
    const storage = new MemoryStorage();
    storage.data.set(STEERING_STORAGE_KEY, 'dpad');
    expect(new SteeringController(storage).mode).toBe('dpad');
  });

  it('remembers a choice for next time, in both directions', () => {
    const storage = new MemoryStorage();
    const first = new SteeringController(storage);
    first.set('joystick');
    expect(first.mode).toBe('joystick');
    expect(storage.data.get(STEERING_STORAGE_KEY)).toBe('joystick');
    expect(new SteeringController(storage).mode).toBe('joystick'); // a new visit
    first.set('dpad');
    expect(storage.data.get(STEERING_STORAGE_KEY)).toBe('dpad');
    expect(new SteeringController(storage).mode).toBe('dpad');
  });

  it('ignores anything in storage that is not one of the two modes (falls back to the D-pad)', () => {
    for (const junk of ['', 'DPAD', 'touch', 'null', '1', '{"mode":"joystick"}']) {
      const storage = new MemoryStorage();
      storage.data.set(STEERING_STORAGE_KEY, junk);
      expect(new SteeringController(storage).mode).toBe('dpad');
    }
    expect(parseStoredSteering(null)).toBeNull();
    expect(parseStoredSteering(undefined)).toBeNull();
    expect(parseStoredSteering('dpad')).toBe('dpad');
    expect(parseStoredSteering('joystick')).toBe('joystick');
  });

  it('works without storage, and with storage that throws (private windows): the choice applies for the visit', () => {
    for (const storage of [null, throwing]) {
      const c = new SteeringController(storage);
      expect(c.mode).toBe('dpad');
      expect(() => c.set('joystick')).not.toThrow();
      expect(c.mode).toBe('joystick');
    }
  });

  it('tells listeners about real changes only, and stops when unsubscribed', () => {
    const c = new SteeringController(new MemoryStorage());
    const seen: string[] = [];
    const stop = c.onChange((mode) => seen.push(mode));
    c.set('dpad'); // already the D-pad: no news
    c.set('joystick');
    c.set('joystick');
    c.set('dpad');
    expect(seen).toEqual(['joystick', 'dpad']);
    stop();
    c.set('joystick');
    expect(seen).toEqual(['joystick', 'dpad']);
    expect(c.listenerCount).toBe(0);
  });

  it('does not write storage for a no-op', () => {
    const storage = new MemoryStorage();
    new SteeringController(storage).set('dpad');
    expect(storage.data.size).toBe(0);
  });
});
