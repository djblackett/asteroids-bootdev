import { isNativeApp } from './nativeApp';

/**
 * How an external page was handed over:
 *   - `opened`: a browser opened a new tab (the game keeps running in this one).
 *   - `handed-off`: inside the Android app the URL was passed to the system browser. The app cannot tell whether one opened.
 *   - `blocked`: the browser refused the new tab (pop-up blocker). Nothing changed here.
 */
export type ExternalOpenResult = 'opened' | 'handed-off' | 'blocked';

/** The parts of `window` used here (structural, so tests pass a fake). */
export interface ExternalWindow {
  open(url: string, target: string): { opener: unknown } | null;
  location: { assign(url: string): void };
}

/**
 * Opens a fixed https page outside the game, never replacing the game page.
 *
 * Browser: a new tab via `window.open`. Its `opener` is cleared so the policy page cannot reach back into the game. (Passing
 * `noopener` instead would make `open` always return null, so a blocked tab could not be told apart from an opened one.)
 *
 * Android app: a plain navigation. Capacitor's WebView client hands any URL whose host is not the app's own
 * (`spacearcade.davidandrea.ca`) to an Android ACTION_VIEW intent and cancels the load (Bridge.launchIntent in @capacitor/android), so
 * the system browser opens and the game page stays where it is. No plugin, dependency or permission is involved. If the phone has no
 * browser, Capacitor swallows the error, so the caller always shows the address as a fallback.
 */
export function openExternalUrl(url: string, win: ExternalWindow = window as unknown as ExternalWindow, native: boolean = isNativeApp()): ExternalOpenResult {
  if (!/^https:\/\/[^\s/]+\//.test(url)) throw new Error(`refusing to open a non-https address: ${url}`);
  if (native) {
    win.location.assign(url);
    return 'handed-off';
  }
  let tab: { opener: unknown } | null = null;
  try {
    tab = win.open(url, '_blank');
  } catch {
    tab = null;
  }
  if (!tab) return 'blocked';
  try {
    tab.opener = null;
  } catch {
    // Some browsers make it read-only for cross-origin tabs; the tab is open either way.
  }
  return 'opened';
}
