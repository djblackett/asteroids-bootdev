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

describe('steering choice: joystick or D-pad', () => {
  it('starts as the joystick when nothing was ever chosen (no behaviour change for existing players)', () => {
    expect(DEFAULT_STEERING).toBe('joystick');
    expect(new SteeringController(new MemoryStorage()).mode).toBe('joystick');
  });

  it('remembers the choice for next time', () => {
    const storage = new MemoryStorage();
    const first = new SteeringController(storage);
    first.set('dpad');
    expect(first.mode).toBe('dpad');
    expect(storage.data.get(STEERING_STORAGE_KEY)).toBe('dpad');
    expect(new SteeringController(storage).mode).toBe('dpad'); // a new visit
    first.set('joystick');
    expect(new SteeringController(storage).mode).toBe('joystick');
  });

  it('ignores anything in storage that is not one of the two modes', () => {
    for (const junk of ['', 'DPAD', 'touch', 'null', '1', '{"mode":"dpad"}']) {
      const storage = new MemoryStorage();
      storage.data.set(STEERING_STORAGE_KEY, junk);
      expect(new SteeringController(storage).mode).toBe('joystick');
    }
    expect(parseStoredSteering(null)).toBeNull();
    expect(parseStoredSteering(undefined)).toBeNull();
    expect(parseStoredSteering('dpad')).toBe('dpad');
    expect(parseStoredSteering('joystick')).toBe('joystick');
  });

  it('works without storage, and with storage that throws (private windows): the choice applies for the visit', () => {
    for (const storage of [null, throwing]) {
      const c = new SteeringController(storage);
      expect(c.mode).toBe('joystick');
      expect(() => c.set('dpad')).not.toThrow();
      expect(c.mode).toBe('dpad');
    }
  });

  it('tells listeners about real changes only, and stops when unsubscribed', () => {
    const c = new SteeringController(new MemoryStorage());
    const seen: string[] = [];
    const stop = c.onChange((mode) => seen.push(mode));
    c.set('joystick'); // already joystick: no news
    c.set('dpad');
    c.set('dpad');
    c.set('joystick');
    expect(seen).toEqual(['dpad', 'joystick']);
    stop();
    c.set('dpad');
    expect(seen).toEqual(['dpad', 'joystick']);
    expect(c.listenerCount).toBe(0);
  });

  it('does not write storage for a no-op', () => {
    const storage = new MemoryStorage();
    new SteeringController(storage).set('joystick');
    expect(storage.data.size).toBe(0);
  });
});
