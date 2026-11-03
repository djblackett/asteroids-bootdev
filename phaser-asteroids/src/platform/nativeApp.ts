import { nativeBack, type BackDispatcher } from './nativeBack';

/**
 * The Android (Capacitor) app shell around the unchanged web game. Everything native is reached through here, and only when the page
 * really runs inside the app: Capacitor's native bridge defines `window.Capacitor` before any script runs, so a browser (desktop, phone,
 * GitHub Pages) never takes these paths and never even downloads the Capacitor plugin code (it is a separate, lazily imported chunk).
 *
 * What the app adds, each one routed into logic the browser build already has:
 *   - Back: `nativeBack` (see nativeBack.ts), i.e. the same rules as Escape; with nothing left to close, the app goes to the background.
 *   - pause / resume: replayed as the window `blur` / `focus` events every lifecycle listener already handles (Phaser's BLUR -> the run
 *     pauses and the music falls silent, held keys and touches are released, controllers go neutral, vibration stops). WebView normally
 *     fires these itself; the native events make it certain, and a second `blur` is harmless.
 *   - system bars: hidden at start by the SystemBars config (capacitor.config.ts) and hidden again on every resume.
 */

/** The parts of `window.Capacitor` (from the native bridge) read here. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** True only inside the Capacitor app (Android). Never throws; anything unexpected means "a browser". */
export function isNativeApp(win: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  try {
    const cap = (win as { Capacitor?: CapacitorGlobal } | undefined)?.Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform() === true;
  } catch {
    return false;
  }
}

interface ListenerHandle {
  remove(): Promise<void> | void;
}

/** The slice of `@capacitor/app`'s `App` used here (structural, so tests pass a fake). */
export interface AppPluginLike {
  addListener(eventName: 'backButton' | 'pause' | 'resume', listener: () => void): Promise<ListenerHandle>;
  minimizeApp(): Promise<void>;
}

/** The slice of `@capacitor/core`'s `SystemBars` used here. */
export interface SystemBarsLike {
  hide(): Promise<void>;
}

/**
 * Connects the native events to the game. @returns a function that removes every listener again. Never throws, and a plugin call that
 * fails is logged and ignored: the game keeps running either way.
 */
export function wireNativeApp(app: AppPluginLike, win: EventTarget, back: BackDispatcher = nativeBack, bars?: SystemBarsLike): () => void {
  const handles: Promise<ListenerHandle | null>[] = [];
  const listen = (eventName: 'backButton' | 'pause' | 'resume', listener: () => void): void => {
    handles.push(
      Promise.resolve()
        .then(() => app.addListener(eventName, listener))
        .catch((e: unknown) => {
          console.warn(`[asteroids] could not listen for ${eventName}`, e);
          return null;
        }),
    );
  };
  const quietly = (what: string, call: () => Promise<void>): void => {
    Promise.resolve()
      .then(call)
      .catch((e: unknown) => console.warn(`[asteroids] ${what} failed`, e));
  };

  // Registering a backButton listener also turns off the plugin's default (WebView history back, else close the app).
  listen('backButton', () => {
    if (back.dispatch() === 'exit') quietly('minimizeApp', () => app.minimizeApp());
  });
  listen('pause', () => win.dispatchEvent(new Event('blur')));
  listen('resume', () => {
    win.dispatchEvent(new Event('focus'));
    if (bars) quietly('SystemBars.hide', () => bars.hide());
  });

  return () => {
    for (const handle of handles) void handle.then((h) => h?.remove());
  };
}

/** Called once at startup. Does nothing at all in a browser. */
export function installNativeApp(): void {
  if (!isNativeApp()) return;
  void import('./capacitorBindings')
    .then(({ installCapacitorBindings }) => installCapacitorBindings())
    .catch((e: unknown) => console.warn('[asteroids] native app integration unavailable', e));
}
