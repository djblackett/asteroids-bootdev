/**
 * Which control scheme the player sees: the on-screen touch controls (plus touch-friendly menus) or the keyboard / controller
 * screens the game has always had. The rule is deliberately small so it can be explained in one breath:
 *
 *   1. `?touch=1` / `?touch=0` in the URL decides for this visit (testing, and a link you can send someone).
 *   2. Otherwise a choice the player made with the CONTROLS toggle on the title screen is remembered.
 *   3. Otherwise `auto`: touch controls only when the device's *primary* pointer is coarse (a finger), which is true for phones
 *      and tablets and false for a desktop or laptop even if it has a touch screen. Not user-agent sniffing, and not "the browser
 *      supports touch events", which is true on most desktops.
 *
 * Viewport size is not part of the rule on purpose: a tablet is a perfectly good touch device and a narrow desktop window is not.
 * A controller on a touch device does not change the mode by itself: tap CONTROLS on the title screen to switch, which is always
 * one tap and shows what it is set to. In touch mode keyboard keys keep working; a controller needs the keyboard / controller
 * screen, where it is assigned to a player.
 */

import type { StorageLike } from '../audio/audioSettings';

export type InputMode = 'touch' | 'desktop';
export type InputPreference = InputMode | 'auto';

export interface InputEnvironment {
  /** The primary pointer is a finger: `matchMedia('(pointer: coarse)')`. */
  coarsePrimaryPointer: boolean;
  /** The device can report touches at all (`maxTouchPoints > 0` or any coarse pointer). Only decides whether the toggle is offered. */
  touchCapable: boolean;
}

export const INPUT_MODE_STORAGE_KEY = 'asteroids.inputMode';

/** `?touch=1|on|true` -> touch, `?touch=0|off|false` -> desktop, `?touch=auto` or anything else -> no override. */
export function urlOverride(search: string): InputMode | null {
  const value = new URLSearchParams(search).get('touch')?.toLowerCase();
  if (value === '1' || value === 'on' || value === 'true') return 'touch';
  if (value === '0' || value === 'off' || value === 'false') return 'desktop';
  return null;
}

export function autoMode(env: InputEnvironment): InputMode {
  return env.coarsePrimaryPointer ? 'touch' : 'desktop';
}

export function parseStoredMode(raw: string | null | undefined): InputMode | null {
  return raw === 'touch' || raw === 'desktop' ? raw : null;
}

/** The mode to start in. */
export function resolveInputMode(env: InputEnvironment, search: string, stored: InputMode | null): InputMode {
  return urlOverride(search) ?? stored ?? autoMode(env);
}

/**
 * Whether the title screen shows the CONTROLS toggle. Touch mode always has it (so a wrong guess is one tap from fixed) and a
 * device that can touch gets it in desktop mode too; a desktop with no touch screen never sees it, so its title screen is unchanged.
 */
export function toggleOffered(env: InputEnvironment, mode: InputMode, search: string): boolean {
  return mode === 'touch' || env.touchCapable || urlOverride(search) !== null;
}

/** Holds the current mode, remembers explicit choices, and tells listeners when it changes. */
export class InputModeController {
  private current: InputMode;
  private readonly listeners = new Set<(mode: InputMode) => void>();

  constructor(
    readonly env: InputEnvironment,
    readonly search: string,
    private readonly storage: StorageLike | null,
  ) {
    this.current = resolveInputMode(env, search, this.readStored());
  }

  get mode(): InputMode {
    return this.current;
  }

  get isTouch(): boolean {
    return this.current === 'touch';
  }

  get canToggle(): boolean {
    return toggleOffered(this.env, this.current, this.search);
  }

  /** The player's explicit choice: applied now and remembered for next time. */
  set(mode: InputMode): void {
    if (mode === this.current) return;
    this.current = mode;
    this.writeStored(mode);
    for (const listener of [...this.listeners]) listener(mode);
  }

  toggle(): InputMode {
    this.set(this.current === 'touch' ? 'desktop' : 'touch');
    return this.current;
  }

  onChange(listener: (mode: InputMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readStored(): InputMode | null {
    try {
      return parseStoredMode(this.storage?.getItem(INPUT_MODE_STORAGE_KEY));
    } catch {
      return null; // storage blocked (private window, disabled cookies): the choice just is not remembered
    }
  }

  private writeStored(mode: InputMode): void {
    try {
      this.storage?.setItem(INPUT_MODE_STORAGE_KEY, mode);
    } catch {
      // not remembered; the mode still applies for this visit
    }
  }
}

/** Reads the real browser's facts. Anything unavailable counts as "no touch", the safe default for the desktop game. */
export function browserInputEnvironment(win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window, nav: Pick<Navigator, 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): InputEnvironment {
  const query = (q: string): boolean => {
    try {
      return win?.matchMedia?.(q).matches === true;
    } catch {
      return false;
    }
  };
  const coarsePrimaryPointer = query('(pointer: coarse)');
  const touchCapable = coarsePrimaryPointer || query('(any-pointer: coarse)') || (nav?.maxTouchPoints ?? 0) > 0;
  return { coarsePrimaryPointer, touchCapable };
}
