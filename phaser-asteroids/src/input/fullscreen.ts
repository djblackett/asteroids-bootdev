/**
 * Fullscreen for the page, through the standard Fullscreen API only (with the old `webkit` prefix where a browser still wants it,
 * e.g. iPad Safari). Nothing here tries to get around a browser or operating-system restriction: if the browser says no, the
 * answer is "not available" or "blocked", shown honestly, and the game carries on in its window.
 *
 * Written against small structural types so every outcome (supported, unsupported, request refused, enter, exit, system exit) is
 * unit tested with a fake document and no browser. Pure: no Phaser.
 *
 * Support, in one rule: fullscreen is offered when the document says it is allowed (`fullscreenEnabled`, or the webkit one) AND the
 * element can be asked (`requestFullscreen`, or the webkit one). iPhone Safari reports neither, so it is "unsupported" there and the
 * UI shows the Add-to-Home-Screen tip instead of a Fullscreen button that could not work. A page already running as an installed
 * web app (standalone) has no address bar to hide and gets no fullscreen UI at all.
 *
 * The request must start inside the user's tap (browsers require user activation): `request()` calls the browser synchronously and
 * only the *result* is handled asynchronously. The fullscreen element is the root `<html>` element, so the canvas, the touch
 * overlay, the HUD (drawn in the canvas) and the menus are all inside it.
 */

export type FullscreenSupport = 'available' | 'unsupported' | 'standalone';

type Listener = (event: Event) => void;

export interface FullscreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface FullscreenElement {
  requestFullscreen?: (options?: { navigationUI?: 'hide' | 'show' | 'auto' }) => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenEnvironment {
  document: FullscreenDocument;
  /** The element that goes fullscreen (`document.documentElement`). */
  root: FullscreenElement;
  /** Already launched as an installed web app (Home Screen / PWA), where there is no browser UI to hide. */
  standalone: boolean;
}

export type FullscreenFailure = 'blocked' | 'unavailable';

export interface FullscreenState {
  support: FullscreenSupport;
  active: boolean;
  /** The last request failed (the browser refused, or fired `fullscreenerror`). Cleared by the next attempt or any change. */
  failure: FullscreenFailure | null;
}

const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;
const ERROR_EVENTS = ['fullscreenerror', 'webkitfullscreenerror'] as const;

export function detectSupport(env: FullscreenEnvironment): FullscreenSupport {
  if (env.standalone) return 'standalone';
  const { document: doc, root } = env;
  const allowed = (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) === true;
  const canRequest = typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
  return allowed && canRequest ? 'available' : 'unsupported';
}

export class FullscreenController {
  private failureNow: FullscreenFailure | null = null;
  private wasActive: boolean;
  private readonly listeners = new Set<(state: FullscreenState) => void>();
  private readonly onChangeEvent: Listener = () => {
    const active = this.active;
    // Entering or leaving always supersedes an earlier refusal; a change event that changes nothing (a duplicate) is not news.
    if (active === this.wasActive && this.failureNow === null) return;
    this.wasActive = active;
    this.failureNow = null;
    this.emit();
  };
  private readonly onErrorEvent: Listener = () => {
    this.failureNow = 'blocked';
    this.emit();
  };

  constructor(private readonly env: FullscreenEnvironment) {
    this.wasActive = this.active;
    for (const type of CHANGE_EVENTS) env.document.addEventListener(type, this.onChangeEvent);
    for (const type of ERROR_EVENTS) env.document.addEventListener(type, this.onErrorEvent);
  }

  get support(): FullscreenSupport {
    return detectSupport(this.env);
  }

  /** Whether the page is fullscreen right now (read from the document, which is the only source of truth). */
  get active(): boolean {
    const doc = this.env.document;
    return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
  }

  get state(): FullscreenState {
    return { support: this.support, active: this.active, failure: this.failureNow };
  }

  /**
   * Asks the browser for fullscreen. MUST be called from inside a user-activation event handler (a touch `pointerup`, a click):
   * the browser call happens synchronously here, before any `await`. Resolves true when the request was accepted, false when it was
   * refused or not possible (the state's `failure` says so); never rejects.
   */
  request(): Promise<boolean> {
    this.failureNow = null;
    if (this.support !== 'available') return this.fail('unavailable');
    const root = this.env.root;
    let pending: Promise<void> | void;
    try {
      pending = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen?.();
    } catch {
      return this.fail('blocked');
    }
    // Old webkit returns nothing and reports by event; the standard API returns a promise that rejects when refused.
    return Promise.resolve(pending).then(
      () => true,
      () => this.failSync('blocked'),
    );
  }

  /** Leaves fullscreen (a no-op when not in it). Never rejects. */
  exit(): Promise<boolean> {
    this.failureNow = null;
    const doc = this.env.document;
    if (!this.active) return Promise.resolve(true);
    let pending: Promise<void> | void;
    try {
      pending = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    } catch {
      return this.fail('blocked');
    }
    return Promise.resolve(pending).then(
      () => true,
      () => this.failSync('blocked'),
    );
  }

  /** Enter when out, leave when in. Call it from the tap handler, like `request`. */
  toggle(): Promise<boolean> {
    return this.active ? this.exit() : this.request();
  }

  onChange(listener: (state: FullscreenState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** A visible refusal that nothing will clear by itself (the UI calls this after showing it for a while). */
  clearFailure(): void {
    if (this.failureNow === null) return;
    this.failureNow = null;
    this.emit();
  }

  destroy(): void {
    for (const type of CHANGE_EVENTS) this.env.document.removeEventListener(type, this.onChangeEvent);
    for (const type of ERROR_EVENTS) this.env.document.removeEventListener(type, this.onErrorEvent);
    this.listeners.clear();
  }

  private fail(failure: FullscreenFailure): Promise<boolean> {
    return Promise.resolve(this.failSync(failure));
  }

  private failSync(failure: FullscreenFailure): false {
    this.failureNow = failure;
    this.emit();
    return false;
  }

  private emit(): void {
    const state = this.state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

/** What the Fullscreen button shows and does for a state; pure so the wording is unit tested. */
export interface FullscreenButtonSpec {
  visible: boolean;
  label: string;
  /** `toggle`: a tap enters / leaves fullscreen. `tip`: fullscreen is impossible here, a tap explains the Home Screen alternative. */
  action: 'toggle' | 'tip';
  /** The last attempt was refused: the label says so for a moment. */
  warning: boolean;
}

export function fullscreenButtonSpec(state: FullscreenState): FullscreenButtonSpec {
  if (state.support === 'standalone') return { visible: false, label: '', action: 'toggle', warning: false };
  if (state.support === 'unsupported') return { visible: true, label: 'HIDE ADDRESS BAR', action: 'tip', warning: false };
  if (state.failure !== null) return { visible: true, label: 'FULLSCREEN BLOCKED', action: 'toggle', warning: true };
  return { visible: true, label: state.active ? 'EXIT FULLSCREEN' : 'FULLSCREEN', action: 'toggle', warning: false };
}

/** The explanation shown where fullscreen is impossible (iPhone Safari). Kept here so the docs and the UI say the same thing. */
export const HOME_SCREEN_TIP = {
  title: 'Fullscreen is not available here',
  lines: [
    'This browser does not let a web page go fullscreen.',
    'To play without the address bar, add the game to your Home Screen: tap the Share button, choose "Add to Home Screen", then open the game from its new icon.',
  ],
} as const;

/** Reads the real browser. Anything missing counts as "not available": the safe default. */
export function browserFullscreenEnvironment(
  doc: Document = document,
  win: Pick<Window, 'matchMedia'> = window,
  nav: Navigator = navigator,
): FullscreenEnvironment {
  let standalone = (nav as Navigator & { standalone?: boolean }).standalone === true;
  try {
    standalone = standalone || win.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // matchMedia unavailable: assume a normal browser tab
  }
  return { document: doc as unknown as FullscreenDocument, root: doc.documentElement as unknown as FullscreenElement, standalone };
}
