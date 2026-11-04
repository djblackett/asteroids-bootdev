# Android app (Capacitor)

The Android app is the unchanged web game inside Capacitor 8. All native behaviour goes through a few small seams.
Browsers and GitHub Pages never take any of these paths.

Status: implemented and unit/browser tested on the desktop. **Not yet tried on a phone**: see the
[device checklist](#device-checklist). Nothing has been deployed or published.

## Building

```bash
cd phaser-asteroids
npm run build:android     # typecheck, build the web game into dist-android/, verify it
npm run android:sync      # the above, then `cap sync android` (copies dist-android/ and plugins into android/)
cd android && ./gradlew assembleDebug   # Set JAVA_HOME to JDK 21 first
```

`npm run build:android` is separate from `npm run build` (GitHub Pages), and differs in two ways:

1. **Only the browser game is built.** The ~8 MB server-only replay verifier (`dist/node`) used to be copied into the APK.
   The web payload is now ~10 MB instead of ~19 MB.
2. **The leaderboard URL is fixed and checked.** It comes from [`.env.android`](../.env.android), which is loaded only by
   `vite build --mode android`. [`scripts/build-android.mjs`](../scripts/build-android.mjs) stops the build in these cases:
   - the URL is missing;
   - it is not `https`;
   - it is a loopback or private address;
   - it has a path or a port;
   - a different `VITE_LEADERBOARD_API_URL` is set in the shell.

   After building, the script checks that the exact production origin appears in the bundle and that there is no `node/` folder.
   `node scripts/build-android.mjs --verify-only` re-checks an existing build.

At runtime, [`resolveApiBase`](../src/ranked/api.ts) ignores `?api=` and the `wrangler dev` fallback whenever the page runs inside
the app. So an installed app can only reach the configured production Worker, or report "not available".

Release items not done yet: the app name (still `phaser-asteroids`), `versionCode` / `versionName`, release signing, an AAB build,
and the launcher icon and splash artwork.

## How each concern is handled

| Concern | Where | What |
|---|---|---|
| App origin | [`capacitor.config.ts`](../capacitor.config.ts) | `server.hostname = spacearcade.davidandrea.ca`, `androidScheme = https`. The page origin (and the `Origin` header the Worker sees) is `https://spacearcade.davidandrea.ca`. Nothing is fetched from that domain: Capacitor serves the bundled files under that name. It is not `localhost`, so development-only rules never apply. **Do not change it after release**: `localStorage` (settings, nickname, local scores) belongs to the origin. |
| CORS | [`server/wrangler.toml`](../server/wrangler.toml) | Production `ALLOWED_ORIGINS` now also lists `https://spacearcade.davidandrea.ca`. **This only takes effect after the Worker is deployed.** Merging to `main` deploys it through CI. Until then ranked play and the boards in the app fail with `origin_not_allowed`, and practice still works. |
| Android Back | [`src/platform/nativeBack.ts`](../src/platform/nativeBack.ts), [`nativeApp.ts`](../src/platform/nativeApp.ts) | `@capacitor/app`'s `backButton` event goes to the handler the current scene registered, which uses the same logic as Escape. **Title menu:** `MenuController.back()` closes the open page; on the root page the app is minimized. **A run:** `GameScene.goBack()` pauses, closes a pause page, resumes, or leaves a finished run. Back never leaves the app from a run in progress, and never throws away an unsubmitted ranked score. |
| Pause / resume | `nativeApp.ts` | The app's `pause` / `resume` events are replayed as window `blur` / `focus`, which the existing listeners already handle. The run auto-pauses, music falls silent, held keys and touches are released, controllers go neutral, and vibration stops. WebView usually fires these itself; the native events are a backup. On resume the system bars are hidden again. |
| Fullscreen | `capacitor.config.ts` (`SystemBars.hidden`), [`MainActivity.java`](../android/app/src/main/java/ca/davidandrea/spacearcade/MainActivity.java), [`fullscreen.ts`](../src/input/fullscreen.ts) | Capacitor 8's built-in SystemBars plugin hides the status and navigation bars. One native line sets "transient bars by swipe", which SystemBars has no option for: an edge swipe shows the bars over the game for a moment instead of bringing them back for good. The in-game FULLSCREEN button is hidden in the app, because Capacitor's WebView immediately ends Fullscreen API requests. |
| Safe areas | [`index.html`](../index.html), [`src/ui/touch.css`](../src/ui/touch.css) | Every inset reads `var(--safe-area-inset-X, env(safe-area-inset-X, 0px))`. SystemBars writes the variables with the real insets (`initialViewportFitValueHint: 'cover'` makes it do so from the first frame). Browsers never set them, so `env()` applies as before. The game box uses the larger of the left and right insets on both sides, so a cutout on one side never moves the playfield off the physical centre; the touch controls keep each side's own inset. The theme's window background is black, so any inset band around a camera cutout is black, not white. |
| Orientation | [`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml) | `screenOrientation="sensorLandscape"`. Android 16 ignores orientation locks on large screens (600 dp wide or more), so the game's own rotate prompt and auto-pause remain the fallback. |
| Vibration | `AndroidManifest.xml` | `android.permission.VIBRATE` (no prompt). Without it WebView silently ignores `navigator.vibrate`. |
| Audio | (unchanged) | Capacitor allows media without a user gesture. Music and effects use the existing Phaser and lifecycle code. |
| Offline | (unchanged) | Every asset is in the APK. Practice needs no network, and ranked / scores fail cleanly offline. |

Tests: [`tests/nativeApp.test.ts`](../tests/nativeApp.test.ts) (Back routing, lifecycle, plugin failures),
[`tests/androidRelease.test.ts`](../tests/androidRelease.test.ts) (the four config files agree), the native cases in
`tests/ranked.test.ts`, `tests/fullscreen.test.ts` and `tests/mobileEntry.test.ts`, and
[`scripts/build-android.test.mjs`](../scripts/build-android.test.mjs) (`npm run test:android-build`).

## Gameplay updates and installed apps

Resolved on 2026-11-02 (see [android-release-audit.md](android-release-audit.md) and [server/rules/README.md](../server/rules/README.md)):
the app names its rules version when it asks for a ranked run, and the Worker verifies every version in its frozen-engine registry,
chosen by the version recorded at issue. A rules bump therefore deploys a Worker that serves the old and the new version; installed
apps keep playing ranked until their version is retired, at least 90 days after a successor build reached all users. CI refuses
to drop a version a build in `server/rules/released.json` still plays, and `npm run build:android` refuses to package a build whose
`versionCode` is not recorded there with its rules.

**Releasing a build:** raise `versionCode` / `versionName` in `android/app/build.gradle` whenever the rules differ from the last
recorded build, add the build to `server/rules/released.json`, and build only from a commit whose Worker is deployed.

The rest of this section is the analysis from before the fix, kept for the record.

### Before 2026-11-02: one rules version at a time

The Worker supported **one** gameplay rules version at a time. It was `GAMEPLAY_RULES_VERSION`, compiled in from `src/replay` at
deploy time. A ranked client refuses a challenge for any other version (`update_required`), and the Worker rejected a run issued
under older rules (`rules_mismatch`). The Worker deploys automatically on every qualifying merge to `main`.

On the web this costs nothing: the page reloads into the new build. An installed Android app keeps its bundled game until the
player installs an update from the store. That can mean days of review, or never for players who don't update. So:

- **Any change to `GAMEPLAY_RULES_VERSION` (or the replay schema) disables ranked play in every installed app at the moment the
  Worker deploys.** The app then shows "RANKED PLAY NEEDS A NEWER VERSION OF THE APP. UPDATE THE APP, OR PLAY PRACTICE." Practice is
  unaffected.
- A run in progress when the Worker deploys is rejected on submit.
- Releasing a new APK first does not help: it would be refused by the old Worker in the same way.

### Until a better strategy exists

- Treat a rules-version bump as a coordinated release. Prepare the Android build with the same rules, deploy the Worker, then
  publish the app update at once. Accept a window in which older apps cannot play ranked.
- Keep rule changes rare and batched. Purely visual, audio and menu changes don't need a rules bump (see `SCORING_ERAS`
  in `src/ranked/scoringEras.ts`).

### Recommended longer-term strategy

1. **Accept several rules versions at once.**
   - `POST /api/v1/runs` sends the client's `rulesVersion` and `schemaVersion`.
   - The Worker issues a challenge for any version in a configured `SUPPORTED_RULES_VERSIONS` list and records it on the run, as it
     already does.
   - It verifies the run with the matching simulator. Older versions of `src/replay` + `src/core` would be kept as frozen,
     versioned modules inside the Worker. The verifier is already deterministic and self-contained, so this is mostly a packaging
     change.
   - Boards are already separated by scoring era, so scores never mix incompatible rules.
2. **Give old versions a deprecation window, not a cliff.**
   - Add `minSupportedRulesVersion` and `latestRulesVersion` to `/api/v1/health` and the challenge response.
   - The client shows a soft "update available" notice while its version is still supported, and the hard block only after the
     window ends (for example 30-60 days).
3. **Gate it in CI.** Add a check that fails when `GAMEPLAY_RULES_VERSION` changes and the previous version is dropped from
   `SUPPORTED_RULES_VERSIONS` without an explicit flag.
4. Not recommended:
   - Loading the game from the web (`server.url`): offline practice would stop working, and Play policy questions follow.
   - Over-the-air bundle updates: extra infrastructure, and they don't remove the need for (1) when an update fails.

## Device checklist

Use a phone, plus a tablet or foldable for orientation. Use `chrome://inspect` on the PC for the WebView console and network.

| # | Check | Expected |
|---|---|---|
| 1 | Cold start | Landscape, no status or navigation bar, no FULLSCREEN button on the title or pause screens, music starts. |
| 2 | Swipe from a screen edge mid-run | The bars appear over the game and hide again by themselves; the playfield does not resize. With gesture navigation, check how many swipes a Back gesture takes. |
| 3 | Back: playing → pause page → pause root → game over → title sub-page → title root | Pause, close page, resume, title, close page, app goes to the background. Back during a ranked run's result page never discards the score. |
| 4 | Home, recent apps, a phone call, the screen turned off mid-run | The game is paused on return, music is silent while away, no stuck controls, bars still hidden. |
| 5 | Notch or punch-hole camera, in both landscape directions | Touch controls and HUD clear the cutout; the band is black. The playfield stays in the same place, centred on the screen, when the phone is turned 180°. |
| 6 | Portrait on a large screen (orientation lock ignored) | Rotate prompt, run paused. |
| 7 | HAPTICS ON → TEST VIBRATION, then boost / laser / damage in a run | Felt. Also try with Samsung Silent mode. |
| 8 | Ranked end to end (after the Worker with the new `ALLOWED_ORIGINS` is deployed) | Challenge issued, run verified, rank shown. Turn on airplane mode during upload: retry works with the same submission. |
| 9 | Airplane mode from a cold start | Practice plays; RANKED and SCORES say unavailable, without a crash. |
| 10 | Nickname entry on the result page | The keyboard does not cover the field; Back with the keyboard open only closes the keyboard. |
| 11 | Bluetooth controller and keyboard | Work as in the browser. |
| 12 | 10-minute session | Smooth at 90/120 Hz, no unusual battery drain or heat. |
