# Audit: Android release risks — ranked backend, security, browser suites

2026-11-02 · branch `dev` @ `a8acf66` (working tree clean; the Android work is committed there) · paths relative to `phaser-asteroids/`
· file and line references are to `a8acf66`

Scope rules followed: nothing deployed, pushed, merged or committed. No repo file changed (only `dist/` was rebuilt, which is
git-ignored). No production request was made. No secret was read. The probes were throwaway scripts in a scratch folder outside the
repository and are not committed; their output is quoted below. They were: router + service tests against in-memory SQLite (the
"audit probe"), a Playwright phone probe against a local static server (the "phone probe"), and patched *copies* of two suites.

> **Status (follow-up, 2026-11-02, also on `dev`).** Done since this audit: #1 and #2 (multi-version ranked replay with frozen
> engines, reference replays, CI guards; see [`server/rules/README.md`](../server/rules/README.md)), #3 (the global submission budget
> is now spent only after the token check), #8 (stale suite expectations updated), #9 (POWER-UPS layout fixed) and the Point-to-Fly
> flake in §6 (root-caused to a UFO hitting the ship during the check; the test's world reset now removes UFOs). Still open, by
> decision: #4 (IPv6 /64 buckets), #5 (persisting unsent runs), #6 and #7. The body below is the audit as written.

---

## 1. Executive summary

1. **The main release risk is confirmed, and it is worse on Android than `docs/android.md` says.** On a phone the big PLAY button
   *is* ranked play (`src/ui/menu/pages/title.ts:28-30`, `src/scenes/StartScene.ts:285`). The Worker verifies exactly one rules
   version, ignores what the client runs, and CI redeploys it on every merge to `main` that touches `phaser-asteroids/**`. So the
   first gameplay merge after release makes the main button of **every installed app** say "RANKED PLAY NEEDS A NEWER VERSION OF THE
   APP" until that user updates. Runs in progress at deploy time are rejected for good. Rules changed three times in about 36 hours
   (1.0.0 on Oct 22, then 1.1.0 and 1.2.0 on Oct 23), so this will happen soon after release unless something prevents it.
2. **Multi-version support is cheap in this codebase.** The whole simulation plus verifier already builds into one self-contained
   module (`dist/node/index.js`: 88.7 KB, 26 KB gzipped, no imports) that exports exactly what the server needs. Keep one frozen copy
   per supported rules version, pick it by `runs.rules_version` (already stored), and add one query parameter. Router, D1 schema, run
   lifecycle and boards stay as they are. No migration.
3. **Before release, P1 needs only two small items:** (a) the APK sends its rules version when it asks for a challenge, so no future
   server has to guess; (b) a CI guard that stops a rules bump from deploying while it would strand shipped apps. The registry itself
   can come after release, but it must land before the first rules bump after release.
4. **The backend core is sound.** Re-simulation, single-use claims, idempotent retries, race handling, bounded body reading and
   secret handling all held up under code review and probes. I found no way to tamper with a replay beyond the known, documented
   bot / offline-optimisation limit.
5. **Two rate-limit weaknesses are confirmed but unlikely to be exploited.** Requests with no token use up the *global*
   verification budget. Per-IP buckets use the full IPv6 address, so one /64 gets unlimited buckets. Both are cheap to fix and
   neither blocks the release.
6. **Both reported browser failures are stale test expectations, not app regressions, and have nothing to do with Android.** Two
   Oct 23 commits changed the app without updating `touch.mjs` and `menu.mjs`: `5033ac8` made phone PLAY = ranked, and `ccce3ce`
   (Chain Lightning) changed the MEGA POWER legend text. Each suite aborted at its first stale PLAY tap, which hid the rest of it.
   With only the stale expectations corrected (in scratch copies), the suites ran to completion and surfaced **one real regression**:
   since Chain Lightning added a seventh row, the POWER-UPS guide's Revive sentence sits under the BACK button at every phone and
   desktop size (#9). They also showed one pre-existing intermittent touch flake. Details in §6.

---

## 2. Confirmed issues, ranked

| # | Issue | Impact | Likelihood | Before release? |
|---|---|---|---|---|
| 1 | A rules bump strands every installed app (PLAY breaks; in-flight runs rejected) | High | Near-certain at the next gameplay merge | **Yes: send the version + CI guard** |
| 2 | Nothing catches a simulation change that ships without a rules bump | Medium (high once there are several versions) | Likely over time | **Yes: same CI work as #1** |
| 3 | Requests with no token use up the global submit/start budgets | Medium (ranked unavailable for everyone for ≤1 h) | Low (needs a motivated griefer) | No; fix soon |
| 4 | Per-IP buckets key on the full IPv6 address | Low–Medium (cancels out per-IP limits) | Low | No; fix along with #3 |
| 5 | A finished but unsent ranked run exists only in memory | Low–Medium (run lost if Android kills the app) | Medium on mobile | No |
| 6 | `rules_mismatch` uses up the run and reads like a cheating verdict | Low (UX) | Only around deploys | No; goes away with #1 |
| 7 | A run stuck in `verifying` past expiry answers 409 "busy" until pruned (≥24 h) | Low | Very low | No |
| 8 | `touch.mjs` / `menu.mjs` expect the old phone PLAY and the old legend text | Test-only | Certain (fails every run) | Fix before relying on them for release testing |
| 9 | POWER-UPS guide: the Revive sentence overlaps the BACK button (all sizes) | Low (visible text overlap on a menu page) | Certain | Yes: cheap and player-visible |

### #1 A rules bump strands installed apps

Exactly how it breaks:

1. A gameplay change bumps `GAMEPLAY_RULES_VERSION` (`src/replay/constants.ts`) and is merged to `main`.
2. CI deploys the Worker (`.github/workflows/deploy-gh-pages.yml:156`), and only then Pages. The Worker's only version is compiled in
   (`server/src/config.ts:16`, `:82`).
3. **New ranked starts from an installed APK.** `POST /api/v1/runs` sends no body (`src/ranked/api.ts:130`). The server issues
   `settings.rulesVersion` whatever the client is running (`server/src/runs.ts:90`). The app compares that to its own compiled
   version (`api.ts:142-143`) and gives up with `update_required`. The ranked page then shows "RANKED PLAY NEEDS A NEWER VERSION OF
   THE APP. UPDATE THE APP, OR PLAY PRACTICE." (`src/ui/menu/pages/ranked.ts:45-49`). Because phone PLAY is the ranked door, the
   main button stops working. Recovery depends on Play review time plus each user's update delay (days to weeks). A sideloaded APK
   never recovers.
4. **Runs in progress, or finished but not yet sent** (web and Android): the submit is claimed and then rejected at
   `server/src/verify.ts:64` with `rules_mismatch`. The run is marked `rejected`, which is final. The result page says "THE SERVER
   COULD NOT CONFIRM THIS RUN, SO IT WAS NOT ADDED TO THE LEADERBOARD. REASON CODE: RULES_MISMATCH"
   (`rankedResult.ts:175`, `:77`).
5. **The opposite order fails too.** A 1.3.0 APK released before the Worker deploys gets the same block, telling the *newer* app it
   "needs a newer version". So today the only safe order is: deploy the Worker first, then publish the APK, and accept that the
   older APKs break.
6. Reading the boards keeps working. An old app shows "VERSION UNKNOWN" next to scores from an era it doesn't know
   (`src/ranked/scoringEras.ts:19-21`). That is cosmetic.

Evidence (audit probe: real router + in-memory SQLite):

```
PROBE rules-bump first 422 {"code":"replay_rejected",...,"reason":"rules_mismatch","detail":"this run was issued under rules 1.2.0; the server now verifies 1.3.0"}
PROBE rules-bump retry 409 run_rejected row {"status":"rejected","reject_reason":"rules_mismatch"}
PROBE old-client update_required
PROBE runs-ignores-client-version 201 1.2.0      <- asked for 1.1.0 by query AND body; server issued its own
```

Can the current design support several versions safely? **Not as it stands, but it is close.** The places that hard-code "one
version" are few: the equality check at `verify.ts:64`, `settings.rulesVersion` at issue time (`runs.ts:90`), the health payload
(`router.ts:51`) and the deploy gate (`scripts/production-health.mjs:20`). Everything else is already per-run:
`runs.rules_version`, `config_json` and `time_limit_ticks` are stored at issue and used at verify time, and `scores.rules_version`
drives the boards. The only true single-version dependency is the import of one simulator (`server/src/verify.ts` →
`src/replay/verifier` → `src/core`).

### #2 No guard against simulation changes without a rules bump

`tests/replayDeterminism.test.ts` checks that the *current* code agrees with itself (two runs, different refresh rates). It cannot
notice that today's code differs from last week's. The bot reference score (`server/tests/lifecycle.test.ts:66`, `34735`) does fail
when the sim changes, but the bot replays against the current sim, so the usual fix is to update the number. Commit `c41789e` "update
gain and UFO drop expectations" shows that habit. Nothing ties updating the number to bumping the version.

What it costs when this slips: clients always send `claimedResult` (`src/replay/recorder.ts:86-131`), so a recording from an older
client verified by drifted code ends in a **final** `score_mismatch` rejection (`verifier.ts:283-293`, `verify.ts`). Honest players
see a cheating-style rejection. Once frozen per-version bundles exist (§5), this guard decides whether a frozen bundle really
reproduces the version it is named after.

The boss merge (`25aa823`) was checked and changed only tests, so no unbumped sim change has shipped so far.

### #3 Requests with no token use up the global budget

`server/src/router.ts:71-72` increments `submit:ip:*` and then `submit:global` **before** `submitRun` checks that the run exists or
that the token is valid. The same happens for starts at `:58-59`. Junk POSTs to random run ids (404) therefore use up the hourly
budget meant to cap verification CPU (default 1200/h). Real players then get 429, which the client turns into "network error" after
two automatic retries.

```
PROBE junk 0..2 404 run_not_found     (3 junk requests, 3 different IPs, submitGlobal = 3)
PROBE legit-after-junk 429 rate_limited   <- a genuine, verifiable run is refused
```

Fix: check the per-IP bucket, then load the run and check the token, then count against `submit:global`. Only requests that can
actually reach verification should spend the CPU budget. The start bucket cannot be protected the same way (anyone may start a run);
#4 is what limits that.

### #4 IPv6 per-IP buckets

`router.ts:126` hashes the whole `cf-connecting-ip`. A single /64 (an ordinary home line or a cheap VPS) holds 2⁶⁴ addresses.

```
PROBE ipv6-rotation 201,201,201,201,201,201 same-ip 201,201,429   (startPerIp = 2)
```

Fix: for IPv6, bucket on the /64 prefix. That is one line in `clientHash`.

### #5 A finished but unsent run lives only in memory

The token, the challenge and the prepared body are in memory only (`api.ts:14`, `submission.ts`). Only accepted scores reach
`localStorage` (`localScores.ts:91`). On Android, if the player finishes offline, switches apps and the OS kills the WebView, the
run is gone even though the server would still accept it for up to 60 minutes. A fix is to store the `PreparedSubmission` until a
final outcome and offer it again on the next launch. Small, but not needed for a first release.

### #6 Wording of `rules_mismatch`

It is a server limitation, not something the player did wrong, yet it uses up the run and displays like a verification failure
(#1, step 4). With #1 fixed it only happens when a version is finally retired. At that point a plain "THE GAME WAS UPDATED DURING
THIS RUN" line in `reasonText` (`rankedResult.ts:75-78`) is enough.

### #7 Run stuck in `verifying` after its expiry

If the Worker is killed mid-verification (CPU limit, eviction), the 30 s lease lets a retry take over. But the takeover UPDATE also
requires `expires_at > now` (`runs.ts:155-158`). If the crash falls inside the run's last 30 s, every retry gets
`409 run_in_progress` (`runs.ts:249-250`). The client treats that as temporary, so the player sees an endless "retry" until the daily
prune removes the row a day later.

```
PROBE stuck-verifying-after-expiry 409 run_in_progress
```

Fix (optional): in `resolveLostClaim`, answer 410 when `status = 'verifying'` and the run has expired.

### #8 Stale browser-suite expectations

See §6.

### #9 POWER-UPS guide: Revive text under the BACK button

Found by the `menu.mjs` layout review (10 failures, one per screen size: 5 phones, 5 desktops). That review never ran on `main`,
because the suite aborts at line 680 first. Every failure reports the same thing: `[powerups] text "Brings back a teammate w" runs
over button back`. The layout review's screenshot of the iPhone POWER-UPS page (written to a scratch folder, not kept) shows the last row's two-line description cut
off by BACK. Cause: `ccce3ce` added a seventh entry (LIGHTNING) to `POWERUP_INFO` (`src/ui/menu/powerupInfo.ts`), while the guide
page (`src/ui/menu/pages/powerups.ts`, unchanged since Oct 20) still lays rows out for six. This is a real, player-visible
regression in every build, the Android app included. Fix by tightening the row pitch or moving BACK; the layout review will then
check it.

---

## 3. Checked and sound (no action)

- **Replay tampering.** The server re-simulates. The issued seed, rules version and exact config are enforced, with extra config
  keys rejected (`verify.ts:34-47`, `:64-71`). The claimed score is only a cross-check and is never used as the score. A tick cap,
  an elapsed-time rule and a strict game-over / exact-time-limit end are all enforced (`verify.ts:73-106`, `verifier.ts:231-279`).
- **Challenge issue and expiry.** Run id is a UUIDv4. The token is 256-bit CSPRNG, only its SHA-256 is stored, and comparison is
  constant-time on the hashes. The seed is CSPRNG. The challenge response is `no-store`. Expiry is checked before the body is read,
  and the client corrects for its own clock (`localExpiry`).
- **Duplicates and retries.** The client builds the body once and resends identical bytes (`submission.ts`). The server hashes the
  *decoded* body, so a gzip resend matches: `PROBE idempotent 200 false | 200 true | 409 run_already_submitted`.
- **Concurrent submissions.** Every state change is a conditional UPDATE or a D1 batch tied to a claim token, with
  `scores.run_id UNIQUE` as a backstop. Probe: 8 identical parallel submits → `200, 7×200:replayed`, `scores 1`. Caveat: one JS
  thread serialises this probe, so it checks the state machine, not real D1 parallelism. The existing lifecycle tests also cover
  different-nickname races, DB failure on finalize, lease takeover and verifier crashes (`lifecycle.test.ts:251-512`).
- **Body limits.** Content-Encoding allow-list, Content-Length pre-check, streaming byte counting, and a cap on decompressed output
  that stops gzip bombs (`body.ts`). The body is read only after the token check.
- **CORS.** Correct, and correctly described as hygiene rather than authentication (`router.ts:165-190`). Probe: allowed origin
  201 + ACAO, foreign origin 403, no origin 201, spoofed origin from a non-browser 201 (expected; that is why the run token is the
  real credential). The Capacitor origin `https://spacearcade.davidandrea.ca` (`capacitor.config.ts`) matches production
  `ALLOWED_ORIGINS`, which only takes effect once the Worker deploys. `dev` changes no sim or server code compared with `main`, only
  that origin.
- **Credentials and dev surfaces.** No secret is committed: `.dev.vars.example` holds placeholders, and the production secrets are
  generated locally and DPAPI-encrypted under the git-ignored `server/.wrangler/`. Production declares both secrets `required`, so
  the `'dev-only-salt'` fallback (`config.ts:106`) cannot reach production. Local origins live only in `[vars]`, which `env.production`
  does not inherit. `preview_urls = false`. The admin route doesn't exist without a ≥16-character token, has no CORS headers, and
  rate-limits failed attempts. The Android API base cannot be redirected by `?api=` or loopback rules (`api.ts:97-110`), and
  `build-android.mjs` enforces the production URL. The only dev-only game hook is gated by `import.meta.env.DEV`
  (`GameScene.ts:290`). `.env.android` holds only the public `VITE_LEADERBOARD_API_URL`.
- **DB consistency and cleanup.** CHECK constraints tie status to `score_id` / `reject_reason`, and FKs are on. The daily cron prunes
  abandoned runs (expiry + 1 day), rejected runs (30 days) and old rate-limit windows. Accepted runs are kept for their scores. All
  growth is capped by the global rate limits.
- **Mobile timeouts.** 10 s for challenge and board fetches; 30 s XHR for submit with automatic retries at 1.5 s and 4 s, then a
  manual Retry with the same bytes. A response lost after acceptance comes back as the same score. That is a sensible design for
  cellular links.

## 4. Hypothetical risks (not findings)

- **Bots / offline optimisation on the revealed seed.** Already documented as known limitation #1 in `docs/leaderboard-backend.md`.
  The 60-min TTL against a 20-min run leaves about 40 minutes of offline search. Shortening the TTL trades this against Android
  pause/resume tolerance. Leave it as is until there are real players.
- **Carrier-grade NAT** could put unrelated mobile players in one per-IP bucket (30/h). That is unlikely at this scale. Watch for
  429s (`run_rejected` / `rate_limited` are already logged) before acting.
- **Request-flood cost.** As with any public Worker, every request costs a D1 write for the rate-limit row, so cost exposure equals
  the attacker's request rate. A Workers Rate Limiting binding in front would be the cheap mitigation if it ever matters.
- **`CapacitorHttp`.** If someone later enables it, requests go native: the `Origin` header and `xhr.upload.onload` (used for the
  "verifying" state) behave differently. It is off today. Note it in `docs/android.md`.

---

## 5. Recommended design for several replay-rule versions

### Compatibility units: three, not two

| Unit | What it covers | Policy |
|---|---|---|
| **HTTP API** (`/api/v1`) | request envelope, response fields, error codes | Additive only. Never remove or retype a field a supported client reads. A breaking change becomes `/api/v2` running beside v1. |
| **Rules + replay schema** | simulation behaviour and replay JSON shape | **One unit: one frozen verifier bundle.** Each bundle's `validateReplayStructure` already pins both (`verifier.ts:43-47`). Don't give them separate support policies; a schema bump always ships as a new bundle. |
| **Issue policy** | ranked config, time limit | Already stored per run (`config_json`, `time_limit_ticks`). Keep it that way. |

So the answer to "should schemas and rules have independent compatibility policies" is: **keep them distinguishable, but support
them together.** Two independent support matrices would cost more than they give. The axis that truly needs its own policy is the
HTTP API.

### Shape (the whole design)

```
server/rules/1.2.0.mjs              frozen copy of dist/node/index.js, built while 1.2.0 was current. Never edited.
server/rules/fixtures/1.2.0/*.json  golden replays + expected {score, totalTicks, endReason}. Never edited.
server/rules/released.json          rules versions shipped in Play builds (+ release date)
server/src/engines.ts               ~10 lines:
```

```ts
import * as current from '../../src/replay';
import * as v1_2_0 from '../rules/1.2.0.mjs';
type Engine = Pick<typeof current, 'verifyReplay' | 'GAMEPLAY_RULES_VERSION' | 'REPLAY_SCHEMA_VERSION' | 'FIXED_TICK_RATE'>;
export const ENGINES: Readonly<Record<string, Engine>> = { '1.2.0': v1_2_0, [current.GAMEPLAY_RULES_VERSION]: current };
```

Changes to existing code:

- **Client** (`api.ts:130`): `POST /api/v1/runs?rules=${GAMEPLAY_RULES_VERSION}&schema=${REPLAY_SCHEMA_VERSION}`. A query string
  keeps it a CORS "simple" request, so mobile pays no extra preflight round trip. The server can ignore it until the registry lands.
- **Issue** (`router.ts` / `runs.ts:90`): `rules = ENGINES[asked] ? asked : current`, and issue that engine's schema version. For an
  unsupported or missing version the server keeps doing exactly what it does today. The client check already shipped
  (`api.ts:142`) then shows the correct "update the app" message, with no new error path. That fallback is also what makes the
  query parameter safe to add now.
- **Verify** (`verify.ts:64`): swap the equality for `const engine = ENGINES[run.rulesVersion]` (missing → `rules_mismatch`) and
  call `engine.verifyReplay(...)`. The `verifyReplay(replay, { maxTicks, requireGameOver, timeLimitTicks })` signature becomes a
  contract that every bundle must keep. The fixture test enforces it.
- **Health** (`router.ts:51`): add `supportedRules: Object.keys(ENGINES)`. Keep `rulesVersion` (current) for existing readers.
- **Freeze step**: `npm run rules:freeze` builds the SSR bundle from the *current* tree into `server/rules/<current>.mjs` and records
  a sha256. Run it **before** editing gameplay for the next bump. No worktrees, tags or old toolchains.
- **Boards**: no change in mechanics. `SCORING_ERAS` decides each time: put a small balance bump in the *same* era so old-app and
  new-app players share the weekly board, or give it a new era so old-app scores appear only on all-time. That is a product call per
  bump.
- **Retirement**: remove an engine once usage is near zero and a window has passed (say 30 days after the successor APK reached
  100 % in Play). Usage needs no new telemetry, because `runs.rules_version` already records it:
  `SELECT rules_version, COUNT(*) FROM runs WHERE created_at > ? GROUP BY 1`.

Cost: about 26 KB gzipped per retained version, against the 10 MB compressed limit on Workers Paid. CPU per submit is unchanged,
since one engine runs.

Alternatives considered and rejected:
- *Version flags inside `src/core`* (`if rules >= 1.3`): every balance tweak turns into permanent branches in the hot loop, and old
  versions break silently.
- *One Worker per rules version*: duplicates the backend, D1 binding, cron and secrets, and cross-version ranks would need
  coordination.
- *Rebuilding old bundles from git tags in CI*: depends on old toolchains reproducing byte-for-byte. A committed artifact is simpler
  and easy to audit.

### How CI catches breaking changes before deploy

1. **Golden fixtures.** A unit test checks every `fixtures/<v>/*.json` through `ENGINES[v]` and asserts the recorded result. The
   fixture for the current version fails when gameplay changes without a bump, and the only way to make it pass is to bump and
   freeze. The existing bot (`server/testing/bot.mjs`, `REFERENCE_SEED`) can generate a game-over run plus a time-limited run.
2. **Immutability.** A CI step checks that
   `git diff --name-only --diff-filter=MD origin/main...HEAD -- phaser-asteroids/server/rules` is empty. Adding files is allowed.
3. **Supported-set guard.** A unit test requires every version in `released.json` that is still inside its window to be in
   `ENGINES`. `scripts/production-health.mjs` checks `supportedRules ⊇ released ∪ {current}` after deploy. CI then refuses to
   promote a Worker that strands an installed app.
4. **APK preflight.** When building a release, `build-android.mjs` GETs production `/health` and refuses if the app's rules version
   is not in `supportedRules`. That covers the "APK before Worker" hazard. It is a read-only GET.

**Interim minimum, before the registry exists:** `released.json` plus one test: "if `released.json` is not empty,
`GAMEPLAY_RULES_VERSION` must be listed in it." That blocks any rules bump while an APK is live. It is crude but enough for the
release.

### Is a staged rollout worth it?

- **Yes, as an order of steps** for each rules bump: *expand* (the Worker verifies old and new) → *migrate* (web updates at once;
  the APK goes through Play) → *contract* (retire the old engine after the window). This is what removes the cliff.
- **Yes, Play Console staged rollout** for the first releases. It is free and catches WebView or device problems, not rules problems.
- **Not now: Cloudflare gradual deployments, or a separate staging Worker.** When every Worker serves a superset of versions, any
  version can verify any run, and `wrangler rollback` is enough. LAN `wrangler dev` already covers device testing
  (`docs/android-lan-testing.md`). Add a staging Worker only if a Play internal-testing track needs a stable backend.

---

## 6. Root cause of the two failing browser suites

**Classification: outdated test expectations.** Not app regressions, not timing, not Android. The test harness itself is fine.
One environmental detail changes the error text but not the outcome (below). Once the suites could run past those points, they
also exposed a real layout regression (#9) and a pre-existing intermittent flake.

### Cause A: phone PLAY became ranked (`5033ac8`, 2026-10-23); both suites

`5033ac8` "add mobile entry point for practice mode" made a one-player touch or coarse-pointer title use `buildMobilePlay`
(`title.ts:205-227`). There, **PLAY = ranked** ("ONLINE LEADERBOARD / 20:00 LIMIT") and the casual game is **PRACTICE**.
`StartScene.start()` sends PLAY to `requestRanked()` (`StartScene.ts:282-292`). That commit added `scripts/mobile-entry.mjs` and
`tests/mobileEntry.test.ts`, but `touch.mjs` and `menu.mjs` were last edited Oct 21–22 and still tap `play` expecting `GameScene`.
No Worker runs during these suites, so the challenge request fails and the scene never changes. Each suite has a 5 s
`waitForFunction` that throws, which **aborts the rest of the suite**.

Phone probe (844×390, `isMobile`, `hasTouch`, fresh build of HEAD):

```
title items: ["play=PLAY","practice=PRACTICE","scores=HIGH SCORES","audio=AUDIO","controls=CONTROLS","ranked=RANKED INFO","powerups=POWER-UPS"]
after PLAY + 5 s: scene = StartScene | menu page = ranked | ranked = {"phase":"failed",...,"message":"The ranked service could not be reached"}
network: ["REQ POST http://127.0.0.1:8787/api/v1/runs","FAILED POST http://127.0.0.1:8787/api/v1/runs net::ERR_FAILED"]
after PRACTICE + 1.5 s: scene = GameScene
```

Stale sites:
- `scripts/touch.mjs:1596-1597`: the shared `play()` helper. This is the reported timeout, and the first section already calls it.
- `scripts/touch.mjs:1028-1029`: iOS "Fullscreen unsupported" section, same pattern.
- `scripts/touch.mjs:1958` and `:1963-1964`: a phone in keyboard mode now also gets the mobile layout (`title.ts:73`), so the label
  is `PLAY`, not `PLAY WITH KEYBOARD`, and Space (the PLAY hotkey) goes to ranked.
- `scripts/touch.mjs:1986`: `?touch=0` on a phone expects `PLAY WITH KEYBOARD`. A probe shows `?touch=0` is honoured
  (`tc-active` absent); only the label changed.
- `scripts/menu.mjs:679-680`: the reported timeout.
- `scripts/menu.mjs:847-848`: the phone layout review. It never runs today because the suite aborts at 680.

Environmental detail: `127.0.0.1:8787` is held by `wslrelay` (a WSL port-forward running since Oct 30), so the failure shows as a
CORS rejection rather than connection refused. If a permissive local Worker were ever listening there, these suites would quietly
start **ranked** runs instead of casual ones. That is one more reason to tap PRACTICE.

### Cause B: legend text changed by Chain Lightning (`ccce3ce`, 2026-10-23); menu.mjs only

`ccce3ce` changed MEGA POWER's short label from `'All powers!'` to `'4 powers!'` (`src/ui/menu/powerupInfo.ts`) and added
LIGHTNING. `scripts/menu.mjs:289` still requires `'All powers!'`, and the probe confirms the title shows `4 powers!` and
`LIGHTNING`. This is the "power-ups text assertion failure" logged just before the timeout.

### Confirmation run: patched copies

A small script copied both suites into a scratch folder. It corrected only the stale sites above (PLAY → PRACTICE
where PRACTICE exists, `All powers!` → `4 powers!`; for the keyboard-on-phone case, one key press followed by the scene's own
`playNormally()`) and pointed screenshots at the scratch folder. The suites ran one after another with nothing else running, against a
fresh build of HEAD.

| Suite | Result | Remaining failures |
|---|---|---|
| `touch.mjs` (full, 4m44s) | **356 pass / 3 fail** (previously aborted after a few checks) | 2 × stale label (`:1958`, `:1986`, cause A); 1 × intermittent flake (below) |
| `menu.mjs` (full) | **117 pass / 10 fail** (previously aborted at 680) | 10 × the real POWER-UPS overlap, one per screen size (#9) |

**Intermittent flake: `touch.mjs:189` "[Point-to-Fly] thumb … four diagonals".** I ran the movement section on its own 4 more
times. It failed in 2 of 5 runs overall, each time on a *different* diagonal (`up-right: rot 295 vs 225`, `down-left: rot 20 vs
45`), and passed in the other three. The turn rate is 300°/s (`src/core/constants.ts:70`), so under a constant command every case
settles well inside the 0.9 s of *simulated* time the check waits. Ending 25–70° off means the input changed during the window: a
race in the test's finger-up → 60 ms → recentre → finger-down loop (`touch.mjs:169-180`), not a steering defect. The steering
path is the same on `dev` and `main`: the only touch changes on `dev` are the fullscreen environment and CSS safe-area fallbacks,
which resolve to the same `env()` values in a browser. Earlier sessions logged similar one-off movement flakes in this suite. I
did not A/B it against a `main` worktree. Do that only if it starts failing consistently.

---

## 7. Minimal implementation plan, in order

**Before the Android release**

1. Client sends `?rules=&schema=` on `POST /api/v1/runs` (`api.ts:130`), plus a unit test. The server ignores it for now. About
   3 lines.
2. Add a golden replay fixture for 1.2.0 (bot-generated: game over + time limit), a test that verifies it, and the CI
   immutability step.
3. Add `server/rules/released.json` and the interim guard ("no rules bump while an APK is live").
4. Update the 7 stale browser-suite sites (§6) so `touch` and `menu` become a usable regression signal for release testing. Then
   fix the POWER-UPS layout (#9), which the layout review will check.
5. Deploy the Worker (Android origin) before handing out any APK, then run the device checklist (`docs/android.md`).

**Before the first rules bump after release**

6. Freeze script, `server/rules/1.2.0.mjs`, `engines.ts`, the issue/verify changes, `supportedRules` in health, and the updated
   health gate and APK preflight.
7. Write the bump runbook into `docs/leaderboard-backend.md` §8: freeze → change gameplay → bump → add new fixture → decide the
   era → merge (the Worker now serves both) → build and submit the APK → retire after the window.

**Can wait**

8. Rate limits: count `submit:global` after the token check, and bucket IPv6 by /64 (#3, #4).
9. Keep the prepared submission until a final outcome (#5).
10. Answer 410 for expired-while-verifying runs (#7), and give `rules_mismatch` friendlier wording (#6).

## 8. Before release vs later

| Before release | Can wait |
|---|---|
| Client sends its rules version (#1) | Full engine registry (needed before the *first post-release* rules bump) |
| CI guard: golden fixture + immutability + released-version guard (#1, #2) | Global-budget ordering, IPv6 /64 buckets (#3, #4) |
| Worker deployed with the Android origin before any APK goes out | Persisting unsent runs (#5) |
| Stale suite expectations fixed, so release testing has a working signal (#8) | 410 for expired-while-verifying; `rules_mismatch` wording (#6, #7) |
| POWER-UPS Revive/BACK overlap (#9) | Point-to-Fly diagonal test race (§6) |
| Device checklist (already planned) | Bot detection, staging Worker, Cloudflare gradual deploys |
