import { describe, expect, it } from 'vitest';
import {
  autoMode,
  browserInputEnvironment,
  INPUT_MODE_STORAGE_KEY,
  InputModeController,
  parseStoredMode,
  resolveInputMode,
  toggleOffered,
  urlOverride,
  type InputEnvironment,
} from '../src/input/inputMode';

const PHONE: InputEnvironment = { coarsePrimaryPointer: true, touchCapable: true };
const DESKTOP: InputEnvironment = { coarsePrimaryPointer: false, touchCapable: false };
const TOUCH_LAPTOP: InputEnvironment = { coarsePrimaryPointer: false, touchCapable: true };

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('automatic choice', () => {
  it('a phone or tablet (primary pointer is a finger) gets touch controls', () => {
    expect(autoMode(PHONE)).toBe('touch');
  });
  it('a desktop gets the keyboard game, and so does a touch-screen laptop whose primary pointer is the mouse / trackpad', () => {
    expect(autoMode(DESKTOP)).toBe('desktop');
    expect(autoMode(TOUCH_LAPTOP)).toBe('desktop');
  });
});

describe('URL override', () => {
  it.each([
    ['?touch=1', 'touch'],
    ['?touch=on', 'touch'],
    ['?touch=TRUE', 'touch'],
    ['?debug&touch=0', 'desktop'],
    ['?touch=off', 'desktop'],
    ['?touch=false', 'desktop'],
    ['?touch=auto', null],
    ['?touch=', null],
    ['?touch=banana', null],
    ['', null],
    ['?debug', null],
  ])('%s -> %s', (search, expected) => {
    expect(urlOverride(search)).toBe(expected);
  });
});

describe('resolveInputMode: URL beats a saved choice beats the automatic guess', () => {
  it('automatic when nothing else is said', () => {
    expect(resolveInputMode(PHONE, '', null)).toBe('touch');
    expect(resolveInputMode(DESKTOP, '', null)).toBe('desktop');
  });
  it('a saved choice beats the guess in both directions', () => {
    expect(resolveInputMode(PHONE, '', 'desktop')).toBe('desktop');
    expect(resolveInputMode(TOUCH_LAPTOP, '', 'touch')).toBe('touch');
  });
  it('the URL beats a saved choice', () => {
    expect(resolveInputMode(PHONE, '?touch=0', 'touch')).toBe('desktop');
    expect(resolveInputMode(DESKTOP, '?touch=1', 'desktop')).toBe('touch');
  });
});

describe('parseStoredMode', () => {
  it('accepts only the two known values, so a stale or corrupt entry falls back to the automatic guess', () => {
    expect(parseStoredMode('touch')).toBe('touch');
    expect(parseStoredMode('desktop')).toBe('desktop');
    for (const bad of ['auto', 'TOUCH', '1', '', null, undefined]) expect(parseStoredMode(bad)).toBeNull();
  });
});

describe('the CONTROLS toggle is offered only where it can matter', () => {
  it('never on a desktop with no touch screen (its title screen stays exactly as it was)', () => {
    expect(toggleOffered(DESKTOP, 'desktop', '')).toBe(false);
  });
  it('always in touch mode, so a wrong guess is one tap from fixed', () => {
    expect(toggleOffered(PHONE, 'touch', '')).toBe(true);
    expect(toggleOffered(DESKTOP, 'touch', '?touch=1')).toBe(true);
  });
  it('on any device that can touch, even while it shows the keyboard game', () => {
    expect(toggleOffered(TOUCH_LAPTOP, 'desktop', '')).toBe(true);
    expect(toggleOffered(PHONE, 'desktop', '')).toBe(true);
  });
});

describe('InputModeController', () => {
  it('starts in the resolved mode', () => {
    expect(new InputModeController(PHONE, '', new MemoryStorage()).mode).toBe('touch');
    expect(new InputModeController(DESKTOP, '', new MemoryStorage()).mode).toBe('desktop');
    expect(new InputModeController(PHONE, '', new MemoryStorage()).isTouch).toBe(true);
  });

  it('toggle switches the mode, tells listeners once and remembers the choice', () => {
    const storage = new MemoryStorage();
    const c = new InputModeController(PHONE, '', storage);
    const seen: string[] = [];
    c.onChange((m) => seen.push(m));
    expect(c.toggle()).toBe('desktop');
    expect(seen).toEqual(['desktop']);
    expect(storage.data.get(INPUT_MODE_STORAGE_KEY)).toBe('desktop');
    expect(c.toggle()).toBe('touch');
    expect(seen).toEqual(['desktop', 'touch']);
  });

  it('a remembered choice is used by the next visit (without a URL override)', () => {
    const storage = new MemoryStorage();
    new InputModeController(PHONE, '', storage).toggle();
    expect(new InputModeController(PHONE, '', storage).mode).toBe('desktop');
  });

  it('setting the mode it already has changes and saves nothing', () => {
    const storage = new MemoryStorage();
    const c = new InputModeController(PHONE, '', storage);
    const seen: string[] = [];
    c.onChange((m) => seen.push(m));
    c.set('touch');
    expect(seen).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('a URL override applies to the visit but is not saved until the player chooses', () => {
    const storage = new MemoryStorage();
    const c = new InputModeController(DESKTOP, '?touch=1', storage);
    expect(c.mode).toBe('touch');
    expect(storage.data.size).toBe(0);
    expect(c.canToggle).toBe(true);
  });

  it('works with blocked storage (nothing remembered, nothing thrown)', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('SecurityError');
      },
    };
    const c = new InputModeController(PHONE, '', blocked);
    expect(c.mode).toBe('touch');
    expect(c.toggle()).toBe('desktop');
    expect(new InputModeController(PHONE, '', null).mode).toBe('touch');
  });

  it('unsubscribing stops the notifications', () => {
    const c = new InputModeController(PHONE, '', null);
    let calls = 0;
    const stop = c.onChange(() => calls++);
    stop();
    c.toggle();
    expect(calls).toBe(0);
  });
});

describe('browserInputEnvironment', () => {
  const media = (matches: Record<string, boolean>) => ({ matchMedia: (q: string) => ({ matches: matches[q] ?? false }) as MediaQueryList });
  it('reads the primary pointer, any pointer and touch points', () => {
    expect(browserInputEnvironment(media({ '(pointer: coarse)': true }), { maxTouchPoints: 5 })).toEqual({ coarsePrimaryPointer: true, touchCapable: true });
    expect(browserInputEnvironment(media({ '(any-pointer: coarse)': true }), { maxTouchPoints: 0 })).toEqual({ coarsePrimaryPointer: false, touchCapable: true });
    expect(browserInputEnvironment(media({}), { maxTouchPoints: 10 })).toEqual({ coarsePrimaryPointer: false, touchCapable: true });
    expect(browserInputEnvironment(media({}), { maxTouchPoints: 0 })).toEqual({ coarsePrimaryPointer: false, touchCapable: false });
  });
  it('unavailable APIs mean "no touch", the safe default for the desktop game', () => {
    expect(browserInputEnvironment(undefined, undefined)).toEqual({ coarsePrimaryPointer: false, touchCapable: false });
    const throwing = {
      matchMedia: (): MediaQueryList => {
        throw new Error('nope');
      },
    };
    expect(browserInputEnvironment(throwing, { maxTouchPoints: 0 })).toEqual({ coarsePrimaryPointer: false, touchCapable: false });
  });
});
