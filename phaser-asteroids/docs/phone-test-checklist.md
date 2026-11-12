# Phone test checklist (sideload build)

Prepared 2026-11-12 on `release/android-device-prep`. Replaces the earlier device checklist in [android.md](android.md#device-checklist).
This is a **local test build, not a release**: it is signed with this PC's Android debug key, carries the draft privacy text, and
cannot be uploaded to Play. Record results in the "Result" column and keep notes with the device model and Android version.

## The build

| | |
| --- | --- |
| **Install this** | `phaser-asteroids/android/app/build/outputs/apk/sideload/orbital-impact-1.0-sideload-debugkey.apk` |
| SHA-256 | `11FEB5AB4A3B7BDCD84FF291D7A22FE96A1B0AAA664FA5F95B2AD298692FE592` |
| What it is | The **release** build type (not debuggable, WebView debugging off) from the unsigned `app-release-unsigned.apk` (SHA-256 `284F84C1…FBD01C`, byte-identical to the 2026-11-04 audit APK), re-signed with `~/.android/debug.keystore` (`CN=Android Debug`, cert SHA-256 `884e8e7b…442f74`). v2+v3 signatures, 16 KB zip alignment verified. |
| Identity | `ca.davidandrea.spacearcade`, versionName `1.0`, versionCode `1`, min SDK 24, target 36. Permissions: INTERNET, VIBRATE, AndroidX dynamic-receiver (signature-only). |
| Gameplay | Frozen rules `1.2.0`, replay schema `1` (recorded in `server/rules/released.json`); production health reports supported `[1.2.0]`. |
| Backend | Production Worker `https://asteroids-leaderboard.davejandrea.workers.dev` (version `c2aef78f`). There is no test backend in this build. |
| Optional diagnostic build | `android/app/build/outputs/apk/debug/app-debug.apk` (SHA-256 `E49AC998…56093`): debuggable, so `chrome://inspect` on the PC shows the WebView console and network. Same package and same debug key, so `adb install -r` swaps between the two **without losing local data**. Use it only to diagnose a failure seen with the release build. |

Rebuild (from `phaser-asteroids`, PowerShell, JDK 21):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot'
npm run android:sync
Push-Location android; .\gradlew.bat :app:assembleRelease -PallowUnsignedRelease=true --no-daemon --console=plain; Pop-Location
.\scripts\inspect-android-release.ps1 -Unsigned        # expect PASS lines plus WARN for the draft privacy text
$bt = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0"
New-Item -ItemType Directory -Force android\app\build\outputs\apk\sideload | Out-Null
# Debug keystore's public default password; this is not the upload key and must never sign a Play artifact.
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android `
  --out android\app\build\outputs\apk\sideload\orbital-impact-1.0-sideload-debugkey.apk android\app\build\outputs\apk\release\app-release-unsigned.apk
```

The signed-release inspector (no `-Unsigned`) refuses this APK: debug key, plus draft privacy text. That is intended.

## Before you start

- **Ranked tests write to production.** A submitted score is a real public entry on both boards; a report is a real private report row.
  Use a nickname you are content to have public (or Anonymous). As operator you can hide or erase test entries afterwards from the
  Worker's `/admin` console, which also exercises the moderation workflow. Practice, boards and privacy screens write nothing.
- **Later Play installs:** a Play-signed build cannot update this debug-key install. Before installing from Play you must uninstall,
  which deletes local settings, nickname, local bests and blocked names (server scores remain).

## 1. Installation and first launch

1. Phone: Settings > About phone > Software information > tap Build number 7 times; Developer options > USB debugging on.
2. Connect by **USB cable** and accept the RSA prompt. `adb devices -l` must show the phone as `device` (not `offline`/`unauthorized`).
3. Check for an existing install first:
   `adb shell dumpsys package ca.davidandrea.spacearcade | findstr /i "versionCode versionName lastUpdateTime"`
4. Install: `adb install -r "C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\android\app\build\outputs\apk\sideload\orbital-impact-1.0-sideload-debugkey.apk"`
   - `INSTALL_FAILED_UPDATE_INCOMPATIBLE` means an install signed with a different key exists. Note its version, then decide whether
     to uninstall (loses its local data). Do not uninstall just to get past the error if you want section 9's evidence.
5. If several devices are attached, add `-s <serial>` from `adb devices`. Useful while testing: `adb logcat -v time *:E chromium:I Capacitor:V`.

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | Install command | `Success` | |
| 1.2 | Launcher | Icon present; label is currently `phaser-asteroids` (final name/icon deferred) | |
| 1.3 | Cold start | Splash, then title in landscape; no status/navigation bar; no FULLSCREEN button; music starts | |
| 1.4 | Force-stop and relaunch | Same; settings retained | |

## 2. Orientation, safe areas and navigation

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 2.1 | Rotate the phone 180° in both landscape directions, at title and mid-run | Follows the sensor; the playfield stays centred; HUD and touch controls clear the camera cutout; any band is black | |
| 2.2 | Hold in portrait | Stays landscape (phones honour the lock). On a tablet/foldable ≥ 600 dp: rotate prompt, run paused | |
| 2.3 | Edge swipe mid-run | Bars appear over the game and hide again by themselves; playfield does not resize | |
| 2.4 | Back: in run → pause page → pause root → game over → title sub-page → title root | Pause, close page, resume, title, close page, app goes to background. Back never discards an unsubmitted ranked result | |
| 2.5 | Gesture navigation vs 3-button navigation (if switchable) | Back works in both; note how many swipes a Back gesture takes | |

## 3. Touch controls and responsiveness

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Each control layout/movement mode offered in Controls | Rotate/thrust/fire/laser/boost respond immediately; no stuck input after lifting fingers | |
| 3.2 | Multi-touch: steer while firing and boosting | All register together | |
| 3.3 | 10-minute session | Smooth at the display's refresh rate (60/90/120 Hz); no stutter, unusual heat or battery drain | |
| 3.4 | Bluetooth controller and keyboard (if available) | Work as in the browser; menus navigable | |

## 4. Audio, vibration and interruptions

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.1 | Music and effects; volume keys | Audible; volume keys change media volume | |
| 4.2 | HAPTICS ON → TEST VIBRATION, then boost/laser/damage in a run | Felt; also with Samsung Silent/Vibrate mode | |
| 4.3 | Home, recents, screen off, incoming call or alarm mid-run | On return the run is paused, music silent while away, no stuck controls, bars still hidden | |
| 4.4 | Headphones / Bluetooth audio connect and disconnect mid-run | No crash; audio routes sensibly | |

## 5. Offline Practice

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | Airplane mode, then cold start | Title loads; Practice plays fully | |
| 5.2 | RANKED and HIGH SCORES while offline | Clear "unavailable" message; no crash or endless spinner | |
| 5.3 | Privacy pages offline | All 4 pages readable (bundled) | |

## 6. Ranked challenge, submission and leaderboards (writes to production)

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | Start RANKED online | Challenge issued; run starts | |
| 6.2 | Finish; result page; Privacy / Leaderboard Rules link next to Submit | Rules readable; Back returns to the result without losing it | |
| 6.3 | Nickname entry | Keyboard does not cover the field; Back with keyboard open only closes it | |
| 6.4 | Submit | Verified; rank shown; entry appears on weekly and all-time boards and its detail page | |
| 6.5 | A name the server rejects (`invalid_nickname`), then correct it or choose Anonymous | Clear message; corrected submission accepted; run not lost | |
| 6.6 | Board paging; personal bests | Pages load; your accepted score listed locally | |

## 7. Submission retry after interrupted connectivity

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | Finish a ranked run, enable airplane mode, press Submit | Failure message with retry; result kept | |
| 7.2 | Disable airplane mode, retry | Accepted once; exactly one new board entry (no duplicate) | |
| 7.3 | Airplane mode **during** upload (toggle right after Submit) | Retry returns the same result; no duplicate | |
| 7.4 | Background the app on the result page for > 1 hour, then submit | Expired-run message, not a crash (challenge TTL is 1 hour) | |

## 8. Reporting, blocking and privacy screens

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | PRIVACY menu: all 4 pages, NEXT/BACK | Readable at phone size; shows the **draft** marker (expected until the policy is approved) and the contact `privacy@davidandrea.ca` | |
| 8.2 | HIGH SCORES > REPORT / BLOCK > Report your own test entry (writes a private report) | Success message (note what a second report of the same entry shows; the server keeps one report per entry and network); the entry appears in `/admin` Needs review | |
| 8.3 | Block that nickname | Entries with that name replaced on this device; survives app restart | |
| 8.4 | Unblock | Entries return | |
| 8.5 | Operator: hide or rename the test entry in `/admin`, then refresh the board in the app | Change visible on next refresh (no-store) | |

## 9. Existing-install compatibility

No historical signed release exists (versionCode 1 has never been distributed). The only possible earlier installs are developer builds
signed with this PC's debug key, which this APK can update in place.

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 9.1 | Step 1.3 found an earlier build: record its versionCode/lastUpdateTime, then `adb install -r` | Updates without uninstalling | |
| 9.2 | After the update | Settings, last nickname, local bests and blocked names are kept (same origin `https://spacearcade.davidandrea.ca`) | |
| 9.3 | Ranked on the updated install | As section 6 | |
| 9.4 | Signature-mismatch error instead | Record the installed build's provenance; this is the case a Play-signed build will hit (uninstall required) | |

## Already covered by automation (2026-11-12, do not repeat by hand)

- Unit: 67 files / 1,669 tests (includes Back routing, lifecycle replay as blur/focus, plugin failures, Android config agreement,
  draft-marker guard). Android build guard 8/8; rules/health guards 19/19; rules guard: 0 changes to released rules since `main`.
- `android:sync`: production HTTPS origin baked in, frozen rules recorded, no server verifier packaged.
- Gradle `bundleRelease assembleRelease lintRelease` (unsigned audit flag): success; lint 0 errors / 14 known warnings
  (icons/unused resources/orientation).
- Inspector: package, target 36, not debuggable, only expected permissions, no `.so` libraries (16 KB ELF alignment not applicable).
- Earlier desktop Chromium suites (2026-11-04 at `549729f`, unchanged packaged sources): ranked UI 99/99 (touch submission,
  retry, expiry, reporting/blocking), menu 127/127 (privacy layouts at phone sizes), worker-e2e 33/33, moderation admin 28/28.

Automation cannot show real WebView rendering, touch latency, audio focus, vibration, cutouts, system gestures, OEM lifecycle
behaviour or 16 KB-page runtime. Those are the checks above. A 16 KB device/emulator and a Play-delivered install remain separate
gates (see [google-play-release.md](google-play-release.md)).
