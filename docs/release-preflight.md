# Ranked leaderboard release preflight — 2026-10-22

**Decision: suitable for a reviewed feature commit; HOLD deployment.** No critical score-forgery or credential-disclosure defect was found. Resolve the mobile start safeguard below, finish the bounded verification gates, and supply production configuration before a controlled release. Keep the production time limit fixed at 1,200 seconds until the configuration-change defect is fixed.

This was an audit. No application code, existing tests, configuration, history or cloud resources were changed. No commit, push, merge or deployment was performed. This report and ignored local verification artifacts are the only additions from this task.

## 1. Repository state

- Branch: `feature/leaderboard-ui`; HEAD `0963cd4` (`Add ranked leaderboard functionality and related tests`). Previous commits: `ae1eaf8` (nonzero browser replay verification), `63a0a6d` (reject post-game-over replay ticks).
- Initially: **25 modified tracked feature files + 14 untracked feature files = 39 feature paths**, nothing staged. Tracked feature diff: **1,728 insertions / 556 deletions**; that statistic excludes untracked contents. This report adds one further untracked path.
- Five unrelated tracked `tmp/` paths appear deleted, accompanied by access-denied / inconsistent missing-directory warnings. Their actual state could not be established reliably; do not interpret this as authorization to delete or restore them.
- Global `git diff --check` reported no whitespace violations but could not read those five paths. The scoped check over `docs/` and `phaser-asteroids/` passed cleanly. Git also reports routine LF/CRLF conversion warnings.
- Root, frontend and server `node_modules/` directories exist and are ignored; none is tracked. Frontend and server lockfiles are unchanged. Frontend build, dependencies and Worker types are usable.
- No unexpected gameplay-engine, audio, asset, Python, workflow or lockfile changes were found in the feature diff. The viewport adjustment supports the new mobile nickname field. Shared menu changes are limited to the title layout, hint fitting, a text-field widget and a narrower context type.

## 2. Files reviewed

All 39 feature paths were inspected, including all 14 new files. Paths below are under `phaser-asteroids/` unless prefixed otherwise; **new files are marked +**.

| Area | Files |
| --- | --- |
| Documentation / entry | `../docs/leaderboard-backend.md`, `docs/menus.md`, `index.html`, `package.json` |
| Browser verification | `scripts/menu.mjs`, `scripts/ranked-browser.mjs`, **+** `scripts/ranked-ui.mjs`, **+** `scripts/lib/rankedStack.mjs` |
| Backend | `server/src/{config,leaderboard,nickname,router,runs,verify}.ts`, `server/tests/leaderboard.test.ts`, **+** `server/tests/timelimit.test.ts`, **+** `server/migrations/0002_time_limit.sql` |
| Ranked client | `src/ranked/{api,localScores,session}.ts`, **+** `src/ranked/{nickname,personalBest,scoresModel,submission}.ts` |
| Replay / integration | `src/replay/{recorder,types,verifier}.ts`, `src/scenes/{GameScene,StartScene}.ts` |
| Menus / input | `src/ui/menu/pages/{common,title}.ts`, `src/ui/menu/widgets.ts`, **+** `src/ui/menu/pages/{ranked,rankedResult,scores}.ts`, **+** `src/ui/nicknameInput.ts`, **+** `src/ui/nickname.css` |
| Client tests | `tests/ranked.test.ts`, **+** `tests/timeLimit.test.ts` |

Supporting review covered both ignore files and lockfile status, Wrangler configuration, migration 0001, Worker entry/crypto/router/lifecycle, SQLite harness, menu controller/view, input routing, production debug hooks, Vite configuration, deployment documentation/workflow, browser-suite entry points, and available verification logs/screenshot inventory. The Phase 3 behavior was assessed against the supplied brief and repository documentation; no separate original Phase 3 specification was supplied.

## 3. Confirmed defects and release gates

**Mobile release gate — ranked start bypasses the existing touch-off safeguard.** In `src/ui/menu/pages/title.ts:67`, casual PLAY becomes `keysOnly` on a coarse-pointer phone in keyboard mode. The adjacent ranked button (`:82`) and Ranked Play START (`pages/ranked.ts:89`) have no equivalent restriction. `StartScene.ts:314` accepts that start, while `GameScene.ts:241` leaves the touch UI off. A phone without a physical keyboard/controller can therefore tap into a run it cannot steer. This is a confirmed code-path inconsistency; it has not been reproduced on physical hardware in this audit. **Narrow fix:** preserve the input preference and apply the existing pointer-start restriction at every ranked entry/start action, including TRY AGAIN and PLAY NORMALLY, with a clear route back to touch controls. Verify the touch-off path before mobile release.

**Configuration-change defect — issued time limits are not immutable.** `server/src/verify.ts:78` uses `Math.min(issuedLimit, settings.maxTicks)`. An actual-verifier reproduction produced:

| Issued limit | Current limit | Submission | Result |
| --- | --- | --- | --- |
| 900 | 72,000 | Alive at 900 ticks | accepted |
| 900 | 600 | Same original 900-tick recording | `too_long` |
| 900 | 600 | Alive at 600 ticks | accepted as `time_limit` |

This contradicts `docs/leaderboard-backend.md:130` and migration 0002's comment. The existing configuration-change test only covers raising the limit (`server/tests/timelimit.test.ts:186`). **Narrow fix:** distinguish the fixed 72,000-tick resource ceiling from the configurable limit for *new* challenges; verify recorded limits against the fixed ceiling. Add one lowering-limit regression. This does not block the first controlled release if production stays at the default throughout, but it blocks safely changing that setting during active play.

**Deployment gates:** production D1 ID is a placeholder; secrets must be supplied; the Pages build does not wire `VITE_LEADERBOARD_API_URL` into its environment. Without the latter, ranked play is deliberately unavailable on the published host. These are known setup requirements, not evidence of a broken casual game. Browser/phone gates are listed in sections 8–9.

## 4. Non-blocking issues to track

- Production still supports `?debug`, `?keydebug`, `?verified`/`?seed` and publishes replay/session inspection objects (`src/main.ts:26`, `GameScene.ts:195`, `src/ranked/session.ts:122`). There is no enabled god-mode or score-acceptance cheat handler. `?debug` exposes mutable local scene state, including in-memory client objects; TypeScript `private` is not a security boundary. These hooks existed before this diff and cannot bypass server replay verification. Consider development gating separately; browser scripts currently depend on them.
- `src/ranked/api.ts:106` clears its fetch timeout after response headers, before JSON body consumption (`:126`, `:362`). A stalled response body can leave ranked/board loading waiting indefinitely. This is a confirmed timeout-coverage gap, not an observed outage; casual play remains independent.
- Browser harness cleanup kills parent processes without awaiting complete process-tree shutdown (`scripts/lib/rankedStack.mjs:93`, `:137`). Startup failures can also leave the preview child without the normal close handle. Orphan-process/hanging-shutdown risk is plausible, but this audit did not establish it as the cause of the reported keyboard hang.
- Full-length 20-minute verification cost remains measured evidence, not a full-length accepted browser test. Physical mobile keyboard behavior and a controller-flown ranked run remain unverified.
- The intro always says 20:00 even for a deliberately shortened test Worker; this is already documented. Local personal best is device convenience, not an authenticated identity. Bots that produce valid issued-seed replays and wait out elapsed time remain an acknowledged limitation.

## 5. Security and configuration findings

| Requirement | Evidence / result |
| --- | --- |
| Server-issued ranked challenge | Worker creates CSPRNG ID/token/seed, stores only the token hash and approved configuration; game consumes a challenge once. Failed requests do not silently start ranked play. |
| Casual cannot post an arbitrary ranked score | Casual has no challenge/submission flow. Submit requires a real run/token and checks issued seed, exact configuration, rules and elapsed time before independent simulation. Merely enabling the experimental replay path grants no credential. |
| Verification cannot be switched off by the client | Production Worker injects no verifier override; test-only dependency injection is internal. Claimed score is cross-checked, never used as the authoritative score. |
| Credential handling | Tokens remain in browser memory and Authorization headers; no raw token is in session snapshots, local storage, leaderboard output or intentional application logs. Public run IDs and replay seeds are not secrets. Debug inspection of the player's own runtime remains possible as above. |
| Nickname injection | Shared charset/normalization rules; canvas text, DOM input `.value` and live-region `.textContent`; no nickname HTML insertion. Parameterized SQL handles storage/moderation. |
| Idempotency / personal best | Prepared bytes are reused for bounded automatic/manual retries; conditional claims, atomic score finalization and UNIQUE(run_id) protect acceptance. Local score/nickname writes occur only after a server acceptance. |
| Casual during outages | Ranked requests are asynchronous; casual simulation/start does not await them. Existing browser journey reports this path working; no new browser run was performed here. |
| Time limit | Server caps work, replays all ticks and accepts an alive ending only at its selected exact limit; padding after natural game over is rejected. Default 72,000-tick enforcement is sound, subject to the configuration-change defect above. |
| Administration | Admin route absent without a token of at least 16 characters; bearer comparison, failed-auth throttling, no admin CORS. No frontend admin secret or admin-client route found. Hide/unhide SQL and unit coverage exist. |
| CORS / production defaults | Explicit allowed origin, no wildcard or credentialed CORS; foreign browser POST origins rejected. Originless scripts are allowed intentionally: CORS is not authentication. Production repeats D1/vars and excludes loopback origins. API query override works only on loopback hosts. |

`IP_HASH_SALT` silently falls back to a public development value (`server/src/config.ts:105`); setting a random production secret is mandatory for the intended IP privacy. Admin is disabled by default. The API URL is public configuration and must use HTTPS in production; URL validation also permits HTTP for local use. Never put admin or Cloudflare credentials into any `VITE_*` variable.

## 6. Exclusions and secret scan

277 tracked/untracked text files were scanned for common private-key/token formats, credential URLs and secret assignments, without printing candidate values. The only assignment match was the explicit test fixture in `server/tests/harness.ts:82`; the tracked `.dev.vars.example` contains recognizable placeholders. No actual credential was identified. This was a working-tree scan, not an exhaustive Git-history or ignored-file secret audit. No actual `.env` or `.dev.vars` file was found at the frontend/server roots.

Keep dependencies, `dist/`, `.node/`, `.wrangler/`, `.dev.vars`, logs, screenshots, benchmark/reproduction output and local game data excluded. Existing rules cover these paths. **Generic `.env`, `.env.*` and `.dev.vars.*` variants are not currently ignored**: add narrowly scoped rules before using those secret-bearing files, preserving `.dev.vars.example`.

Exclude these unrelated apparent deletions from feature staging; investigate their access problem separately:

```
tmp/test_add_score_sorts_and_limit0/scores.json
tmp/test_get_top_scores_returns_re0/scores.json
tmp/test_is_high_score_checks_thre0/scores.json
tmp/test_load_highscores_returns_e1/scores.json
tmp/test_log_event_writes_json_lin0/game_events.jsonl
```

All 14 new feature files have a legitimate role; no disposable script among them was identified. Use explicit paths or patch staging, never an indiscriminate `git add -A` for this tree.

## 7. Proposed logical commits — none created

1. **Shared protocol and server time-limited endings:** shared nickname rules/re-export, replay recorder/types/verifier, server changes, migration 0002 and time-limit/public-contract tests. Include the lowering-limit correction here if undertaken.
2. **Ranked player experience:** client API/session/submission/storage/boards, scene integration, menu pages/widgets, nickname field/CSS/viewport, client tests and menu documentation. Include the mobile safeguard correction here.
3. **Acceptance harness and release instructions:** ranked browser scripts/shared stack, menu expectation updates, package script, backend runbook and this report. Incorporate the concrete production setup/rollback corrections below before deployment.

Review the staged diff after each proposed group and keep every intermediate commit type-correct. Leave the unrelated `tmp/` state outside these commits.

## 8. Verification evidence and minimal remaining plan

**Performed now:** `npm test -- --reporter=dot`: **55 files / 1,459 tests passed**, 13.93 seconds. `npm run build`: frontend typecheck + production browser/Node replay builds passed. Separate `node ../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` from `server/`: passed. One small actual-verifier configuration-change reproduction was run. Logs/build/reproduction modules are ignored under `scripts/.smoke-output/` and `dist/`.

The first unit attempt failed before tests because sandbox subprocess creation returned EPERM; the permitted retry passed. No browser suite, benchmark sweep, background monitor or cloud command was run.

**Previous evidence:** the supplied brief reports a working browser → Worker → D1 journey, incomplete menu/touch/gamepad verification, keyboard timing failure plus shutdown hang, smoke laser-cooldown failure, and baseline-reproduced music/pages audio failures. Available `verify*.log` files are older Oct 19 smoke/co-op evidence; Oct 22 screenshots are mixed-age artifacts, not complete final-layout pass logs. Neither proves final Phase 3 regression completion. The baseline audio comparison is reported by the user and was not independently repeated here.

Run the following independently on an idle machine, building once after any fixes. Commands are from `phaser-asteroids/`; retain a separate log for each. Budgets below are proposed stopping limits, not measured runtimes. Require exit code 0 **and** the final summary; a hanging process is incomplete even if preceding assertions passed.

| Order | Check | Stop / acceptance rule |
| --- | --- | --- |
| 1 | Address mobile start safeguard; unit/type/build checks only for changed code | Stop on failure. Keep the time limit at 1,200 s or fix/test the limit defect before changing it. |
| 2 | `node scripts/menu.mjs` | One run, 15-minute ceiling; require completed final-layout tour and summary. No rerun loop. |
| 3 | `node scripts/touch.mjs` | One run, 15-minute ceiling; require touch-off recovery, controls, pause/rotation and final summary. Then do section 9 on the S25. |
| 4 | `node scripts/gamepad.mjs` | One run, 10-minute ceiling; require navigation, assignment, disconnect/resume, ability edges and clean exit. |
| 5 | Target the reported keyboard/laser behavior with a short manual check; if automated certification is required, run `node scripts/keyboard.mjs` then `node scripts/smoke.mjs`, separately | At most one run each, 5-minute ceiling each. On the same timing failure, preserve diagnostics and compare that assertion to the baseline once; do not modify gameplay to get green. Stop on another failure or hang and classify it. |
| 6 | After the production API URL is wired into the candidate build, `node scripts/pages-check.mjs` | One run, 5-minute ceiling. Pages path/asset/start errors block publication. If only the known baseline audio assertion fails, document a specific disposition; the current deploy workflow still requires this job to pass. |

Do not rerun the separate music suite merely to rediscover the reported baseline failure. Combat/co-op and the already working ranked journey do not need routine full reruns for this audit. After a ranked flow or verifier fix, rerun only its affected unit checks and the relevant ranked acceptance script once; the stock ranked UI script uses two local Workers and should be a separate task if needed.

On timeout, stop and clean up only that run's owned process tree, verify its preview port is released, and record the incomplete result before starting anything else. No parallel browser runners or monitoring loops. Any unexplained functional failure holds release; a timing assertion is not automatically a gameplay bug or an automatic waiver.

## 9. Manual Galaxy S25 checklist

Use Chrome with Samsung Keyboard (and the user's usual keyboard if different), both normal and fullscreen landscape. Use the production HTTPS candidate or an explicitly configured LAN build. A LAN hostname ignores `?api=`: bake in a reachable API URL and allow the exact phone-page origin in the Worker; check secure-context-dependent fullscreen/haptics on HTTPS.

- Fresh profile and saved preferences: PLAY / RANKED / HIGH SCORES readable and tappable, no safe-area or browser-toolbar clipping; Assisted Flight default and saved movement preference preserved.
- Switch touch OFF via the existing confirmation, reload, and verify finger taps cannot start an uncontrollable casual or ranked run. Recover through TOUCH CONTROLS ON. External keyboard/controller can still start correctly.
- Start ranked only after CONNECTING succeeds. Steer + FIRE + LASER + BOOST with multiple fingers; label/countdown do not cover play. Pause/resume, rotate upright/back, app-switch and lock/unlock without stuck inputs or unintended submission.
- Result nickname: tap opens real keyboard; field remains visible; type/paste/edit, spaces/underscores, short/long/invalid names, blank Anonymous, Done, system Back, and tap outside. No typing triggers pause/mute/fire; no lost text on rotation or toolbar changes.
- Submit once and double-tap: one accepted score, correct server score/name/ranks, YOU highlight and personal best after reload. SKIP writes no score and no remembered nickname; PLAY AGAIN gets a fresh challenge.
- Airplane mode before submission: bounded retries, clear failure, manual RETRY after reconnection, exactly one stored score. API unavailable: casual PLAY remains usable. Test a locally shortened expiry/limit separately if needed; never shorten the production limit during active runs.
- Board tabs, paging, back navigation, Android Back, fullscreen exit/re-entry and haptics behave as expected. Record browser/OS/keyboard versions and failures; emulation does not certify these checks.

## 10. Exact production prerequisites and runbook corrections

Everything in this section is **for the owner to perform later; none was executed**. Existing `docs/leaderboard-backend.md` §14 covers the broad sequence, but needs the environment-specific and recovery details here.

1. Have a Cloudflare account with **Workers Paid**, permission to create D1, deploy Workers and set secrets; a Workers subdomain or intended custom domain; and permission to set the GitHub Pages build configuration. Workers Paid currently has a $5 USD/month minimum; review usage charges. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)
2. Use the pinned lockfiles with Node 22.14+ compatible tooling. From `phaser-asteroids/`, `npm ci`; from `server/`, `npm ci`. Authenticate with `npx wrangler login` only when ready to configure the account. Do not copy test secrets into production.
3. From `server/`, `npx wrangler d1 create asteroids-leaderboard`; put its returned ID in **`[[env.production.d1_databases]]`**, keeping `binding = "DB"` and `migrations_dir = "migrations"`. The top-level zero ID is only a local placeholder; it does not configure production.
4. In `[env.production.vars]`, set exact HTTPS browser origins, comma-separated, without a path: `https://djblackett.github.io` plus any actual custom frontend origin. Keep local origins in the local configuration only. Leave `RANKED_TIME_LIMIT_SECONDS` unset (1,200 s), TTL default 3,600 s and the reviewed rate limits unless intentionally changed. Keep `cpu_ms = 5000` and the cleanup cron in production.
5. Set a long random `IP_HASH_SALT` with `npx wrangler secret put IP_HASH_SALT --env production`. For usable moderation, also set a separate random `ADMIN_TOKEN` of at least 16 characters with `npx wrangler secret put ADMIN_TOKEN --env production`. Store these securely outside the frontend/repository; no Cloudflare API credential is needed in browser code.
6. Inspect `npx wrangler d1 migrations list asteroids-leaderboard --env production --remote`, then apply with `npx wrangler d1 migrations apply asteroids-leaderboard --env production --remote`. Confirm **both 0001_init.sql and 0002_time_limit.sql** applied, including `runs.time_limit_ticks` and `scores.end_reason`. Apply schema **before** the new Worker. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
7. Deploy the Worker with the production environment only when authorized, then check health, allowed/denied-origin preflights and one controlled issued-challenge/accepted-score flow. Health is liveness/configuration only; it does not query D1, so it cannot prove migrations or the binding work.
8. Wire the public HTTPS Worker base URL into the Pages **build step**, for example `env: { VITE_LEADERBOARD_API_URL: "${{ vars.VITE_LEADERBOARD_API_URL }}" }` plus the corresponding repository variable. Merely creating that repository variable does not export it to Vite; `.github/workflows/deploy-gh-pages.yml` currently contains no such mapping. Rebuild, validate the Pages base path and publish only after authorization. This value is public, never a secret.
9. Moderation from a trusted operator terminal, with `ASTEROIDS_ADMIN_TOKEN` already supplied securely and the placeholders replaced:

   ```powershell
   Invoke-RestMethod -Method Post -Uri 'https://<worker>/api/v1/admin/scores/<score-id>/visibility' -Headers @{ Authorization = "Bearer $env:ASTEROIDS_ADMIN_TOKEN" } -ContentType 'application/json' -Body '{"visible":false,"reason":"offensive"}'
   ```

   Confirm the score disappears from both boards and its public detail returns 404 after the public cache's five-second lifetime. Use `{"visible":true}` to unhide. The existing direct-D1 fallback command at `docs/leaderboard-backend.md:296` needs **`--env production`** added; otherwise it selects the top-level binding/placeholder. Do not run moderation from the frontend or put tokens into URLs/logs.
10. Monitor Worker Metrics CPU and Memory Usage percentiles, request/errors and invocation statuses, especially **Exceeded CPU Time Limits / Exceeded Memory**; compare verification traffic with the 5,000 ms cap and **128 MB isolate limit**. Watch D1 query errors/latency and the existing structured rejection/internal-error events with `npx wrangler tail --env production`. Persisted Workers Logs must be explicitly enabled if required; this Wrangler file has no observability configuration. Use controlled representative uploads and local profiling for memory investigation; local latency is not production CPU measurement. [Metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
11. Recovery: keep the previous frontend artifact and Worker version ID. A previous Worker can be restored with `npx wrangler rollback <version-id> --env production`; migrations are not undone. A Phase 2 Worker does not issue `timeLimitTicks`, so the new frontend will refuse its challenges: restore a compatible frontend too, or disable ranked by removing the API URL and **rebuilding/republishing** the frontend. On the first deployment there may be no previous Worker version; frontend disablement is the immediate fallback. For data loss/corruption, inspect the restore point and use `npx wrangler d1 time-travel restore asteroids-leaderboard --env production --timestamp=<RFC3339>` only after explicit operator review; it restores the whole database, including scores after that point. [Worker rollback](https://developers.cloudflare.com/workers/wrangler/commands/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

The existing deployment page also describes the game as having no backend (`phaser-asteroids/docs/deployment.md:3`); clarify that the static casual game remains standalone while ranked uses this optional Worker. Add migration 0002 and frontend/Worker compatibility to the rollback text. No cloud account access was needed to identify these gaps.
