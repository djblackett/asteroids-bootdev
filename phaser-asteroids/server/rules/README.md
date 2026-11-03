# Frozen replay engines (supported gameplay rules versions)

The leaderboard Worker verifies a ranked run by re-simulating it. An installed Android app keeps the game it was built with until the
player updates it, so the Worker has to verify **several** rules versions at once: the current one and every older one a distributed
app still plays. This folder holds one frozen engine per supported version.

```
server/rules/
  1.2.0/engine.mjs        the simulation + verifier for rules 1.2.0: one self-contained ES module, built from src/replay. Never edited.
  1.2.0/engine.d.mts      its types (the four exports the server uses)
  1.2.0/fixtures/*.json.gz reference replays with the results this engine computes for them
  versions.json           every frozen version, its replay schema and the sha256 of each of its files
  released.json           every Android build handed out: the rules it plays, and when a successor replaced it
  policy.mjs              the compatibility rules as functions (used by the tests, the CI guard, the health gate, build:android)
```

[`../src/engines.ts`](../src/engines.ts) is the **allowlist**: one import and one `frozen(...)` line per version. Nothing outside it is
ever used to verify a run; the live sources in `src/` only produce the next frozen engine.

## How a version is chosen

| Step | What decides | Code |
|---|---|---|
| Issue (`POST /api/v1/runs?rules=1.2.0&schema=1`) | The client names the rules and schema it plays. A registered version (with that schema) is issued; anything else, or no query at all (web pages from before this), gets the current version, which is what every client got before. The client then refuses a challenge for rules it does not play ("update the app"). | `issueEngine` in `engines.ts`, `createRun` in `runs.ts` |
| Record | `runs.rules_version` stores the issued version. Each engine reads exactly one schema, so the version also fixes the schema. No migration was needed. | `runs.ts` |
| Verify (`POST /runs/:id/submit`) | The engine for the **stored** `rules_version`. Nothing in the submission can choose it: a replay whose header names other rules is rejected (`rules_mismatch`) before any engine runs. A version no longer registered is also `rules_mismatch`. | `verifyRankedReplay` in `verify.ts` |
| Health (`GET /api/v1/health`) | `rulesVersion` / `schemaVersion`: the current (default) version, as before. `supportedRules`: every registered version. | `router.ts` |

Run tokens, idempotent retries, the claim/finalize race handling, the elapsed-time rule, expiry and limits are unchanged: they never
depended on the version. A run issued under a version stays verifiable for its whole 60-minute window as long as that version is
registered, so a gameplay update deployed mid-run does not cost the player that run.

## What protects it

| Check | Where | Stops |
|---|---|---|
| Registry = `versions.json`; the current `GAMEPLAY_RULES_VERSION` is registered | `server/tests/rulesCompat.test.ts` (unit tests, before every deploy) | A rules bump without a frozen engine |
| Every file under `<version>/` matches its pinned hash; nothing added or missing; the engine imports nothing | same | An accidental edit of a frozen engine |
| Each version's reference replays still give the recorded results through its frozen engine, and the current version's also through the **live sources** | same | A gameplay change made without a rules bump (it fails here, and the server lifecycle tests fail too, so "update the expected score" no longer works) |
| Every version a distributed Android build still needs is registered | same, and `scripts/production-health.mjs` against the deployed Worker's `supportedRules` | Dropping a version too early |
| Frozen files are never modified and only deleted once retired; `versions.json` entries never change; `released.json` records are permanent (their dates are filled in once, `supersededOn` not backdated) | `scripts/rules-guard.mjs` in CI, against the merge base | Re-pinning a hash, or deleting the records that make a version required |
| The app's rules are frozen and its `versionCode` is recorded with those rules | `npm run build:android` (`scripts/build-android.mjs`) | Shipping an app the CI gate does not know about |

## Changing gameplay (a rules bump)

Visual, audio and menu changes need no bump. Anything that changes the simulation's outcome (physics, spawning, collisions, scoring,
drops) does; `rulesCompat.test.ts` tells you when.

1. Change gameplay. Bump `GAMEPLAY_RULES_VERSION` in `src/replay/constants.ts` (and `REPLAY_SCHEMA_VERSION` if the replay format changes).
2. `npm run rules:freeze`. It builds the engine from the current sources into `server/rules/<new>/`, records reference replays with it and
   adds the `versions.json` entry. Register it in `server/src/engines.ts` (the script prints the two lines). **Keep the old version
   registered.** Until the change is merged you can re-freeze with `npm run rules:freeze -- --replace`; once on `main` it is final.
3. Decide the scoring era in `src/ranked/scoringEras.ts` (same era: old-app and new-app players share the weekly board; new era: old
   scores only on all-time). That is a product decision, not a compatibility one.
4. `npm test`, then merge. CI deploys a Worker that verifies **both** versions, checks `supportedRules` covers every distributed app,
   then publishes the web build (web players move to the new rules at once).
5. Android: raise `versionCode` / `versionName` in `android/app/build.gradle`, add the build to `released.json`
   (`"distributed": null, "supersededOn": null`), `npm run build:android`, upload, staged rollout. Build the APK only from a commit whose
   Worker is already deployed (`node scripts/production-health.mjs` must pass): an app whose rules the Worker does not know yet would be
   told to "update".
6. When the new build reaches 100 % of the rollout, set `distributed` on it and `supersededOn` (that day) on every older build. That
   starts the older rules' support period.

## Retirement policy (initial)

- **Android rules versions:** supported for at least **90 days** (`policy.supportDays`) after the last build that plays them is
  superseded. CI enforces this minimum. Before removing a version, also check it is barely used:
  `SELECT rules_version, COUNT(*) FROM runs WHERE created_at > <now - 14 days> GROUP BY 1` should show it at under about 2 % of issued
  runs; if not, wait another 30 days and look again. Players still on it then see "update the app" and keep Practice.
- **Web-only versions** (never in an Android build): they only serve web tabs opened before a deploy and runs started under them (60 min).
  Keep them at least 7 days, then retire them with the next clean-up. CI does not track them.
- **Retiring:** one change that removes the `frozen(...)` line and import from `engines.ts`, deletes `server/rules/<version>/` and its
  `versions.json` entry. The guard allows that only when no `released.json` build still requires the version. Runs of that version issued
  in the hour before the deploy are then rejected (`rules_mismatch`); that is the accepted cost at the end of the support period.
- Each engine is about 89 KB (26 KB gzipped) in the Worker bundle; even a dozen versions are far below the Workers size limit. CPU per
  submission does not grow, since one engine runs.

Not done on purpose: no soft "update available" notice, no per-version kill switch, no staging Worker. Add them when real usage asks.
