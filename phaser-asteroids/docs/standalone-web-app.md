# Standalone web app (future configuration, not implemented)

**Status: documentation only.** Nothing described here is in the build. This pass added a Fullscreen button (see [mobile-touch.md](mobile-touch.md#fullscreen)) and a tip
telling iPhone users to add the game to their Home Screen. This note records what would make that Home Screen launch behave like an app, so it can be done on purpose later.
It is deliberately *not* a PWA plan: no service worker, no offline caching, no install prompts.

## Why it matters

iPhone Safari has no Fullscreen API for ordinary pages, so the address bar cannot be hidden from inside the page. A site launched from the Home Screen *as a web app* runs
without Safari's browser UI. Whether a Home Screen icon opens that way depends on the iOS version and on what the page declares, which is why the in-game tip is worded as
"open the game from its new icon" and why the result needs checking on a real phone.

Reports to verify before relying on them (they could not be checked here, and browser behaviour changes):

- Older iOS versions open a Home Screen shortcut as a plain Safari tab unless the page declares it is web-app capable (the `apple-mobile-web-app-capable` meta tag, or a web
  app manifest with `display: standalone` on versions that read it).
- Recent iOS versions (iOS 26 is reported to) open any site added to the Home Screen as a web app by default, with a per-site switch to open it in Safari instead.

## What the configuration would involve

1. **Head tags** in `index.html` (none of them are present today):
   - `<meta name="apple-mobile-web-app-capable" content="yes">` and `<meta name="mobile-web-app-capable" content="yes">` (web-app capable).
   - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` so the page draws under the status bar. The game already uses `viewport-fit=cover`
     and `env(safe-area-inset-*)`, so the controls and canvas container are already inset; this would be the setting that makes those insets non-zero in standalone mode.
   - `<meta name="theme-color" content="#000000">`, `<meta name="apple-mobile-web-app-title" content="Asteroids">`.
   - `<link rel="apple-touch-icon" href="./apple-touch-icon.png">` (180 x 180; there is a favicon but no touch icon today).
2. **A web app manifest** (`manifest.webmanifest`, `<link rel="manifest">`): `name`, `short_name`, `start_url`, `scope`, `display` (`standalone`, or `fullscreen` to also hide the status bar on
   Android), `background_color`, `theme_color`, `orientation: "landscape"` (honoured by installed Android apps; iOS ignores it, so the "Rotate your phone" prompt stays), and icons
   (192 and 512 px, one maskable).
3. **Base path.** The Pages build uses `base: './'` (see `vite.config.ts` and [deployment.md](deployment.md)), so `start_url` and `scope` should be `./` and every manifest / icon path relative.
   `scripts/pages-check.mjs` already serves the production build under the Pages sub-path; it would need to assert the manifest and icons load from there too.
4. **Detecting standalone mode** is already done: `src/input/fullscreen.ts` treats `display-mode: standalone` / `navigator.standalone` as "nothing to offer" and hides both the Fullscreen
   button and the Home Screen tip.
5. **A service worker is not required by this goal** (hiding the address bar). Some installability criteria on some browsers have asked for one; whether the current ones do should be
   checked in the browser's own documentation at the time. Offline play would be a separate decision (the game is 1.4 MB of Phaser plus 1.4 MB of music).

## Things to test on a real device if it is ever done

- The icon launches without browser UI on the iOS versions you care about, and the HIDE ADDRESS BAR tip no longer shows.
- Safe-area insets in standalone mode (notch, rounded corners, home indicator) with `black-translucent`: the canvas and every control must stay clear of them.
- Audio: the first tap still unlocks it; the silent switch still matters on iOS.
- Rotation and the portrait prompt (orientation locking from the manifest is not honoured on iOS).
- Updating the game: a standalone launch can keep an old copy longer than a browser tab; there is no service worker, so this should only be the HTTP cache, but confirm.
- Whether launching standalone changes `localStorage` (the volume, input-mode and steering choices live there): on iOS a Home Screen web app has its own storage, separate from Safari's.
