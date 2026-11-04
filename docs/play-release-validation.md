# Google Play preparation validation — 2026-11-03

Prepared on `dev`, base HEAD `c1871a92c6f2a99bbac6f8dc8885691804826737`, plus the uncommitted privacy/release changes. No push, merge, deployment, production data mutation, key generation, signing or Play publication. Pre-existing Android Studio `.idea` changes and inaccessible tracked `tmp/` deletions were left alone. The Gradle settings typo seen initially was already corrected in the working tree before this task's Android edits.

## Evidence

| Check | Result |
| --- | --- |
| Full Vitest (`npm test -- --maxWorkers=4 --reporter=dot`) | 66 files, 1,631 tests passed, including 10 new moderation tests |
| First unrestricted Vitest run | One existing 8-minute gameplay fuzz test hit its 5-second timeout under 64-worker contention; all 1,631 passed with 4 workers. No gameplay test or timeout was changed |
| Focused final Vitest (moderation + Android configuration) | 18/18 passed |
| Android build and immutable-rules guard Node tests | 12/12 passed |
| Frontend and Worker TypeScript; browser/SSR build | Passed |
| Ranked UI with real disposable local Workers/D1 | 99/99 passed, including report persistence, offline error, block/reload/unblock, paging, gamepad, real verification, lost-response retry, expiry, time limit and touch submission |
| Menu regression and privacy layouts | 127/127 passed; includes all four privacy screens across five phone sizes and existing menus at five desktop sizes. Initial run 126/127: only the exact title-item list needed PRIVACY added; all initial layout checks passed |
| Android final release tasks | `:app:bundleRelease :app:assembleRelease :app:lintRelease :app:dependencies -PallowUnsignedRelease=true --configuration releaseRuntimeClasspath --no-daemon --console=plain` passed |
| Android lint | 0 errors, 14 warnings; remaining warnings concern existing fixed orientation, unused resources and deferred icon/splash artwork. Android 16 can ignore landscape locking on large displays; check tablet/window behavior manually |
| Final archive inspection (`scripts/inspect-android-release.ps1 -Unsigned`) | APK and AAB contain no `.so` libraries or server SSR verifier; package, target SDK and permission checks pass |
| Signing status | JDK jarsigner confirms AAB is unsigned. Negative test confirms `:app:preReleaseBuild` rejects missing credentials without the unsigned audit flag. No private credentials were generated or used |
| Source boundary | No diff in `src/core`, `src/replay`, `src/ranked/api.ts` or `server/rules`; challenge/submission protocol and frozen gameplay unchanged |
| Scoped `git diff --check` | Passed; unrelated inaccessible root tmp paths excluded |

The Capacitor CLI initially failed inside the sandbox with `uv_os_get_passwd returned ENOMEM`; the same local sync succeeded with approved profile/cache access. Android compilation and browser processes used the installed tools outside that sandbox restriction. All Worker writes were to disposable local databases. Tests did not submit new production scores. The resolved Android runtime graph includes AndroidX, Cordova/Capacitor and App plugin dependencies; no Firebase, Play Services, advertising or analytics runtime dependency was found.

## Final local unsigned artifacts

2026-11-04 follow-up: the draft and bundled privacy source now name David Andrea as operator. The artifacts and hashes below remain the 2026-11-03 verification snapshot and were not rebuilt for that wording-only change; rebuild and sync before distributing a later version.

Both are audit outputs, **not ready for Play upload**. They contain the visibly marked draft privacy text. SDK: compile/target 36, min 24. Native version `1.0` / `1`; gameplay `1.2.0` / schema `1`.

| Artifact (under `phaser-asteroids/`) | SHA-256 |
| --- | --- |
| `android/app/build/outputs/bundle/release/app-release.aab` | `7361BBCDF780088ABC2398BC7126E2BFA57E06CEE8D612E95DB85247550465AE` |
| `android/app/build/outputs/apk/release/app-release-unsigned.apk` | `9A48BCC80912884F1B1C980B88B77A74C1474D567FEFB5F8F0F4F1668AFEB08F` |

Frontend lock SHA-256: `DF28E0068B6851EBC25FBC23E6C9C4E529ACCC4EE600615AF7A1AEDF3ECAA395`.
Server lock SHA-256: `6D937CB254B80635506DAC17B9529C0D97513FAB61A81FBA8558447A8534AB84`.
Toolchain: Node 26.13.0, npm 11.20.0, JDK 21.0.5, Gradle 8.14.3, AGP 8.13.0. Inspector used Build Tools 36.1.0. Logs and screenshots are ignored under `phaser-asteroids/scripts/.smoke-output/` (`play-release-*` and `menu-*`). Final lint HTML is in `android/app/build/reports/lint-results-release.html`.

## Decisions / manual gates

1. Operator confirmed as David Andrea on 2026-11-04. Public privacy/security/removal/moderation mailbox intentionally deferred at David's request; return to this before distribution. Choose the address and mailbox handling/retention, final game name and effective date. Replace bundled contact placeholders and approve the public policy before distribution. Hosting proposal is in [the draft](privacy-policy-draft.md); nothing is hosted by this task.
2. Verify Cloudflare logging, request fields/location processing, security logs, backup/recovery/export retention, processing role and regions. Finalize [Data safety answers](play-data-inventory.md) using those facts. Accepted/hidden scores currently have no automatic expiry; do not promise otherwise.
3. Assign moderation coverage and review [nickname-blocking limitations](leaderboard-moderation.md) against Play's user-blocking requirement. No account or stable user identity was added.
4. Separately authorize/report the Worker migration and deployment before enabling reports for testers; implement the removal mailbox process. The new erasure route exists locally and is tested, but is not live in production.
5. Human creates/protects the upload key or supplies an existing one; build and inspect signed artifacts and verify certificate fingerprints. Confirm Play has not already consumed version code 1; increment and append the release registry record if needed.
6. Test a Play-delivered build on a 16 KB emulator/device and Samsung/representative devices, including tablet/window behavior and backup/device transfer. No `.so` files makes ELF alignment inapplicable to the bundled app; it does not replace runtime testing. Complete the [internal-testing procedure](../phaser-asteroids/docs/google-play-release.md), target ages/content rating and branding pass before promotion.
