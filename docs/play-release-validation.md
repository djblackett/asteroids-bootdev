# Google Play preparation validation — 2026-11-03

Prepared on `dev`, base HEAD `c1871a92c6f2a99bbac6f8dc8885691804826737`, plus the uncommitted privacy/release changes. No push, merge, deployment, production data mutation, key generation, signing or Play publication. Pre-existing Android Studio `.idea` changes and inaccessible tracked `tmp/` deletions were left alone. The Gradle settings typo seen initially was already corrected in the working tree before this task's Android edits.

## Release candidate: Hull & Havoc (2026-11-12)

Branch `release/hull-and-havoc-rc` (local only; nothing pushed, deployed, migrated or emailed). Mocked/loopback email only.

| Check | Result |
| --- | --- |
| Vitest (full) | **71 files / 1,705 tests passed** (incl. digest 25, delivery-test script 3, branding 3, privacy page 5, Android release guards) |
| Typecheck | frontend `tsc --noEmit` and server `tsc -p server/tsconfig.json`: pass |
| Production build | `npm run build`: pass; `dist/privacy/index.html` emitted; no Resend/digest strings in the client bundle |
| Android build guards | `node --test scripts/build-android.test.mjs`: 8/8 |
| Frozen rules | `rules-guard.mjs main`: 0 changes under `server/rules`; guard tests 4/4. No diff under `src/core`, `src/replay`, `src/game`, `src/scenes` vs `main` |
| Real Worker + D1 (workerd) | `server/scripts/worker-e2e.mjs`: **39/39**, incl. one digest for two same-day crons, key `hull-and-havoc-moderation-digest-YYYY-MM-DD` |
| D1 migration rehearsal | `test:release:migrations`: **43/43**, incl. additive 0005 after 0004 and the historical Worker on the 0005 schema |
| Runbook D1 blocks | [digest-activation-runbook.md](digest-activation-runbook.md) setup and steps 4-8 run verbatim against a local stand-in (only `--env production --remote` rewritten; account calls stubbed; invalid API token); all OK; step 4 correctly STOPs once 0005 is applied |
| Moderation dashboard (Chromium) | `test:moderation:admin`: **28/28** |
| Menus incl. privacy pages | `scripts/menu.mjs`: **127/127**; `HULL & HAVOC` title fits at every tested size |
| GitHub Pages subpath | `scripts/pages-check.mjs`: **35/35**, incl. `/asteroids-bootdev/privacy/` (200, heading, contact, favicon, no off-site requests, back link, no sideways scroll at 360 px) |
| Worker production dry-run | `wrangler deploy --env production --dry-run`: 151.57 KiB; bindings `DB`, `ALLOWED_ORIGINS`, `MODERATION_DIGEST_TO`, `MODERATION_DASHBOARD_URL`; no sender or key (digest stays disabled) |
| Android unsigned release | `bundleRelease assembleRelease lintRelease -PallowUnsignedRelease=true`: success. Inspector `-Unsigned`: PASS (no `.so`, no server verifier, package/SDK/debuggable/permissions), WARN draft privacy text (expected). `aapt2`: package `ca.davidandrea.spacearcade` 1.0 (1), label **Hull & Havoc**. APK `ED631C99…EF8F14`, AAB `87A2C243…EF272` |
| Sideload copy (local debug key) | `hull-and-havoc-1.0-sideload-debugkey.apk`, `08348538…C35E24`, v2/v3 verified, 16 KB aligned. Not uploadable |

**Not run:** gameplay browser suites (`ranked-ui`, `ranked`, `touch`, `keyboard`, `combat`, `coop`, `gamepad`, `replay:browser`), because no gameplay code changed. No signed build, no device install, no real Resend delivery, no production read or write.

### Google Play: focused check of this candidate

Established by inspection or test:
- Package `ca.davidandrea.spacearcade`, version 1.0 (1), rules 1.2.0 frozen; launcher label Hull & Havoc; permissions INTERNET and VIBRATE only (the digest added none).
- Privacy URL `https://djblackett.github.io/asteroids-bootdev/privacy/` is used consistently in the page, the offline screens and the Play guide. It is **not live** until a release to `main`.
- Draft gate: the policy was approved 2026-11-12 and the offline screen no longer carries `DRAFT PRIVACY POLICY - REVIEW PENDING`. The signed-mode inspector still lists both markers and refuses any build that reintroduces one. Upload-key procedure (`ASTEROIDS_UPLOAD_*`, signed-mode inspector) unchanged.
- Reporting, blocking and the `/admin` workflow pass their suites. Gameplay requests do not depend on email.

Unresolved interpretation (not established; see [UGC readiness](leaderboard-moderation.md#google-play-ugc-readiness-rechecked-2026-11-12)):
- **Rules acceptance:** submit-as-acceptance with the rules one tap away. Play asks users to accept terms before creating UGC; whether an implicit "by submitting" suffices is a reviewer judgment. The conservative option is an explicit "Accept rules & submit" label (client-only change, not made here).
- **Blocking without accounts:** name-based device-local blocking; names are shared and changeable.
- **Ongoing moderation:** depends on activating the digest and on your actual response time, not on code.
- **Data safety:** the inventory supports the rows (name, app activity, IP-derived identifier, deletion by email). Internal-only testing is exempt; answers must be final before closed/open/production tracks.

## Device-test preparation — 2026-11-12

Branch `release/android-device-prep`; packaged sources unchanged from `f1a031a` (`dev` after a no-file-change merge of `main`). No push, deploy, production write, key generation or Play upload. Production access was SELECT-only D1 (`rows_written: 0`) plus Cloudflare analytics and deployment-status reads.

| Check (from phaser-asteroids, PowerShell, JDK 21.0.5) | Result |
| --- | --- |
| `npx vitest run --maxWorkers=4` | **Passed:** 67 files / 1,669 tests (1,667 + 2 new inspector/draft-marker tests) |
| `npm run typecheck --prefix server`, `npm run test:android-build`, rules-guard/production-health tests, `node scripts/rules-guard.mjs main` | **Passed:** typecheck; 8/8; 19/19; 0 released-rules changes |
| `npm run android:sync` | **Passed:** 1.0 (1) plays frozen rules 1.2.0/schema 1; production HTTPS origin baked in |
| `gradlew :app:bundleRelease :app:assembleRelease :app:lintRelease -PallowUnsignedRelease=true` | **Passed:** BUILD SUCCESSFUL; lint 0 errors / 14 warnings (same categories as before) |
| `inspect-android-release.ps1 -Unsigned` | **Passed**, with WARN for the bundled draft privacy text. AAB `8CC0A4F8…EFB2`, APK `284F84C1…D01C`: byte-identical to 2026-11-04 |
| Inspector refusals (new) | **Verified:** signed mode on the debug-key APK + unsigned AAB lists debug key, unsigned AAB and 4 draft-marker findings; debug APK refused as debuggable; missing `app-release.apk` refused |
| Sideload APK (release APK re-signed with local debug key) | **Built:** `apk/sideload/orbital-impact-1.0-sideload-debugkey.apk`, SHA-256 `11FEB5AB…E592`, v2/v3 verified, 16 KB zip-aligned. Not uploadable |
| `gradlew :app:assembleDebug` | **Passed:** `apk/debug/app-debug.apk` `E49AC998…6093` (diagnostic only) |
| Production cron (read-only) | **Verified indirectly:** daily 07:00 UTC invocation 8/8 days, 0 errors since deploy; prune effects visible in D1. See [current status](release-preflight.md#current-status-2026-11-12) |
| ADB devices | **Not stable:** Samsung SM-S901E appeared once via a local bridge, then `offline`. Nothing installed |
| Browser suites (ranked UI, menu, worker-e2e, moderation admin, migrations) | **Not re-run:** no change to their inputs since the 2026-11-04 passes at `549729f` |
| Physical device, 16 KB runtime, signed AAB, Play-delivered install | **Not run:** require a device, an upload key and Console access |

Tooling note: from the Bash tool, whose working directory had a lowercase drive letter (`c:\`), every Vitest file failed with `Cannot read properties of undefined (reading 'config')`. Running from a `C:\` working directory passed. This was an environment artifact, not a test failure.

## Backend release — 2026-11-04 (Stage 2)

The moderation Worker is live: merge `8569834` (tree identical to `549729f`), Actions run 41887905781, Cloudflare version `c2aef78f-ec27-4118-bd2c-a13f59b7313b` at 100% on D1 0001-0004. Pre-deploy local results at `549729f` matched the table below (1,667 unit, 40/40 migrations/historical client, 33/33 worker-e2e, 28/28 admin, 99/99 ranked UI, 127/127 menu). Live public (31/31) and admin read-only (19/19) checks passed. Details and remaining gates: [Stage 2 record](release-preflight.md#stage-2-production-worker-deployment-2026-11-04). Android old-device testing is still outstanding (0 ADB devices).

## Production preparation verification — 2026-11-04

Audited `dev` at `f540cafb2da864d3d3da52619910f062acfff9c3`. The moderation implementation is committed (`91c349c`, then `f540caf`); this pass adds local tests/docs. No commit/push/merge, production backup/export/restore/migration/deployment, credentials changes, score writes or Play upload. Five existing root `tmp/` deletions were preserved. See the [current release preflight](release-preflight.md) for readiness, compatibility findings, configuration uncertainties and exact approval-only production commands. Earlier sections below are historical snapshots.

| Command / check (from phaser-asteroids unless stated) | Exact result this pass |
| --- | --- |
| `npm test -- --maxWorkers=4` | **Verified:** 67 files / 1,667 tests passed |
| `npm run build` | **Verified:** frontend TypeScript, production browser and replay SSR builds passed |
| `npm run typecheck --prefix server` | **Verified:** passed |
| `npm run test:android-build` | **Verified:** 8/8 passed |
| `node --test scripts/rules-guard.test.mjs scripts/production-health.test.mjs` | **Verified:** 19/19 passed; mocked health cases intentionally log failures while testing refusal |
| `node server/scripts/worker-e2e.mjs` | **Verified:** 33/33 real workerd/local D1 checks passed |
| `node scripts/moderation-admin.mjs` | **Verified:** 28/28 Chromium/admin/local D1 checks passed |
| `node scripts/ranked-ui.mjs` | **Verified:** 99/99 passed; ranked verification, retry/expiry/time limits, reporting/blocking, touch/gamepad and layout |
| `node scripts/menu.mjs` | **Verified:** 127/127 passed; Chromium headless, no physical phone/controller/GPU |
| `npm run test:release:migrations` | **Verified:** 40/40 real local D1/historical Worker/client/recovery checks passed |
| `node scripts/production-health.mjs` | **Verified:** actual public production GET; rules 1.2.0 / schema 1 / supported 1.2.0 |
| Public production board/detail GETs | **Verified:** HTTP 200, required fields and Android CORS retained; still `public, max-age=5`, so current no-store change is not deployed on those reads |
| From server: `node node_modules/wrangler/bin/wrangler.js deploy --dry-run --env production --outdir .wrangler/release-dry-run` | **Verified:** compiled production Worker, 140.51 KiB / gzip 38.39 KiB; no deployment or secret-presence proof |
| `npm run android:sync` | **Verified:** production HTTPS endpoint baked in, frozen-version guard passed, latest assets copied, Capacitor App 8.1.2 synced |
| JDK 21.0.5, from android: `.\gradlew.bat :app:bundleRelease :app:assembleRelease :app:lintRelease -PallowUnsignedRelease=true --no-daemon --console=plain` | **Verified:** BUILD SUCCESSFUL, 175 actionable tasks (46 executed / 129 up-to-date); lint 0 errors / 14 warnings |
| `.\scripts\inspect-android-release.ps1 -Unsigned` | **Verified:** correct package/code/name/SDK/permissions; APK/AAB contain no `.so` or SSR verifier |
| Frontend/server lint | **Not applicable:** no configured lint script. TypeScript and Android lint results above are separate checks |
| Signed build, old installed APK, devices/16 KB runtime and Play-delivered install/update | **Requires manual verification:** not available/performed; unsigned artifacts are not release approval |

First sandbox launches failed on Worker source/log-directory access and Capacitor `uv_os_get_passwd ENOMEM`; authorized local tools passed with expanded local access. A dry-run initially invoked from the frontend directory failed to find Worker configuration; it was rerun successfully from `server`. No production fallback or configuration change was used. Browser suites ran sequentially to avoid port/resource interference. Local migration rehearsal first passed 34/34; the extended version passed 40/40 after correcting an unsupported local-export flag. Pinned Wrangler local export has no `--persist-to`, so the rehearsal uses an isolated config-relative default path. Export imported into a second empty D1 with matching score/run/report/audit counts and no foreign-key errors. Production Time Travel/export remains untested. ADB enumeration initially failed in sandbox; the expanded-access read-only retry found **0 authorized devices**, so physical/16 KB tests could not proceed. Scoped diff hygiene and 26 relative documentation links passed.

New unsigned artifacts built from the audited frontend (still containing draft privacy/contact placeholders):

| Artifact under phaser-asteroids | SHA-256 |
| --- | --- |
| `android/app/build/outputs/bundle/release/app-release.aab` | `8CC0A4F864573E394A160AB7A1771E618D20BB00CE71AA7A0A1E652F4775EFB2` |
| `android/app/build/outputs/apk/release/app-release-unsigned.apk` | `284F84C1EC9C596693AAF3767AF861D74AB15C40BD18034B0140B32EB1FBD01C` |

Package `ca.davidandrea.spacearcade`, version `1.0` / code `1`, compile/target 36, min 24, rules `1.2.0` / schema `1`. No keystore generated or signing performed. These replace the earlier artifact snapshot for local audit purposes only; later policy/version changes require rebuilding. Remaining gates: protected recoverable production backup, applied 0003/0004 and backend release, actual old-device compatibility, live cache/cron/admin/logging controls, public contact/approved hosted policy/provider retention/UGC decisions, signing, Console version history and internal/16 KB tests. **Blocked for production release.**

## Earlier moderation implementation follow-up — 2026-11-04

Audited existing implementation at `91c349c` on `dev` and extended it in the working tree. No commit, push, production migration/deployment, credential change or production score write. Existing root `tmp/` deletions remain untouched. This section supersedes the earlier moderation/API-scope statements below; older Android artifact hashes remain historical and were not regenerated.

| Check | Result |
| --- | --- |
| Full Vitest, four workers | 67 files / 1,667 tests passed, including 35 new moderation workflow tests |
| Worker TypeScript and frontend TypeScript/production browser+SSR build | Passed |
| Android build guard tests | 8/8 passed |
| Frozen-rules guard and production-health unit tests | 19/19 passed (health responses mocked; no production mutation) |
| Existing real workerd/D1 integration | 33/33 passed |
| Admin console, Chromium + disposable local D1 | 28/28 passed, including a new report invalidating a stale review in real D1; desktop and phone screenshots inspected |
| Existing menu browser regressions | 127/127 passed across phone/desktop layouts |
| Scoped diff hygiene and relative documentation links | Passed |
| Existing ranked UI browser regressions | 99/99 passed, including reporting/blocking, gamepad, retry, expiry, time limits and touch submissions |

The tests cover the existing data-preserving migration path, authorization across all admin routes, disabled administration, failed-auth throttling, cross-origin rejection, report deduplication/rate limits/retention, concurrent/stale decisions, name replacement and restoration on every score response, impossible-score bounds, audit pagination and transactional failure rollback. A real-D1 test exposed the previous exact-one-change erasure response bug: D1 counts FK cascades; deletion now succeeds for any positive primary-key delete change count. Erasure uses the actual score-to-run FK and retains only anonymous decision metadata.

First sandboxed Worker launches failed because Wrangler could not access its config/log directory and parent-directory bundle resolution. Tests were rerun with local tool access, using `--local` and disposable databases only. Concurrent final browser reruns timed out during initial navigation; the menu completed, and both moderation (28/28) and ranked UI (99/99) passed when rerun sequentially. No security checks or production settings were weakened. Test logs/screenshots are ignored under `phaser-asteroids/scripts/.smoke-output/moderation-*`.

See [the operator guide and adversarial assessment](leaderboard-moderation.md) for the finished contract and remaining release configuration. Pending migrations 0003/0004 must precede the Worker release; the backend must precede the new suspicious-score report option in Android. Verify Cloudflare cache overrides, cron, logging/backups and admin access. Establish review coverage, public contact, policy and backup erasure procedure. Google Play interpretation of nickname-only blocking and submit-as-acceptance remains unresolved; no compliance certification is claimed. Native Gradle/signing/device testing was not repeated in this server/UI follow-up; rebuild/sync and validate the eventual release artifact.

## Earlier 2026-11-03 evidence

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
4. ~~Separately authorize/report the Worker migration and deployment before enabling reports for testers.~~ **Done 2026-11-04** (Stage 1/2): reporting, moderation and the erasure route are live in production. Still open: implement the removal mailbox process (depends on item 1).
5. Human creates/protects the upload key or supplies an existing one; build and inspect signed artifacts and verify certificate fingerprints. Confirm Play has not already consumed version code 1; increment and append the release registry record if needed.
6. Test a Play-delivered build on a 16 KB emulator/device and Samsung/representative devices, including tablet/window behavior and backup/device transfer. No `.so` files makes ELF alignment inapplicable to the bundled app; it does not replace runtime testing. Complete the [internal-testing procedure](../phaser-asteroids/docs/google-play-release.md), target ages/content rating and branding pass before promotion.
