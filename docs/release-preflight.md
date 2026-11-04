# Orbital Impact production release preflight and runbook

Audit: 2026-11-04. **Blocked for production release pending external gates.** Local preparation is verified; production backup/export/restore, migrations, deployment, credentials changes and Play upload were not performed. This replaces the historical 2026-10-22 preflight. See [operator workflow](leaderboard-moderation.md), [test evidence](play-release-validation.md), [data inventory](play-data-inventory.md), [policy draft](privacy-policy-draft.md) and [Android signing/build/Play instructions](../phaser-asteroids/docs/google-play-release.md).

## Release identity and assessment

- **Verified:** `dev`, audited HEAD `f540cafb2da864d3d3da52619910f062acfff9c3` (`Implement moderation workflow and admin UI`). Reporting/0003 originated in `91c349c`; workflow/admin UI/0004 in HEAD. Local `origin/dev` matches HEAD; this is a remote-tracking observation, not a fresh server-side push audit.
- **Superseded (2026-11-04 production preflight):** the rehearsal script, package-script entry and documentation changes from that pass are committed as `1a6eb9808e847469757fa786620cbaecf62c5563` (`dev`, matching `origin/dev`). The working tree is clean; the earlier `tmp/` deletions are no longer present. Release candidate is now `1a6eb98` unless a later commit is approved.
- **Verified:** compatibility baseline `c1871a92c6f2a99bbac6f8dc8885691804826737` precedes moderation and is contained in local `origin/main` (`532f8fb`). Its actual Worker and API client were extracted from Git and tested against expanded local D1. This does not identify the binary installed on any phone or the exact deployed Worker revision.
- **Verified:** public production health GET on 2026-11-04 reported rules `1.2.0`, schema `1`, supported `[1.2.0]`. Health does not query D1. Production Worker compilation with `--dry-run --env production` passed.
- **Requires manual verification:** live migration ledger/schema/data, Worker version/commit, installed APK provenance, Cloudflare controls and recoverable backup. No authenticated production account inspection was performed. *(Most of these were since verified read-only; see the next section.)*

## Authenticated read-only production preflight (2026-11-04)

Wrangler 4.151.3 OAuth session plus GET-only Cloudflare API calls; every D1 query was a SELECT/PRAGMA reporting `rows_written: 0`. Nothing was deployed, migrated, exported or restored.

- **Verified in Cloudflare:** account `620de0810a6cf29710d9fedb3a966d6f`; one Worker, `asteroids-leaderboard`; bindings `DB` (D1 `cf4833f7-5fc9-45ca-a767-750df108f1e9`), `ALLOWED_ORIGINS`, secrets `ADMIN_TOKEN` and `IP_HASH_SALT` (names only); cron `17 7 * * *`; `limits.cpu_ms` 5000; workers.dev enabled, previews off; no custom domains and no zone routes; Logpush off, no tail consumers, no `observability` setting returned.
- **Verified in Cloudflare:** active deployment 100% version `004624cd-b03e-4c2e-8bfc-1e8abb29ef9e`, created 2026-11-03T07:17:19Z. All seven versions were Wrangler uploads (no dashboard/Builds source). By timestamp it is the `main` push run for `532f8fb` (tree identical to `c1871a9`), run 41595102356, 07:15:21-07:17:59Z. Cloudflare records no commit SHA; this correlation is the only link.
- **Verified in D1:** storage `version: production`; ledger holds exactly `0001_init.sql`, `0002_time_limit.sql` (applied 2026-10-23 00:34:34); 0003 and 0004 pending. Objects are `runs`, `scores`, `rate_limits`, `d1_migrations`, `_cf_KV` and the four 0001 indexes; no `score_reports`/`moderation_audit` (no partial application). Stored DDL matches 0001+0002. `PRAGMA foreign_key_check` empty, no orphan or duplicate scores. Size 102 kB. Aggregates only: 41 scores (0 hidden), 44 runs (41 accepted, 3 issued).
- **Verified in D1:** Time Travel bookmarks resolve for the current time and for timestamps back to database creation (2026-10-23T00:40Z). Plan tier could not be read (API 403); the accepted `cpu_ms` limit indicates Workers Paid.
- **Verified publicly:** health rules `1.2.0`/schema `1`/supported `[1.2.0]`; boards/detail still `Cache-Control: public, max-age=5`, no `CF-Cache-Status`; both allowed origins echoed, foreign preflight 403. `GET /admin` is 404 (console not yet deployed). The deployed visibility route answers a GET with 405, not 404, so the running Worker has `ADMIN_TOKEN` configured.
- **Verified in GitHub (public API):** `main` is not a protected branch, so a direct push to `main` releases without review. Workflows: `deploy-gh-pages.yml` and `browser-suites.yml` only.
- **Not read-only:** `wrangler d1 migrations list --remote` first runs `CREATE TABLE IF NOT EXISTS d1_migrations` (Wrangler source). It is harmless once the ledger exists, but for a strictly read-only check use `d1 execute --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"`.
- **Not read-only:** an unauthenticated or wrong-token request that reaches the admin gate increments the `admin-fail` counter in `rate_limits` (one D1 write per request). On the new Worker, a cross-origin `Origin` header is refused with 403 before the gate and writes nothing; use that to prove the gate exists, and keep 401 checks few.
- **Blocked:** deployment awaits approved release SHA, backup readiness, verified migrations and operational checks. Android distribution also awaits policy/contact approval, signing, devices and Play testing.

## Migration and compatibility report

| Area | Status / evidence |
| --- | --- |
| 0003_reports.sql | **Verified:** new WITHOUT ROWID reports table, score/reporter composite PK, fixed reason CHECK, creation index, score FK with CASCADE; scores/runs untouched. |
| 0004_moderation_workflow.sql | **Verified:** nullable display override; revision/review flags default 0; report rebuild copies all four old fields, adds open/resolved status default open and suspicious_score, recreates creation index and adds queue index. |
| Audit association | **Verified:** auto-increment ID, nullable score FK with SET NULL, score/ID index. API batches audit and changes atomically. Action/category strings and flag/revision ranges are application-validated, not fully SQL-constrained; direct privileged SQL bypasses that validation. |
| Preservation | **Verified locally:** scores, hidden reason/time, accepted linked runs, token/replay/issuer hashes and reports on visible/hidden entries survive staged 0003/0004. Original fields compared exactly; FK checks empty; invalid reason and orphan audit rejected. |
| Failure/retry | **Verified locally:** deliberately failing final 0004 statement rolls back columns, reports rebuild and ledger insert. Exact committed bytes then apply. Recorded migrations skip on reapply. Raw SQL rerun fails on existing schema; files are not idempotent. Never delete ledger rows or hand-run a migration suffix. |
| Migration interval | **Verified locally:** actual pre-moderation Worker reads and accepts an anonymous gzip replay on expanded D1. Explicit-column INSERTs work with new defaults. 0003 is additive. Migration operations may interrupt requests; client retry still matters. |
| Older client | **Verified locally:** actual baseline challenge/parser/submission/read functions work with updated Worker; accepted-run retry stays idempotent across Worker change. No new field, account, replay schema or rules change required. Score/run/hash relationship remains valid. |
| Validation change | **Verified:** narrow content screen intentionally rejects some formerly valid nicknames. Old client recognizes `invalid_nickname`; run remains issued and can be corrected or submitted as Anonymous. Accepted historical retries resolve before re-screening. Do not promise identical acceptance for every old nickname. |
| Names/ranks/paging | **Verified locally:** both boards, totals, ordinal ranks, offset pages and detail exclude hidden rows; names use unchanged nickname field and preserve score. Concurrent moderation can shift offset pages between requests; there is no snapshot-pagination guarantee. |
| Installed Android | **Requires manual verification:** no historical signed APK or physical-device session tested. Preserve an existing install, record version/signing/provenance, test ranked challenge/play/submission/retry, Anonymous, nickname correction and board/detail on updated backend. Native builds pin production: use a controlled test variant or separately approved harmless production canaries, never silently repoint the distributed artifact. |

Reproduce from `phaser-asteroids`: `npm run build`, then `npm run test:release:migrations`. It only uses temporary zero-ID D1 configs and `--local`, extracts tracked historical sources without a checkout, and alters only a disposable migration copy for failure injection. Seed data is representative synthetic data, not a production-size/copy rehearsal. Live database size/free space/rebuild duration remain manual checks; 0004 temporarily holds a second reports table.

The rehearsal requires the baseline commit in local Git history and system `tar` (Windows' built-in tar was available here), plus installed locked frontend/server tooling. On Windows run it from PowerShell: under Git Bash `tar` resolves to MSYS GNU tar, which reads `C:` as a remote host and the rehearsal fails before any check (re-run 2026-11-04 at `1a6eb98`: 40/40 from PowerShell). No new dependency or production credential is required.

**Verified:** finalized rehearsal passed 40/40, including full local SQL export/import into a second empty D1, matching score/run/report/audit counts and empty foreign-key errors. This verifies local export recovery only. Read-only ADB enumeration found 0 authorized devices; no physical or 16 KB runtime evidence was available.

## Cache findings

**Verified:** weekly/all-time/detail responses, their errors, submissions, reports, admin APIs and console send no-store. Current client's shared board/detail GET uses `cache: 'no-store'`. No application service worker or Cache API write was found. Real local Worker/browser tests exercise hide/restore and rename/restore-name; historical client rehearsal checks both boards and details after changes.

**Requires manual verification:** Cloudflare Cache/Page Rules, custom proxies/routes and Android WebView behavior. Ensure nothing forces caching for `/api/v1/*` or `/admin*`; inspect live headers/CF-Cache-Status after deployment. Old HTTP caches may retain former responses for five seconds under the old freshness policy. Open screens and device-local bests/nicknames/blocks can retain previous content until refresh; offline copies/screenshots cannot be recalled. No push invalidation exists. Rolling back code can restore original names and older caching behavior.

**Verified production observation (2026-11-04, GET only):** both boards and one existing score detail return HTTP 200 with `Cache-Control: public, max-age=5`; the no-store change is not live on these reads. Android-origin CORS matches. Board fields are scope/rulesVersion/limit/offset/total/entries, weekly adds timeZone/weekStart/weekEnd; entry fields are id/rank/nickname/score/rulesVersion/completedAt/durationSeconds/endReason; detail has score/ranks (allTime/weekly). These match the updated public contract. No names or private values were logged. Missing CF-Cache-Status on these samples is not proof of dashboard cache configuration.

## Cloudflare configuration checklist

| Control | Status / manual gate |
| --- | --- |
| Account/Worker/D1 | **Verified from config:** account `620de0810a6cf29710d9fedb3a966d6f`; Worker `asteroids-leaderboard`; binding `DB`, DB `asteroids-leaderboard`, ID `cf4833f7-5fc9-45ca-a767-750df108f1e9`. Top-level zero ID is local only. **Requires manual verification:** authenticated target matches. |
| Domains/routes | **Verified from config:** workers.dev on, preview URLs off, no custom routes declared. Public origin `https://asteroids-leaderboard.davejandrea.workers.dev`. **Requires manual verification:** dashboard routes, Access/WAF and HTTPS, including `/admin`. |
| Secrets/admin | **Verified from code:** required ADMIN_TOKEN/IP_HASH_SALT; admin minimum 16 chars, hash comparison, failed-auth limits, no admin CORS, same-origin check, console token in memory only. **Requires manual verification:** secret presence, protected recovery copy, operator/MFA/least-privilege access. Never print/rotate secrets for this rollout. Shared token does not identify individual staff. |
| CORS/CSP | **Verified:** exact origins `https://djblackett.github.io`, `https://spacearcade.davidandrea.ca`; admin uses Worker's own origin, restrictive shell CSP/text rendering/no framing. **Requires manual verification:** deployed preflights, denied origins, dashboard policies and console HTTPS. CORS is not native/non-browser authentication. |
| Cron/retention | **Verified from source:** `17 7 * * *` UTC; abandoned/rejected runs, counters, open/resolved reports pruned; accepted scores/runs and audit have no automatic expiry. **Requires manual verification:** deployed trigger, successful prune events/failure alerts and provider retention. |
| Limits/cost | **Verified from source:** CPU 5,000 ms; DB-backed start/submit/report/failed-admin limits. **Requires manual verification:** paid plan, quotas, CPU/D1 latency/errors, budgets, WAF. Write limits do not establish read-rate protection. |
| Logging | **Verified:** structured rejection/error/prune events; no Wrangler observability section. **Requires manual verification:** enabled logs/sampling/destinations/retention and error alerts. Omission does not prove disabled logs. Avoid body/token capture. |
| Recovery | **Requires manual verification:** storage backend, recovery window/bookmark/access, protected export and rehearsal; SQL erasure does not erase provider history. |
| Operations | **Verified locally:** token refusal, console lock/reload, revision conflict, audit/erasure. **Requires manual verification:** deployed behavior, review coverage, appeals and erasure ownership checks. No external admin service required. |

## Backup and recovery readiness

Cloudflare documents automatic Time Travel on production-storage D1, with 7-day Free / 30-day Paid recovery limits. Actual backend/plan/history is **Requires manual verification**. No backup was created here. Record a current bookmark immediately before rollout and verify timestamp lookup; do not assume a manually triggered snapshot exists. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Record UTC time, approved SHA, current Worker version, DB ID, ledger, schema/counts and recovery bookmark in a protected release record. Add a full SQL export outside Git in an approved protected directory: it contains private run/report data. Confirm nonempty file/hash; inspect schema/data without logging private rows; import into empty disposable local D1 and compare counts/FKs before trusting recovery. Export can interrupt service and is not itself a rollback. [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

These **remote backup instructions require approval and were not executed**. From `phaser-asteroids/server`, define the locked CLI helper used throughout this runbook. Set `$backupDir` to an existing approved protected directory, `$backupUtc` to the recorded RFC3339 UTC time and `$bookmark` to the recorded bookmark; no placeholder is a default.

```powershell
function Invoke-Wrangler {
    & node .\node_modules\wrangler\bin\wrangler.js @args
    if ($LASTEXITCODE -ne 0) { throw 'Wrangler failed; stop this stage' }
}
Invoke-Wrangler d1 info asteroids-leaderboard --env production
Invoke-Wrangler d1 time-travel info asteroids-leaderboard --env production --json
Invoke-Wrangler d1 time-travel info asteroids-leaderboard --env production --timestamp $backupUtc --json
Invoke-Wrangler d1 export asteroids-leaderboard --env production --remote --output (Join-Path $backupDir 'pre-moderation.sql')
Get-Item -LiteralPath (Join-Path $backupDir 'pre-moderation.sql') | Select-Object Length, LastWriteTimeUtc
Get-FileHash -LiteralPath (Join-Path $backupDir 'pre-moderation.sql') -Algorithm SHA256
```

**Go:** correct target, valid current recovery history/bookmark, protected export with successful disposable import, restore owner/permissions and accepted recovery/data-loss expectations. **Stop:** alpha storage, missing access/history, failed export/rehearsal, unexpected target/ledger or no recovery owner. Bookmarks expire; refresh readiness if delayed. Writes between bookmark/export mean they can represent different instants; record both, never claim identical snapshots without quiescing writes.

Disposable export import, after approval to create/read the protected export, from `server` (local commands only; do not use the production persist directory):

```powershell
$recoveryLocal = Join-Path ([IO.Path]::GetTempPath()) ('orbital-export-recovery-' + [guid]::NewGuid())
Invoke-Wrangler d1 execute asteroids-leaderboard --local --persist-to $recoveryLocal --file (Join-Path $backupDir 'pre-moderation.sql')
Invoke-Wrangler d1 execute asteroids-leaderboard --local --persist-to $recoveryLocal --command "PRAGMA foreign_key_check; SELECT name FROM sqlite_master WHERE type='table'; SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs;"
```

Compare every expected table's row counts and a protected representative sample, including reports/audit when present, to export-time evidence; verify schema and migration ledger too. Treat restored private data like production data and remove the isolated copy under the approved retention process. The automated synthetic rehearsal also exports/imports local D1; it cannot prove the real production export or Time Travel restore works.

Neither migration has a down migration. Schema rollback discards new moderation state and needs separately reviewed/rehearsed SQL. Code rollback leaves schema/data intact. Whole-DB restore rewinds schema/ledger/contents, removes later scores/runs/reports and undoes later moderation/erasure. Keep approved minimal erasure IDs outside DB and reconcile/reapply erasures before serving restored content. Current Worker cannot serve pre-0004 schema. This release supplies no selective per-score recovery.

## Deployment sequence

Production commands below are **instructions for a separately approved operator rollout**. None ran except the recorded public health GET and local compilation. Execute stages separately, check native exit codes and save evidence. Do not paste this whole document as a script.

### 1. Pre-deployment

Use a clean reviewed checkout. Set `$approvedCommit` to its approved full SHA (local test/docs changes from this pass need inclusion/review).

```powershell
git branch --show-current
git rev-parse HEAD
if ((git rev-parse HEAD) -ne $approvedCommit) { throw 'Wrong release commit' }
if (git status --porcelain) { throw 'Release checkout must be clean' }
# From phaser-asteroids:
npm ci
npm ci --prefix server
npm test -- --maxWorkers=4
npm run typecheck --prefix server
npm run build
npm run test:android-build
node --test scripts/rules-guard.test.mjs scripts/production-health.test.mjs
npm run test:release:migrations
node server/scripts/worker-e2e.mjs
node scripts/moderation-admin.mjs
node scripts/ranked-ui.mjs
node scripts/menu.mjs
```

Check each exit before continuing; PowerShell does not automatically stop on native nonzero exits. Direct browser entries reuse built assets. Frontend/server have no configured lint script; Android lint is separate. From `server`, define `Invoke-Wrangler` above and inspect read-only targets:

```powershell
Invoke-Wrangler whoami
Invoke-Wrangler deployments list --env production
Invoke-Wrangler secret list --env production
Invoke-Wrangler d1 info asteroids-leaderboard --env production
Invoke-Wrangler d1 migrations list asteroids-leaderboard --env production --remote
Invoke-Wrangler d1 execute asteroids-leaderboard --env production --remote --command "SELECT name, applied_at FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check; SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs;"
Invoke-Wrangler deploy --dry-run --env production --outdir .wrangler/release-dry-run
```

`secret list` lists names, never substitute a value dump. Save previous Worker version ID/source artifact and existing recovery credentials; avoid the initial-provisioning secret-initialization helper for routine releases.

**Go:** exact SHA/clean checkout, passing checks, identified account/DB/active version, 0001/0002 applied, expected pending set (0003/0004, or only 0004), backup stage complete, monitoring/operator available. **Stop:** missing historical migration, unexpected pending files or differing schema/ledger. If already applied, verify schema and skip; never rewrite ledger.

**Release trigger gate:** `.github/workflows/deploy-gh-pages.yml` deploys Worker then Pages on matching `main` pushes/manual main runs. It does not apply or check migrations; health cannot detect missing columns. Do not merge/push/trigger until both migrations are verified. PR/non-main validation does not deploy. No workflow/repository settings were changed here.

### 2. Apply migrations with a verification pause

Pinned Wrangler applies **all** pending files; no per-file/target-version flag exists. Stage 0001-0003 first in a temporary directory/config preserving actual production bindings. From `server`, after target/backup approval:

```powershell
$rolloutDir = Join-Path ([IO.Path]::GetTempPath()) ('orbital-migration-stage-' + [guid]::NewGuid())
$migrationStage = Join-Path $rolloutDir 'migrations'
New-Item -ItemType Directory -Path $migrationStage | Out-Null
$sourceConfig = Get-Content -LiteralPath .\wrangler.toml -Raw
$workerEntry = (Join-Path $PWD 'src/worker.ts').Replace('\', '/')
$migrationPath = $migrationStage.Replace('\', '/')
$stagedConfig = $sourceConfig.Replace('main = "src/worker.ts"', ('main = "' + $workerEntry + '"')).Replace('migrations_dir = "migrations"', ('migrations_dir = "' + $migrationPath + '"'))
$rolloutConfig = Join-Path $rolloutDir 'wrangler.toml'
[IO.File]::WriteAllText($rolloutConfig, $stagedConfig)
'0001_init.sql','0002_time_limit.sql','0003_reports.sql' | ForEach-Object {
    Copy-Item -LiteralPath (Join-Path 'migrations' $_) -Destination $migrationStage
}
Get-ChildItem -LiteralPath $migrationStage | Get-FileHash -Algorithm SHA256
Invoke-Wrangler d1 migrations list asteroids-leaderboard --env production --remote --config $rolloutConfig
# Pending must be only 0003, or none if already applied:
Invoke-Wrangler d1 migrations apply asteroids-leaderboard --env production --remote --config $rolloutConfig
Invoke-Wrangler d1 execute asteroids-leaderboard --env production --remote --command "SELECT name FROM d1_migrations ORDER BY id; PRAGMA table_info(score_reports); PRAGMA foreign_key_list(score_reports); PRAGMA index_list(score_reports); PRAGMA foreign_key_check; SELECT COUNT(*) AS reports FROM score_reports;"
```

**Go after 0003:** successful exit/ledger entry, correct composite PK/CASCADE/index, empty FK errors, original scores/runs preserved except explained concurrent activity. If already applied, preserve reports. **Stop:** failure/mismatch; keep old Worker, investigate on disposable state and retry intact migration only after cause resolved.

```powershell
Copy-Item -LiteralPath .\migrations\0004_moderation_workflow.sql -Destination $migrationStage
Invoke-Wrangler d1 migrations list asteroids-leaderboard --env production --remote --config $rolloutConfig
# Pending must be only 0004:
Invoke-Wrangler d1 migrations apply asteroids-leaderboard --env production --remote --config $rolloutConfig
Invoke-Wrangler d1 migrations list asteroids-leaderboard --env production --remote
Invoke-Wrangler d1 execute asteroids-leaderboard --env production --remote --command "SELECT name FROM d1_migrations ORDER BY id; PRAGMA table_info(scores); PRAGMA table_info(score_reports); PRAGMA foreign_key_list(score_reports); PRAGMA foreign_key_list(moderation_audit); PRAGMA index_list(score_reports); PRAGMA index_list(moderation_audit); PRAGMA foreign_key_check; SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM score_reports) AS reports, (SELECT COUNT(*) FROM moderation_audit) AS audits;"
```

**Go after 0004:** both ledger entries/no pending migrations, three score fields/defaults, report status, expected indexes/FKs, preserved representative preexisting records and no FK errors. Compare protected aggregate evidence/selected IDs without logging names/hashes/tokens. Explain count changes during traffic; equality needs separately approved write pause. **Stop:** data/schema mismatch or old-Worker errors. Do not remove columns/reports to recover. Temporary config is for migrations only; deploy using canonical config.

### 3. Deploy Worker and verify

Choose one coordinated path: authorized main CI release, or manual fallback below; do not race both. No new secret required.

```powershell
# From server, after migration go criteria and explicit deployment approval:
Invoke-Wrangler deploy --env production
Invoke-Wrangler deployments list --env production
# From phaser-asteroids:
node scripts/production-health.mjs
```

Record deployed version ID and correlate time/CI SHA to approved source. Health lacks build identity. Check both public boards with paging, required fields/detail, allowed/denied CORS, no-store and no forced caching. From `server`, `npx wrangler tail --env production` plus dashboard CPU/request/error/D1 metrics support observation; do not capture tokens/bodies.

Run full submission/moderation in the isolated suites or separately provisioned test backend first. Production canaries require explicit approval of harmless new entries/reports/erasure. Never modify legitimate entries. Verify old/new client, Anonymous/correction, verification/retry, reports, auth refusal, console hide/restore/rename/restore-name/resolve/reopen/stale revision/audit. Confirm deployed cron and next successful event; do not invoke production cleanup solely for evidence.

**Go:** approved version identity, public headers/contracts healthy, isolated flows pass, live same-origin auth/console works, no new submission/D1 failures, old-device evidence before app rollout. **Stop/hold app:** errors, dropped fields/rules, stale fresh reads, unauthorized admin access or rejection spike. Keep prior artifact/version throughout operator-selected observation; no new retention period is asserted.

### 4. Android and Play

Use the [existing build/signing procedure](../phaser-asteroids/docs/google-play-release.md). Rebuild/sync after approved text edits; Gradle alone does not rebuild the game. Verify package `ca.davidandrea.spacearcade`, native `1.0` / code `1`, frozen rules `1.2.0` / schema `1`, release registry and `.env.android` HTTPS endpoint. Determine next unused code from Console, preserve distributed records, record final AAB hash/certificate. No ID/branding/version changed here.

Prioritized remaining blockers:

1. **Blocked / human policy:** `[PUBLIC EMAIL PENDING]`, approved public policy URL/text, provider/correspondence retention, moderation coverage/appeals/erasure process, audience/rating and interpretation of name-based blocking/submit acceptance. Reporting/local blocking source does not establish Play compliance. No accounts: account-deletion UI is **Not applicable**; operational data-removal contact remains required.
2. **Requires manual verification / Cloudflare:** backup, actual pending migrations and authorized backend deployment, cache/CORS/admin/cron/logging/incident owner. Backend before app: suspicious_score requires updated Worker.
3. **Requires manual verification / signing/devices:** upload certificate, unused code, signed AAB inspection, existing-install compatibility, physical gameplay/audio/lifecycle/safe areas/keyboard, ranked submission/retry, privacy/rules/report/block and 16 KB device/emulator. Unsigned builds/no `.so` do not prove delivered splits/WebView behavior.
4. **Requires manual verification / Play Console:** App Signing, Data safety/account-data declarations, listing/rights/artwork, audience/rating, internal testing and Play-delivered install/update, prelaunch/page-size results. Production-access testing requirement is account-dependent. No upload/publication authorized here.

The [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en) and [Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) were rechecked on 2026-11-04. UGC acceptance, ongoing moderation and reporting/blocking remain review gates; Data safety includes controlled WebView and provider processing. The internal-only Data safety form exemption does not certify the app's privacy or UGC behavior.

**Go to separately authorized internal upload:** all external gates recorded, signed inspected artifact, devices/backend accepted. **Stop:** placeholders, unverified signing/code, backend gaps or device failures. Internal testing is not production approval.

## Recovery

| Incident | Action / stop-go |
| --- | --- |
| Migration fails | Stop new Worker. Capture error/ledger/schema/counts; verify earlier successful migration remains. Local rollback evidence is not proof of remote state. Rehearse cause/fix locally, retry intact file; manual partial schema/ledger mismatch requires reviewed repair. |
| Deployment fails | Hold app/Pages. Inspect active version; old code may still serve. Keep additive schema, verify existing API/submissions before retry. |
| Submissions fail / old client incompatible | Hold release; inspect D1/rules/origin/error evidence and preserve runs. Prefer known compatible Worker rollback on expanded schema if no corruption; do not force installed-client updates as recovery. |
| Moderation incorrect | Hold new app/operator writes; investigate auth/revision/audit/reads with safe test rows. Rollback loses new reports/admin UI/name overrides/no-store; account for those regressions and review handling. Emergency settings/secret changes need separate approval. |
| DB restore necessary | Obtain explicit restore/traffic-control approval. Quiesce writes/reads with an agreed method, save current bookmark/evidence, choose validated point, restore, select schema-compatible Worker, reconcile erasures and lost later scores, validate ledger/FKs/boards/isolated submission then reopen. Repo has no tested production write-pause mechanism; disabling frontend cannot stop installed apps. |

Exact commands from `server`, **only after explicit approval**, using recorded IDs:

```powershell
# Code rollback leaves schema/data intact:
Invoke-Wrangler rollback $previousWorkerVersion --env production
Invoke-Wrangler deployments list --env production
# Whole database recovery overwrites post-bookmark contents/schema/ledger:
Invoke-Wrangler d1 time-travel info asteroids-leaderboard --env production --json
Invoke-Wrangler d1 time-travel restore asteroids-leaderboard --env production --bookmark $bookmark
```

Retain the restore operation's previous bookmark for undo within provider eligibility. If Time Travel unavailable, never import blindly over production: validate export in empty isolated DB and separately approve a replacement/rebind or exact restore plan. Worker rollback, schema rollback and whole-content recovery are distinct operations. [Worker rollback](https://developers.cloudflare.com/workers/wrangler/commands/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/).
