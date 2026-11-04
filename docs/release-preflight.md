# Orbital Impact production release preflight and runbook

Audit: 2026-11-04. **Blocked for production release pending external gates.** **[Stage 1](#stage-1-production-d1-backup-and-migrations) (production D1 backup + migrations 0003/0004) is prepared and locally rehearsed, awaiting explicit operator authorization.** Local preparation is verified; production backup/export/restore, migrations, deployment, credentials changes and Play upload were not performed. This replaces the historical 2026-10-22 preflight. See [operator workflow](leaderboard-moderation.md), [test evidence](play-release-validation.md), [data inventory](play-data-inventory.md), [policy draft](privacy-policy-draft.md) and [Android signing/build/Play instructions](../phaser-asteroids/docs/google-play-release.md).

## Release identity and assessment

- **Verified:** `dev`, audited HEAD `f540cafb2da864d3d3da52619910f062acfff9c3` (`Implement moderation workflow and admin UI`). Reporting/0003 originated in `91c349c`; workflow/admin UI/0004 in HEAD. Local `origin/dev` matches HEAD; this is a remote-tracking observation, not a fresh server-side push audit.
- **Superseded (2026-11-04 production preflight):** the rehearsal script, package-script entry and documentation changes from that pass are committed as `1a6eb9808e847469757fa786620cbaecf62c5563` (`dev`, matching `origin/dev`). The working tree is clean; the earlier `tmp/` deletions are no longer present. Release candidate is now `1a6eb98` unless a later commit is approved. HEAD `946d845` adds only this document on top of it; `migrations/` is byte-identical between the two.
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

**Verified:** finalized rehearsal passed 40/40, including full local SQL export/import into a second empty D1, matching score/run/report/audit counts and empty foreign-key errors. That export is of the **post-migration** synthetic database; the pre-migration backup path is rehearsed separately by the [Stage 1 harness](#stage-1-local-rehearsal-evidence). Both verify local export recovery only. Read-only ADB enumeration found 0 authorized devices; no physical or 16 KB runtime evidence was available.

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

**Verified (2026-11-04, read-only):** production storage (not alpha); Time Travel bookmarks resolve for "now" and for past timestamps. Plan tier is unreadable (API 403), so the retention window (7 days Free / 30 days Paid) is **inferred** as 30 days from the accepted `cpu_ms` limit. Wrangler 4.151.3 also refuses `restore --timestamp` older than 30 days on the client side. No export or restore has been run against production. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

**Verified from Wrangler 4.151.3 source/help:** `d1 migrations apply` has no per-file or target flag. It runs each pending file as its own request, so an earlier file stays applied if a later one fails. Despite the help text, it captures a backup only for alpha databases, so record your own bookmark. `d1 export --remote` prints a one-hour signed download URL for the dump to the console, and its `-y` flag is accepted but unused. Every Wrangler confirmation, including `time-travel restore`'s "OK to proceed", is answered **yes** automatically when output is redirected or `CI` is set. `restore --json` skips the prompt entirely.

Backup, export verification and migrations now run only through [Stage 1](#stage-1-production-d1-backup-and-migrations) below, which replaces the earlier free-form backup commands. The export and its verification copies contain private data (token/replay/issuer hashes, nicknames, run configs). Keep them only in the protected directory outside Git and delete them under the approved retention process.

Neither migration has a down migration. Schema rollback discards new moderation state and needs separately reviewed/rehearsed SQL. Code rollback leaves schema/data intact. Whole-DB restore rewinds schema/ledger/contents, removes later scores/runs/reports and undoes later moderation/erasure. Keep approved minimal erasure IDs outside DB and reconcile/reapply erasures before serving restored content. The **updated** (release-candidate) Worker cannot serve the pre-0004 schema; the deployed `004624cd` Worker can serve both. This release supplies no selective per-score recovery.

## Stage 1: production D1 backup and migrations

**Status: prepared and rehearsed locally on 2026-11-04 ([evidence](#stage-1-local-rehearsal-evidence)). Not executed. Requires explicit operator authorization.** Stage 1 writes only to the production D1 (0003, then 0004) and to a protected local directory. It never deploys, rolls back or reconfigures the Worker. The deployed Worker `004624cd` serves throughout. Deploying the updated Worker is Stage 2, a separate approval.

### Before you start

- **Time window:** do not start between 06:45 and 07:45 UTC. The deployed cron (`17 7 * * *`) deletes expired issued/verifying runs and old `rate_limits` rows. It never touches `scores`, the ledger or the tables 0003/0004 create, but it would change counts between steps and trip the step 5 comparison. Stage 1 takes about 15 minutes.
- **Shell:** a fresh, interactive PowerShell 7 window. Do not use `Start-Transcript`, `Tee-Object` or redirection. Wrangler prints the export's signed URL (step 4 suppresses it) and auto-confirms prompts when output is not a terminal. Setup refuses to run when `CI` is set.
- **Login:** Wrangler OAuth on account `620de0810a6cf29710d9fedb3a966d6f` (`wrangler login` if step 1 fails). Locked tooling installed (`npm ci --prefix phaser-asteroids/server`, Wrangler 4.151.3).
- **Backup directory:** an existing, access-restricted directory **outside the repository** and outside synced or shared folders (OneDrive, Dropbox), with a path of at most 100 characters. Local D1 copies nest about 130 more characters, and workerd fails past the Windows path limit. Setup refuses a path inside the repository or one that is too long.
- **Rules:** run one block at a time, from top to bottom, and read its EXPECT line first. Every failed check throws `STOP: …`. After any error, do not run the next block; see [If Stage 1 stops](#if-stage-1-stops). Do not moderate, deploy, merge to `main` or run other D1 commands while Stage 1 is in progress.

### Permissions

- **Confirmed (2026-11-04):** `whoami` reports OAuth on the account above with `account (read)` and `d1 (write)`. Read-only `d1 execute` SELECT/PRAGMA (`rows_written: 0`), `d1 info`, `deployments status` and Time Travel bookmark lookups (current and by timestamp) succeed.
- **Inferred, not exercised:** export, `migrations apply` and `time-travel restore` are D1 write operations covered by the `d1 (write)` scope, and the login belongs to a personal single-member account, so no narrower account role is expected. Step 4 is the first real test of export permission. If it fails with an authorization error, STOP: restore permission is then unproven as well.

### What a Time Travel restore would do

Stage 1 never restores. It records bookmarks so that a separately approved restore is possible. `wrangler d1 time-travel restore` overwrites the **whole database in place** with its state at the bookmark:

- Everything written after the bookmark is discarded: scores, runs, reports, audit rows and rate-limit counters. A score submitted after the bookmark disappears from both boards and its detail page. Nothing is merged, and the export is no substitute because it predates those writes too.
- A run issued before the bookmark but accepted after it goes back to `issued` with no score. If the player's client still holds the token and the run has not expired (default TTL 1 hour), a retry is verified and accepted again. Otherwise that score is lost. Runs issued after the bookmark no longer exist, so their submissions fail.
- The schema and ledger rewind too. Restoring a pre-0003 bookmark removes 0003/0004 and everything stored in their tables and columns. The deployed `004624cd` Worker runs on that schema; the updated Worker does not.
- In-flight queries are cancelled. The command prints a `previous_bookmark` that undoes the restore while it remains inside the retention window.

### Setup (no production access)

Edit the two values, then run this block:

<!-- stage1:values -->
```powershell
Set-Location 'C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\server'
$BackupDir = $null   # REQUIRED: existing protected directory outside the repository, e.g. 'D:\OrbitalRelease\stage1'
```

Run the helper definitions. They only define functions:

<!-- stage1:helpers -->
```powershell
$ErrorActionPreference = 'Stop'
$env:WRANGLER_SEND_METRICS = 'false'
$D1 = 'asteroids-leaderboard'
$AccountId = '620de0810a6cf29710d9fedb3a966d6f'
$ProdDbId = 'cf4833f7-5fc9-45ca-a767-750df108f1e9'
$OldWorkerVersion = '004624cd-b03e-4c2e-8bfc-1e8abb29ef9e'
$PublicBase = 'https://asteroids-leaderboard.davejandrea.workers.dev'
$WranglerJs = Join-Path $PWD 'node_modules\wrangler\bin\wrangler.js'
$CountsSql = "SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM scores WHERE visibility = 'hidden') AS hidden_scores, (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM runs WHERE status = 'accepted') AS accepted_runs, (SELECT COUNT(*) FROM rate_limits) AS rate_limits, (SELECT COUNT(*) FROM d1_migrations) AS migrations"
$SchemaSql = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name NOT LIKE '\_cf\_%' ESCAPE '\' ORDER BY type, name"
$ScoresSql = 'SELECT id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms, asteroids_destroyed, ufos_destroyed, reported_controls, visibility, hidden_reason, hidden_at, end_reason FROM scores ORDER BY id'
$AcceptedRunsSql = "SELECT * FROM runs WHERE status = 'accepted' ORDER BY id"

function Assert-Stage1([bool]$Ok, [string]$Message) { if (-not $Ok) { throw "STOP: $Message" } }
function Invoke-Wrangler {
    & node $WranglerJs @args
    if ($LASTEXITCODE -ne 0) { throw "STOP: wrangler $($args[0..2] -join ' ') exited $LASTEXITCODE" }
}
function Get-WranglerJson {
    $out = & node $WranglerJs @args --json
    if ($LASTEXITCODE -ne 0) { throw "STOP: wrangler $($args[0..2] -join ' ') exited $LASTEXITCODE" }
    ($out -join "`n") | ConvertFrom-Json
}
# Read-only production query; returns the rows of the (single) statement and fails if D1 reports any write.
function Invoke-ProdQuery([string]$Sql) {
    $r = @(Get-WranglerJson d1 execute $D1 --env production --remote --command $Sql)
    Assert-Stage1 (-not ($r | Where-Object { $_.meta.rows_written -or $_.meta.changed_db })) 'a read-only check reported a write'
    Write-Output -NoEnumerate @($r[0].results)
}
function Invoke-LocalQuery([string]$State, [string]$Sql) {
    $r = @(Get-WranglerJson d1 execute $D1 --local --persist-to $State --command $Sql)
    Write-Output -NoEnumerate @($r[0].results)
}
function ConvertTo-Canonical($Value) { ConvertTo-Json -InputObject $Value -Depth 6 -Compress }
function Save-Record { $Record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RecordFile -Encoding utf8 }
function Add-StagedMigration([string]$Name) {
    Copy-Item -LiteralPath (Join-Path 'migrations' $Name) -Destination $MigrationStage -Force
    Assert-Stage1 ((Get-FileHash -LiteralPath (Join-Path $MigrationStage $Name)).Hash -eq $Record.migrationSha256[$Name]) "staged $Name differs from the committed file"
}
# Public GETs on the deployed Worker; these routes are not rate-limited and write nothing.
function Test-PublicReads {
    $health = Invoke-RestMethod -Uri "$PublicBase/api/v1/health"
    $all = Invoke-RestMethod -Uri "$PublicBase/api/v1/leaderboard/all-time?limit=1&offset=0"
    $week = Invoke-RestMethod -Uri "$PublicBase/api/v1/leaderboard/weekly?limit=1&offset=0"
    Assert-Stage1 ($all.total -ge 1 -and @($all.entries).Count -eq 1 -and $null -ne $week.total) 'public boards did not return entries'
    $detail = Invoke-RestMethod -Uri "$PublicBase/api/v1/scores/$($all.entries[0].id)"
    Assert-Stage1 ($detail.score.id -eq $all.entries[0].id) 'public score detail failed'
    [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); health = $health; allTimeTotal = $all.total; weeklyTotal = $week.total }
}
function Test-Migration0003([scriptblock]$Q) {
    Assert-Stage1 (((& $Q 'SELECT name FROM d1_migrations ORDER BY id').name -join ',') -eq '0001_init.sql,0002_time_limit.sql,0003_reports.sql') 'ledger is not exactly 0001-0003'
    $cols = ((& $Q 'PRAGMA table_info(score_reports)') | ForEach-Object { "$($_.name):$($_.pk)" }) -join ','
    Assert-Stage1 ($cols -eq 'score_id:1,reporter_hash:2,reason:0,created_at:0') "score_reports columns are [$cols]"
    $fk = & $Q 'PRAGMA foreign_key_list(score_reports)'
    Assert-Stage1 ($fk.Count -eq 1 -and $fk[0].table -eq 'scores' -and $fk[0].from -eq 'score_id' -and $fk[0].on_delete -eq 'CASCADE') 'score_reports foreign key'
    Assert-Stage1 (@((& $Q 'PRAGMA index_list(score_reports)').name) -contains 'idx_score_reports_created') 'idx_score_reports_created missing'
    Assert-Stage1 ((& $Q "SELECT name FROM sqlite_master WHERE name IN ('score_reports_next', 'moderation_audit', 'idx_score_reports_queue')").Count -eq 0) '0004 objects already present'
    Assert-Stage1 (@((& $Q 'PRAGMA table_info(scores)').name) -notcontains 'display_name') '0004 columns already present'
    Assert-Stage1 ((& $Q 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors'
}
function Test-Migration0004([scriptblock]$Q) {
    Assert-Stage1 (((& $Q 'SELECT name FROM d1_migrations ORDER BY id').name -join ',') -eq '0001_init.sql,0002_time_limit.sql,0003_reports.sql,0004_moderation_workflow.sql') 'ledger is not exactly 0001-0004'
    $c = @{}; (& $Q 'PRAGMA table_info(scores)') | ForEach-Object { $c[$_.name] = "$($_.type)|$($_.notnull)|$($_.dflt_value)" }
    Assert-Stage1 ($c['display_name'] -eq 'TEXT|0|' -and $c['moderation_revision'] -eq 'INTEGER|1|0' -and $c['suspicion_reviewed'] -eq 'INTEGER|1|0') 'new scores columns or defaults'
    $cols = ((& $Q 'PRAGMA table_info(score_reports)') | ForEach-Object { "$($_.name):$($_.pk)" }) -join ','
    Assert-Stage1 ($cols -eq 'score_id:1,reporter_hash:2,reason:0,created_at:0,status:0') "score_reports columns are [$cols]"
    $ddl = (& $Q "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'score_reports'")[0].sql
    Assert-Stage1 ($ddl -match 'suspicious_score' -and $ddl -match "DEFAULT 'open'" -and $ddl -match 'WITHOUT ROWID') 'score_reports reason/status constraints'
    $fk = & $Q 'PRAGMA foreign_key_list(score_reports)'
    Assert-Stage1 ($fk.Count -eq 1 -and $fk[0].table -eq 'scores' -and $fk[0].on_delete -eq 'CASCADE') 'score_reports foreign key'
    $fk = & $Q 'PRAGMA foreign_key_list(moderation_audit)'
    Assert-Stage1 ($fk.Count -eq 1 -and $fk[0].table -eq 'scores' -and $fk[0].from -eq 'score_id' -and $fk[0].on_delete -eq 'SET NULL') 'moderation_audit foreign key'
    $idx = @((& $Q 'PRAGMA index_list(score_reports)').name) + @((& $Q 'PRAGMA index_list(moderation_audit)').name)
    Assert-Stage1 (($idx -contains 'idx_score_reports_created') -and ($idx -contains 'idx_score_reports_queue') -and ($idx -contains 'idx_moderation_audit_score')) 'moderation indexes missing'
    Assert-Stage1 ((& $Q "SELECT name FROM sqlite_master WHERE name = 'score_reports_next'").Count -eq 0) 'temporary score_reports_next left behind'
    Assert-Stage1 ((& $Q 'SELECT COUNT(*) AS n FROM scores WHERE display_name IS NOT NULL OR moderation_revision <> 0 OR suspicion_reviewed <> 0')[0].n -eq 0) 'new score columns not at defaults'
    Assert-Stage1 ((& $Q "SELECT COUNT(*) AS n FROM score_reports WHERE status <> 'open'")[0].n -eq 0) 'existing reports not open'
    Assert-Stage1 ((& $Q 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors'
}
# Every pre-migration score (original fields) and accepted run in the verified backup must still exist unchanged.
function Test-Preserved([scriptblock]$Q) {
    $scores = @{}; foreach ($row in (& $Q $ScoresSql)) { $scores[$row.id] = ConvertTo-Canonical $row }
    $runs = @{}; foreach ($row in (& $Q $AcceptedRunsSql)) { $runs[$row.id] = ConvertTo-Canonical $row }
    $badScores = @($BackupScores | Where-Object { $scores[$_.id] -cne (ConvertTo-Canonical $_) }).Count
    $badRuns = @($BackupAcceptedRuns | Where-Object { $runs[$_.id] -cne (ConvertTo-Canonical $_) }).Count
    Assert-Stage1 ($badScores -eq 0) "$badScores backed-up score rows missing or changed"
    Assert-Stage1 ($badRuns -eq 0) "$badRuns backed-up accepted runs missing or changed"
    Assert-Stage1 ((& $Q 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors'
    [ordered]@{ backupScoresUnchanged = $BackupScores.Count; backupAcceptedRunsUnchanged = $BackupAcceptedRuns.Count; scoresNow = $scores.Count; scoresAddedSinceBackup = $scores.Count - $BackupScores.Count }
}
$ProdQ = { param($Sql) Invoke-ProdQuery $Sql }
```

Then run the session guards and local staging. EXPECT: `SETUP OK` and the record path.

<!-- stage1:setup -->
```powershell
Assert-Stage1 (-not $env:CI) 'CI is set, so Wrangler would auto-confirm prompts; use a fresh interactive PowerShell'
Assert-Stage1 (Test-Path -LiteralPath .\wrangler.toml) 'run from phaser-asteroids\server'
Assert-Stage1 ((& node $WranglerJs --version) -eq '4.151.3') 'Wrangler is not the locked 4.151.3'
Assert-Stage1 ([bool]$BackupDir -and (Test-Path -LiteralPath $BackupDir -PathType Container)) 'set $BackupDir to an existing protected directory'
$BackupDir = (Resolve-Path -LiteralPath $BackupDir).Path.TrimEnd('\')
$RepoRoot = (Resolve-Path -LiteralPath (git rev-parse --show-toplevel)).Path.TrimEnd('\')
Assert-Stage1 (-not ($BackupDir + '\').StartsWith($RepoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) '$BackupDir is inside the Git repository'
Assert-Stage1 ($BackupDir.Length -le 100) '$BackupDir path is too long; local D1 copies fail past the Windows path limit (keep it at most 100 characters)'
Assert-Stage1 (-not (git status --porcelain -- migrations)) 'migrations/ differs from the checked-out commit'
$Stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$RecordFile = Join-Path $BackupDir "stage1-record-$Stamp.json"
$ExportFile = Join-Path $BackupDir "orbital-prod-d1-pre0003-$Stamp.sql"
$VerifyState = Join-Path $BackupDir "verify-import-$Stamp"
$DressState = Join-Path $BackupDir "dress-rehearsal-$Stamp"
$Record = [ordered]@{ stage = 'stage1'; startedUtc = [DateTime]::UtcNow.ToString('o'); gitHead = (git rev-parse HEAD); wrangler = '4.151.3'; migrationSha256 = [ordered]@{} }
Get-ChildItem -LiteralPath migrations -Filter '*.sql' | ForEach-Object { $Record.migrationSha256[$_.Name] = (Get-FileHash -LiteralPath $_.FullName).Hash }
# Staging config: the canonical wrangler.toml (real production binding) pointed at a migrations directory we fill one file at a time.
$RolloutDir = Join-Path ([IO.Path]::GetTempPath()) ('orbital-migration-stage-' + [guid]::NewGuid())
$MigrationStage = Join-Path $RolloutDir 'migrations'
New-Item -ItemType Directory -Path $MigrationStage | Out-Null
$StagePath = $MigrationStage.Replace('\', '/')
$StagedConfig = [IO.File]::ReadAllText((Resolve-Path .\wrangler.toml)).Replace('main = "src/worker.ts"', 'main = "' + (Join-Path $PWD 'src\worker.ts').Replace('\', '/') + '"').Replace('migrations_dir = "migrations"', 'migrations_dir = "' + $StagePath + '"')
Assert-Stage1 ([regex]::Matches($StagedConfig, [regex]::Escape("migrations_dir = `"$StagePath`"")).Count -eq 2 -and $StagedConfig.Contains("database_id = `"$ProdDbId`"")) 'staged config rewrite failed'
$RolloutConfig = Join-Path $RolloutDir 'wrangler.toml'
[IO.File]::WriteAllText($RolloutConfig, $StagedConfig)
'0001_init.sql', '0002_time_limit.sql', '0003_reports.sql' | ForEach-Object { Add-StagedMigration $_ }
Save-Record
"SETUP OK. Record: $RecordFile"
```

### Step 1: confirm the Cloudflare account, database and active Worker (read-only)

EXPECT: `STEP 1 OK`. STOP on any other account, database ID or active version.

<!-- stage1:step1 -->
```powershell
$Who = Get-WranglerJson whoami
Assert-Stage1 ($Who.loggedIn -and (@($Who.accounts.id) -contains $AccountId)) "not logged in to account $AccountId"
Assert-Stage1 (@($Who.tokenPermissions) -contains 'd1:write') 'login lacks d1:write'
$Info = Get-WranglerJson d1 info $D1 --env production
Assert-Stage1 ($Info.uuid -eq $ProdDbId) "--env production resolves to database $($Info.uuid)"
$Deploy = Get-WranglerJson deployments status --env production
Assert-Stage1 (@($Deploy.versions).Count -eq 1 -and $Deploy.versions[0].version_id -eq $OldWorkerVersion -and $Deploy.versions[0].percentage -eq 100) 'active Worker is not 100% 004624cd'
$Record.target = [ordered]@{ account = $AccountId; databaseId = $Info.uuid; sizeBytes = $Info.database_size; deploymentId = $Deploy.id; workerVersion = $OldWorkerVersion }
$Record.publicBefore = Test-PublicReads
Save-Record
'STEP 1 OK'
```

### Step 2: confirm the ledger holds only 0001 and 0002 (read-only)

EXPECT: `STEP 2 OK` and counts close to the preflight's 41 scores / 44 runs. STOP if the ledger differs, or if moderation objects or FK errors already exist. Do **not** use `d1 migrations list --remote` here: it first runs `CREATE TABLE IF NOT EXISTS d1_migrations`.

<!-- stage1:step2 -->
```powershell
$Ledger = (Invoke-ProdQuery 'SELECT name FROM d1_migrations ORDER BY id').name -join ','
Assert-Stage1 ($Ledger -eq '0001_init.sql,0002_time_limit.sql') "ledger is [$Ledger]"
Assert-Stage1 ((Invoke-ProdQuery "SELECT name FROM sqlite_master WHERE name IN ('score_reports', 'score_reports_next', 'moderation_audit')").Count -eq 0) 'moderation tables exist without ledger entries'
Assert-Stage1 ((Invoke-ProdQuery 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors before migration'
$ProdSchema = Invoke-ProdQuery $SchemaSql
$Record.before = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); ledger = $Ledger; counts = (Invoke-ProdQuery $CountsSql)[0] }
Save-Record
$Record.before.counts | Format-List
'STEP 2 OK'
```

### Step 3: capture and record a restore bookmark (read-only)

EXPECT: `STEP 3 OK` and a printed bookmark. STOP if either lookup fails, because there would be no restore point. The record file holds the bookmarks. Keep it with the export, and copy the printed bookmark into the protected release record as well.

<!-- stage1:step3 -->
```powershell
$LookupUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 60
$Current = Get-WranglerJson d1 time-travel info $D1 --env production
$AtTime = Get-WranglerJson d1 time-travel info $D1 --env production --timestamp $LookupUnix
Assert-Stage1 ([bool]$Current.bookmark -and [bool]$AtTime.bookmark) 'Time Travel did not return bookmarks'
$Record.restore = [ordered]@{ capturedUtc = [DateTime]::UtcNow.ToString('o'); beforeStage1Bookmark = $Current.bookmark; lookupUnix = $LookupUnix; lookupBookmark = $AtTime.bookmark }
Save-Record
"Restore point before Stage 1: $($Current.bookmark)"
'STEP 3 OK'
```

### Step 4: export production to a private SQL file outside Git

Reads production; D1 may briefly pause other queries while the export runs. EXPECT: `STEP 4 OK`, a file of roughly 100 kB and its SHA-256. STOP on an authorization error or a failed check. Never stage, commit, upload or attach this file.

<!-- stage1:step4 -->
```powershell
Assert-Stage1 (-not (Test-Path -LiteralPath $ExportFile)) 'export file already exists'
# Out-Null hides the one-hour signed download URL Wrangler prints; errors still appear.
Invoke-Wrangler d1 export $D1 --env production --remote --output $ExportFile | Out-Null
$ExportItem = Get-Item -LiteralPath $ExportFile
$ExportSql = [IO.File]::ReadAllText($ExportItem.FullName)
foreach ($t in 'runs', 'scores', 'rate_limits', 'd1_migrations') { Assert-Stage1 ($ExportSql -match "CREATE TABLE[^(]*\b$t\b") "export has no CREATE TABLE for $t" }
Assert-Stage1 ($ExportSql -match 'INSERT INTO') 'export contains no rows'
Assert-Stage1 ($ExportSql -notmatch 'CREATE TABLE[^(]*\b(score_reports|moderation_audit)\b') 'export already contains moderation tables'
$Record.export = [ordered]@{ file = $ExportItem.FullName; bytes = $ExportItem.Length; sha256 = (Get-FileHash -LiteralPath $ExportFile).Hash; finishedUtc = [DateTime]::UtcNow.ToString('o') }
Save-Record
$Record.export | Format-List
'STEP 4 OK'
```

### Step 5: verify the backup by importing it into an isolated local D1

Local writes only (inside `$BackupDir`); production is only read. The second import is a dress rehearsal that applies both committed migrations to a copy of the real data. Wrangler asks to confirm applying 2 migrations **locally**: answer `y`. EXPECT: `STEP 5 OK`. On a count mismatch (a write landed after the export), delete this attempt's export and copies and restart at step 3. On any other failure, STOP: the backup is not proven restorable.

<!-- stage1:step5 -->
```powershell
Invoke-Wrangler d1 execute $D1 --local --persist-to $VerifyState --file $ExportFile | Out-Null
Assert-Stage1 ((ConvertTo-Canonical (Invoke-LocalQuery $VerifyState $SchemaSql)) -ceq (ConvertTo-Canonical $ProdSchema)) 'imported schema differs from production'
Assert-Stage1 (((Invoke-LocalQuery $VerifyState 'SELECT name FROM d1_migrations ORDER BY id').name -join ',') -eq '0001_init.sql,0002_time_limit.sql') 'imported ledger is not 0001/0002'
Assert-Stage1 ((Invoke-LocalQuery $VerifyState 'PRAGMA foreign_key_check').Count -eq 0) 'imported copy has foreign-key errors'
$CopyCounts = (Invoke-LocalQuery $VerifyState $CountsSql)[0]
Assert-Stage1 ((ConvertTo-Canonical $CopyCounts) -ceq (ConvertTo-Canonical (Invoke-ProdQuery $CountsSql)[0])) 'imported counts differ from production now (restart at step 3)'
$BackupScores = Invoke-LocalQuery $VerifyState $ScoresSql
$BackupAcceptedRuns = Invoke-LocalQuery $VerifyState $AcceptedRunsSql
Assert-Stage1 ((ConvertTo-Canonical $BackupScores) -ceq (ConvertTo-Canonical (Invoke-ProdQuery $ScoresSql))) 'imported scores differ from production'
Assert-Stage1 ((ConvertTo-Canonical $BackupAcceptedRuns) -ceq (ConvertTo-Canonical (Invoke-ProdQuery $AcceptedRunsSql))) 'imported accepted runs differ from production'
Invoke-Wrangler d1 execute $D1 --local --persist-to $DressState --file $ExportFile | Out-Null
Invoke-Wrangler d1 migrations apply $D1 --local --persist-to $DressState
$DressQ = { param($Sql) Invoke-LocalQuery $DressState $Sql }
Test-Migration0004 $DressQ
$Record.backupVerified = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); counts = $CopyCounts; dressRehearsal = Test-Preserved $DressQ }
Save-Record
$CopyCounts | Format-List
'STEP 5 OK'
```

### Step 6: apply 0003 only (PRODUCTION WRITE)

The guard checks that the staging directory holds 0001-0003 only. The block then records a fresh restore point and lists pending migrations, which must be exactly `0003_reports.sql`. When Wrangler asks *About to apply 1 migration(s)*, answer `y` only if the table it shows lists `0003_reports.sql` alone. Otherwise answer `n` (nothing is applied) and STOP.

<!-- stage1:step6 -->
```powershell
$Staged = (Get-ChildItem -LiteralPath $MigrationStage -File | Sort-Object Name).Name -join ','
Assert-Stage1 ($Staged -eq '0001_init.sql,0002_time_limit.sql,0003_reports.sql') "staging directory holds [$Staged]"
$Pre = Get-WranglerJson d1 time-travel info $D1 --env production
Assert-Stage1 ([bool]$Pre.bookmark) 'no pre-migration bookmark'
$Record.restore.preMigrationUtc = [DateTime]::UtcNow.ToString('o'); $Record.restore.preMigrationBookmark = $Pre.bookmark
Save-Record
"Restore point immediately before 0003: $($Pre.bookmark)"
Invoke-Wrangler d1 migrations list $D1 --env production --remote --config $RolloutConfig
Invoke-Wrangler d1 migrations apply $D1 --env production --remote --config $RolloutConfig
```

### Step 7: verify 0003 (read-only)

EXPECT: `STEP 7 OK`. STOP on any failure, and do not continue to 0004.

<!-- stage1:step7 -->
```powershell
Test-Migration0003 $ProdQ
$Record.after0003 = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); counts = (Invoke-ProdQuery $CountsSql)[0]; publicReads = Test-PublicReads }
Save-Record
'STEP 7 OK'
```

### Step 8: apply 0004 (PRODUCTION WRITE)

The block stages the committed 0004 and checks its hash. The pending list must be exactly `0004_moderation_workflow.sql`. Answer `y` only if Wrangler's table shows that file alone.

<!-- stage1:step8 -->
```powershell
Add-StagedMigration '0004_moderation_workflow.sql'
Invoke-Wrangler d1 migrations list $D1 --env production --remote --config $RolloutConfig
Invoke-Wrangler d1 migrations apply $D1 --env production --remote --config $RolloutConfig
```

### Step 9: verify 0004 (read-only)

EXPECT: `STEP 9 OK`.

<!-- stage1:step9 -->
```powershell
Test-Migration0004 $ProdQ
$Record.after0004 = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); counts = (Invoke-ProdQuery $CountsSql)[0] }
Save-Record
'STEP 9 OK'
```

### Step 10: check foreign keys and data preservation (read-only)

Every score (original fields) and accepted run in the verified backup must exist unchanged in production. New rows since the backup are allowed and counted. EXPECT: `STEP 10 OK`, with `scoresAddedSinceBackup` usually 0.

<!-- stage1:step10 -->
```powershell
$Record.preservation = Test-Preserved $ProdQ
Save-Record
$Record.preservation | Format-List
'STEP 10 OK'
```

### Step 11: confirm the deployed Worker still serves public reads (read-only)

EXPECT: `STEP 11 OK`. Health alone does not touch D1; the board and detail reads do.

<!-- stage1:step11 -->
```powershell
$Deploy = Get-WranglerJson deployments status --env production
Assert-Stage1 (@($Deploy.versions).Count -eq 1 -and $Deploy.versions[0].version_id -eq $OldWorkerVersion -and $Deploy.versions[0].percentage -eq 100) 'active Worker changed during Stage 1'
$Record.publicAfter = Test-PublicReads
Assert-Stage1 ($Record.publicAfter.allTimeTotal -ge $Record.publicBefore.allTimeTotal) 'all-time board shrank during Stage 1'
Save-Record
'STEP 11 OK'
```

### Step 12: record the resulting state and stop

The canonical-config `migrations list` must report no pending migrations. It runs an idempotent `CREATE TABLE IF NOT EXISTS` on the existing ledger. EXPECT: `STAGE 1 COMPLETE`.

<!-- stage1:step12 -->
```powershell
$Post = Get-WranglerJson d1 time-travel info $D1 --env production
Invoke-Wrangler d1 migrations list $D1 --env production --remote
$Record.final = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); ledger = (Invoke-ProdQuery 'SELECT name FROM d1_migrations ORDER BY id').name; counts = (Invoke-ProdQuery $CountsSql)[0]; afterStage1Bookmark = $Post.bookmark; workerVersion = $OldWorkerVersion }
Save-Record
Remove-Item -LiteralPath $RolloutDir -Recurse -Force   # staged copies of committed SQL only
"STAGE 1 COMPLETE. Record: $RecordFile"
'Do not deploy. Stage 2 requires separate approval.'
```

### If Stage 1 stops

| Where | Production state | Action |
| --- | --- | --- |
| Setup or steps 1-5 | Unchanged. Step 4 only reads. | Fix the cause and restart from setup (new stamp). Delete abandoned export/copies under the retention process. An abandoned `%TEMP%\orbital-migration-stage-*` holds only committed SQL and can be deleted. |
| Step 6 apply fails | Wrangler rolls back the failing file and does not record it, so the ledger should still be 0001/0002. Verified locally; remote atomicity is Wrangler's documented behavior, not tested on production. | Run step 2's ledger and table checks (read-only). The old Worker is unaffected. STOP and investigate on the dress-rehearsal copy. No restore. |
| Step 7 fails | 0003 recorded but not as expected | STOP before 0004. 0003 is additive, so the old Worker is unaffected. Do not drop or edit anything. Investigate read-only. |
| Step 8 apply fails | Ledger 0001-0003; failed 0004 rolled back (verified locally with an injected failure) | STOP. The old Worker serves normally on 0003. Retry the intact file only after the cause is understood and rehearsed. |
| Steps 9-11 fail | 0004 recorded | STOP and do not deploy. Do not drop columns or tables. A restore to `preMigrationBookmark` needs separate approval and discards every later write (see above). |
| Always | | Never delete ledger rows, hand-run part of a migration, rerun raw migration SQL, or run canonical-config `migrations apply --remote` (it applies everything pending at once). |

### Expected production state after Stage 1

- D1 `cf4833f7-…`: ledger exactly 0001-0004. `score_reports` has `status` (default `open`) and the `suspicious_score` reason, `moderation_audit` exists, and `scores` has `display_name`/`moderation_revision`/`suspicion_reviewed` at NULL/0/0. Indexes are `idx_score_reports_created`, `idx_score_reports_queue` and `idx_moderation_audit_score`. FK check is empty. Every pre-Stage-1 score and accepted run is unchanged; any new rows are legitimate submissions.
- Worker: still `004624cd` at 100%. Public boards and details are unchanged, still `Cache-Control: public, max-age=5`, with no admin console. Moderation features stay inactive until Stage 2.
- In `$BackupDir`: the record JSON (bookmarks before Stage 1, before 0003 and after Stage 1, plus counts, hashes and evidence), the SHA-256-verified export, and two local copies. Nothing in Git changed; nothing was pushed, merged or deployed.
- Until Stage 2 is approved, `main` must not receive any push or manual run that touches `phaser-asteroids/**`. Stage 2 would deploy the updated Worker, which is safe only on the schema above.

### Stage 1 local rehearsal evidence

**Verified locally, 2026-11-04, at HEAD `946d845` plus this document: 30/30 checks.** A scratch harness, not committed, extracted the `<!-- stage1:* -->` blocks above from this file and ran them unmodified in order, except the operator-edited `values` block. It changed only the transport. Every Wrangler call carrying `--remote` (48 calls) was rewritten to `--local` against a stand-in database, and `whoami`, `d1 info`, `deployments status` and `time-travel info` (8 calls) returned fixed values. An invalid `CLOUDFLARE_API_TOKEN` made any escaped call fail authentication. No Cloudflare account was contacted.

- **Stand-in:** canonical `wrangler.toml` with the production binding (local copy of D1 `cf4833f7-…`), 0001/0002 applied by Wrangler. It held 5 scores (visible, hidden with reason, zero-score, time-limit end, older than the week, and a nickname with an apostrophe and non-ASCII characters), 8 runs (5 accepted, plus one each issued, verifying, and rejected with a quoted detail), a config containing `;`, and 2 `rate_limits` rows.
- **Backup/export:** steps 3-5 produced a hashed export outside the repository that contains the ledger rows and the quoted/semicolon/non-ASCII payloads. The isolated import matched production in schema DDL, ledger, all counts, every score and every accepted run, with an empty FK check. The dress-rehearsal copy migrated and passed the 0004 checks and preservation. The **deployed-baseline Worker** (actual `c1871a9` sources) served the imported backup, which simulates restore-by-import.
- **Migrations:** with 0004 wrongly staged, step 6 stopped before any write. 0003 applied alone. 0004 applied alone after restaging the committed bytes (hash-checked). Steps 7, 9, 10 and 12 passed: ledger 0001-0004, then *No migrations to apply* with the canonical config.
- **Preservation and FKs:** all backed-up scores (original fields) and accepted runs were unchanged. Issued/verifying/rejected runs and rate limits survived. Three reports inserted between migrations survived the 0004 rebuild as `open`. FK checks were empty throughout.
- **Old Worker:** the deployed-baseline Worker ran continuously on the stand-in. Public boards and details answered before, between 0003 and 0004, after a failed 0004, and after 0004 (steps 1, 7, 11). Old-Worker **submissions** on the expanded schema are covered separately by `npm run test:release:migrations` (re-run: 40/40).
- **Failure:** a staged 0004 with a failing final statement exited nonzero, which the block surfaced as `STOP`. It left the ledger at 0001-0003, no new columns, no `moderation_audit`/`score_reports_next`, and reports untouched. The 0003 checks and public reads still passed.
- **Guards:** setup refused a backup directory inside the repository and a session with `CI` set. A first attempt from a deep scratch path failed inside workerd on the local D1 path, which is why setup now enforces the 100-character limit on `$BackupDir`.
- **Not provable locally:** the real remote export format (for example whether it emits `_cf_KV`, or DDL text that differs from `sqlite_master`), remote atomicity of a failed migration, export/restore permissions, and Time Travel restore. Steps 4-5 test the first on real data before any write. The others stay inferred.

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

Check each exit before continuing; PowerShell does not automatically stop on native nonzero exits. Direct browser entries reuse built assets. Frontend/server have no configured lint script; Android lint is separate. From `server`, define `Invoke-Wrangler` (Stage 1 helpers) and inspect read-only targets:

```powershell
Invoke-Wrangler whoami
Invoke-Wrangler deployments list --env production
Invoke-Wrangler secret list --env production
Invoke-Wrangler d1 info asteroids-leaderboard --env production
Invoke-Wrangler d1 execute asteroids-leaderboard --env production --remote --command "SELECT name, applied_at FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check; SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM runs) AS runs;"
Invoke-Wrangler deploy --dry-run --env production --outdir .wrangler/release-dry-run
```

`secret list` lists names, never substitute a value dump. Save previous Worker version ID/source artifact and existing recovery credentials; avoid the initial-provisioning secret-initialization helper for routine releases.

**Go:** exact SHA/clean checkout, passing checks, identified account/DB/active version, 0001/0002 applied, Stage 1 complete (ledger 0001-0004, record and verified export saved), monitoring/operator available. **Stop:** missing historical migration, unexpected pending files or differing schema/ledger. If already applied, verify schema and skip; never rewrite ledger.

**Release trigger gate:** `.github/workflows/deploy-gh-pages.yml` deploys Worker then Pages on `main` pushes that touch `phaser-asteroids/**` or the workflow file, and on `workflow_dispatch` runs from `main`. Changes only to root `docs/` never trigger it, even on `main`; pushes to `dev` never deploy. `browser-suites.yml` is manual-only and deploys nothing. It does not apply or check migrations; health cannot detect missing columns. Do not merge/push/trigger until both migrations are verified. PR/non-main validation does not deploy. No workflow/repository settings were changed here.

### 2. Apply migrations with a verification pause

Run [Stage 1](#stage-1-production-d1-backup-and-migrations) (separately authorized). It replaces the earlier commands here: same staged-config technique, plus a recorded restore point, verified export, dress rehearsal, scripted checks and STOP conditions. Pinned Wrangler applies **all** pending files and has no per-file/target flag, so never run canonical-config `migrations apply --remote` while 0003 and 0004 are both pending. The temporary config is for migrations only; deploy using the canonical config.

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

Run `restore` interactively and without `--json`: `--json` skips the confirmation, and redirected/CI runs answer it yes automatically. Retain the restore operation's previous bookmark for undo within provider eligibility. If Time Travel unavailable, never import blindly over production: validate export in empty isolated DB and separately approve a replacement/rebind or exact restore plan. Worker rollback, schema rollback and whole-content recovery are distinct operations. [Worker rollback](https://developers.cloudflare.com/workers/wrangler/commands/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/).
