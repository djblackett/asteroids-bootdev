# Hull & Havoc moderation digest: production activation runbook

Prepared 2026-11-12 on `release/hull-and-havoc-rc`. **Nothing here has been run against production.** Every step marked *PRODUCTION WRITE*, *DNS*, *SECRET* or *LIVE EMAIL* needs your explicit authorization at the time you run it. The D1 blocks (`<!-- digest:* -->`) were rehearsed against a local stand-in database; see [Rehearsal evidence](#rehearsal-evidence).

What the digest is and how it behaves: [leaderboard-moderation.md#daily-moderation-digest](leaderboard-moderation.md#daily-moderation-digest). This runbook only activates it.

## Dependencies and order

| # | Step | Kind | Depends on |
| --- | --- | --- | --- |
| 1 | Confirm the `privacy@davidandrea.ca` mailbox | Owner, Google Workspace | |
| 2 | Resend account, sending subdomain, DNS records | DNS (Cloudflare), no MX change at the root | |
| 3 | Sending-only API key | Credential | 2 verified |
| 4-8 | D1 bookmark, export, verify, apply **0005**, verify | PRODUCTION WRITE (D1 only) | none of 1-3; can run any time |
| 9 | Set `MODERATION_DIGEST_FROM`, release through `main` | Release (Worker **and GitHub Pages**) | 2, 4-8, **privacy-policy approval** (see below) |
| 10 | Controlled delivery test | LIVE EMAIL (one) | 3 |
| 11 | `wrangler secret put RESEND_API_KEY` | SECRET | 9, 10 |
| 12 | Post-activation verification | Read-only | 11 plus the next 07:17 UTC cron |

**Release coupling.** Pushing or merging to `main` runs `.github/workflows/deploy-gh-pages.yml`, which deploys the Worker *and* republishes GitHub Pages. This release candidate also contains the public privacy page (`phaser-asteroids/public/privacy/`) and the Hull & Havoc branding, so step 9 **publishes the privacy policy**. Do step 9 only after you approve the policy. To activate the digest earlier, release a server-only change (only `phaser-asteroids/server/**`) to `main` separately. That is a different release, and it needs its own review.

**Safe orders.** The Worker code is safe on a database without 0005: unconfigured, it logs `disabled` and touches no digest table. Configured without the table, it logs `error` and cleanup still runs. 0005 is additive, and the current Worker `c2aef78f` ignores it. So 4-8 may come before or after 9. The order above (schema first) avoids any `error` run.

## 1. Mailbox (owner, no repository change)

Confirm in the Google Workspace admin console that `privacy@davidandrea.ca` is a mailbox, alias or group that you monitor. Do not change MX, SPF, DKIM or DMARC on `davidandrea.ca`; Google Workspace keeps receiving mail as now.

## 2. Resend sending subdomain (DNS in Cloudflare)

Use a **subdomain**, so the root domain's Google Workspace records stay untouched. Suggested name: `notify.davidandrea.ca` (any unused name works; it then appears in `MODERATION_DIGEST_FROM`).

1. Sign in to Resend. Go to **Domains > Add domain** and enter the subdomain. Pick the region closest to you; it only affects the return-path host.
2. Resend lists the DNS records to add. **Copy the values from the Resend dashboard; do not type them from memory or from this page.** They are normally:
   - a DKIM **TXT** record at `resend._domainkey.<subdomain>`;
   - an **MX** record and an SPF **TXT** record on the bounce host `send.<subdomain>`. The MX sits on that host only, not on `davidandrea.ca`, so inbound mail at the root is unaffected;
   - optionally a DMARC **TXT** record at `_dmarc.<subdomain>`. Without one, the subdomain inherits the root domain's DMARC policy, which is fine.
3. In the Cloudflare dashboard, open **davidandrea.ca > DNS > Records** and add each record exactly as shown, as **DNS only** (grey cloud; TXT and MX cannot be proxied anyway). Before saving, check that no record targets the bare `davidandrea.ca` name or edits an existing MX/TXT record there. If the Resend wizard offers to configure Cloudflare automatically, that is acceptable only if its preview lists the same subdomain-only records.
4. Wait for Resend to show the domain as **Verified**. STOP here until it does.

Sender for step 9: `Hull & Havoc <moderation@notify.davidandrea.ca>` (replace `notify` with your subdomain). The digest's validator accepts `Name <address>` with a name of at most 80 characters and no quotes or angle brackets.

## 3. API key (credential)

1. In Resend, go to **API Keys > Create API key**. Permission **Sending access**, restricted to the verified subdomain. Name it something like `hull-and-havoc-worker-digest`.
2. The key is shown once. Keep it only in your password manager until step 10. Never paste it into a file in the repository, `wrangler.toml`, `.dev.vars` that you might commit, a GitHub Actions variable, a command-line argument or a chat. The Worker never logs it, and its error text is redacted.
3. If it is ever exposed, revoke it in Resend and create a new one. Step 11 replaces the Worker copy.

## 4-8. D1: backup, then apply 0005 (PRODUCTION WRITE in step 7 only)

Run in a fresh, interactive **PowerShell** window (not CI, not Git Bash), logged in with `npx wrangler login` on account `620de0810a6cf29710d9fedb3a966d6f`. Check out the commit you will release, so the migration file matches what ships.

### Setup (no production access)

Edit the value, then run:

<!-- digest:values -->
```powershell
Set-Location 'C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\server'
$BackupDir = $null   # REQUIRED: existing protected directory outside the repository, at most 100 characters, e.g. 'C:\Users\davej\OrbitalRelease\digest'
```

Helper definitions (they only define functions and constants):

<!-- digest:helpers -->
```powershell
$ErrorActionPreference = 'Stop'
$env:WRANGLER_SEND_METRICS = 'false'
$D1 = 'asteroids-leaderboard'
$AccountId = '620de0810a6cf29710d9fedb3a966d6f'
$ProdDbId = 'cf4833f7-5fc9-45ca-a767-750df108f1e9'
$ExpectedWorkerVersion = 'c2aef78f-ec27-4118-bd2c-a13f59b7313b'   # active since Stage 2 (2026-11-04); STOP if it differs
$PublicBase = 'https://asteroids-leaderboard.davejandrea.workers.dev'
$WranglerJs = Join-Path $PWD 'node_modules\wrangler\bin\wrangler.js'
$Ledger0004 = '0001_init.sql,0002_time_limit.sql,0003_reports.sql,0004_moderation_workflow.sql'
$Ledger0005 = $Ledger0004 + ',0005_moderation_digest.sql'
$CountsSql = "SELECT (SELECT COUNT(*) FROM scores) AS scores, (SELECT COUNT(*) FROM scores WHERE visibility = 'hidden') AS hidden_scores, (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM score_reports) AS reports, (SELECT COUNT(*) FROM moderation_audit) AS audit, (SELECT COUNT(*) FROM d1_migrations) AS migrations"
$ScoresSql = 'SELECT * FROM scores ORDER BY id'
$DigestColumns = 'day,status,attempts,claimed_at,subject,body,expired,provider_id,error,updated_at'

function Assert-Digest([bool]$Ok, [string]$Message) { if (-not $Ok) { throw "STOP: $Message" } }
function Invoke-Wrangler {
    & node $WranglerJs @args
    if ($LASTEXITCODE -ne 0) { throw "STOP: wrangler $($args[0..2] -join ' ') exited $LASTEXITCODE" }
}
function Get-WranglerJson {
    $out = & node $WranglerJs @args --json
    if ($LASTEXITCODE -ne 0) { throw "STOP: wrangler $($args[0..2] -join ' ') exited $LASTEXITCODE" }
    ($out -join "`n") | ConvertFrom-Json
}
# Read-only production query: fails if D1 reports any write. One statement, one line (newlines break the Windows argument).
function Invoke-ProdQuery([string]$Sql) {
    $r = @(Get-WranglerJson d1 execute $D1 --env production --remote --command $Sql)
    Assert-Digest (-not ($r | Where-Object { $_.meta.rows_written -or $_.meta.changed_db })) 'a read-only check reported a write'
    Write-Output -NoEnumerate @($r[0].results)
}
function Invoke-LocalQuery([string]$State, [string]$Sql) {
    $r = @(Get-WranglerJson d1 execute $D1 --local --persist-to $State --command $Sql)
    Write-Output -NoEnumerate @($r[0].results)
}
function ConvertTo-Canonical($Value) { ConvertTo-Json -InputObject $Value -Depth 6 -Compress }
function Save-Record { $Record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RecordFile -Encoding utf8 }
function Test-Ledger([scriptblock]$Q, [string]$Expected) { ((& $Q 'SELECT name FROM d1_migrations ORDER BY id').name -join ',') -eq $Expected }
function Test-Migration0005([scriptblock]$Q) {
    Assert-Digest (Test-Ledger $Q $Ledger0005) 'ledger is not exactly 0001-0005'
    $cols = ((& $Q 'PRAGMA table_info(moderation_digests)') | ForEach-Object { $_.name }) -join ','
    Assert-Digest ($cols -eq $DigestColumns) "moderation_digests columns are [$cols]"
    $ddl = (& $Q "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'moderation_digests'")[0].sql
    Assert-Digest ($ddl -match 'superseded' -and $ddl -match 'WITHOUT ROWID') 'moderation_digests status constraint'
    Assert-Digest ((& $Q 'SELECT COUNT(*) AS n FROM moderation_digests')[0].n -eq 0) 'moderation_digests is not empty'
    Assert-Digest ((& $Q 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors'
}
function Test-PublicReads {
    $health = Invoke-RestMethod -Uri "$PublicBase/api/v1/health"
    $all = Invoke-RestMethod -Uri "$PublicBase/api/v1/leaderboard/all-time?limit=1&offset=0"
    Assert-Digest ($all.total -ge 1 -and @($all.entries).Count -eq 1) 'public board did not return entries'
    [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); rules = $health.rulesVersion; allTimeTotal = $all.total }
}
$ProdQ = { param($Sql) Invoke-ProdQuery $Sql }
```

Session guards. EXPECT: `SETUP OK` and the record path.

<!-- digest:setup -->
```powershell
Assert-Digest (-not $env:CI) 'CI is set, so Wrangler would auto-confirm prompts; use a fresh interactive PowerShell'
Assert-Digest (Test-Path -LiteralPath .\wrangler.toml) 'run from phaser-asteroids\server'
Assert-Digest ((& node $WranglerJs --version) -eq '4.151.3') 'Wrangler is not the locked 4.151.3'
Assert-Digest ([bool]$BackupDir -and (Test-Path -LiteralPath $BackupDir -PathType Container)) 'set $BackupDir to an existing protected directory'
$BackupDir = (Resolve-Path -LiteralPath $BackupDir).Path.TrimEnd('\')
$RepoRoot = (Resolve-Path -LiteralPath (git rev-parse --show-toplevel)).Path.TrimEnd('\')
Assert-Digest (-not ($BackupDir + '\').StartsWith($RepoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) '$BackupDir is inside the Git repository'
Assert-Digest ($BackupDir.Length -le 100) '$BackupDir is too long for local D1 copies'
Assert-Digest (-not (git status --porcelain -- migrations)) 'migrations/ differs from the checked-out commit'
$Files = (Get-ChildItem -LiteralPath migrations -Filter '*.sql' | Sort-Object Name).Name -join ','
Assert-Digest ($Files -eq $Ledger0005) "migrations/ holds [$Files]; expected exactly 0001-0005"
$Stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$RecordFile = Join-Path $BackupDir "digest-record-$Stamp.json"
$ExportFile = Join-Path $BackupDir "prod-d1-pre0005-$Stamp.sql"
$VerifyState = Join-Path $BackupDir "verify-$Stamp"
$DressState = Join-Path $BackupDir "dress-$Stamp"
$Record = [ordered]@{ stage = 'digest-0005'; startedUtc = [DateTime]::UtcNow.ToString('o'); gitHead = (git rev-parse HEAD); sha256_0005 = (Get-FileHash -LiteralPath migrations\0005_moderation_digest.sql).Hash }
Save-Record
"SETUP OK. Record: $RecordFile"
```

### Step 4: confirm account, database, Worker and ledger (read-only)

EXPECT: `STEP 4 OK`. STOP on another account, database or active version, or on any ledger other than exactly 0001-0004. Do not use `d1 migrations list` here; it writes (`CREATE TABLE IF NOT EXISTS`).

<!-- digest:step4 -->
```powershell
$Who = Get-WranglerJson whoami
Assert-Digest ($Who.loggedIn -and (@($Who.accounts.id) -contains $AccountId)) "not logged in to account $AccountId"
$Info = Get-WranglerJson d1 info $D1 --env production
Assert-Digest ($Info.uuid -eq $ProdDbId) "--env production resolves to database $($Info.uuid)"
$Deploy = Get-WranglerJson deployments status --env production
Assert-Digest (@($Deploy.versions).Count -eq 1 -and $Deploy.versions[0].version_id -eq $ExpectedWorkerVersion -and $Deploy.versions[0].percentage -eq 100) 'active Worker is not 100% the expected version'
Assert-Digest (Test-Ledger $ProdQ $Ledger0004) 'production ledger is not exactly 0001-0004'
Assert-Digest ((Invoke-ProdQuery "SELECT name FROM sqlite_master WHERE name = 'moderation_digests'").Count -eq 0) 'moderation_digests exists without a ledger entry'
Assert-Digest ((Invoke-ProdQuery 'PRAGMA foreign_key_check').Count -eq 0) 'foreign-key errors before migration'
$Record.before = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); workerVersion = $ExpectedWorkerVersion; counts = (Invoke-ProdQuery $CountsSql)[0]; publicReads = Test-PublicReads }
Save-Record
$Record.before.counts | Format-List
'STEP 4 OK'
```

### Step 5: bookmark and export (read-only)

Records a Time Travel restore point, then exports production to a private file outside Git (D1 may briefly pause other queries during the export). EXPECT: `STEP 5 OK`, a bookmark and the export's SHA-256. Never commit, upload or attach the export.

<!-- digest:step5 -->
```powershell
$Bookmark = Get-WranglerJson d1 time-travel info $D1 --env production
Assert-Digest ([bool]$Bookmark.bookmark) 'Time Travel returned no bookmark'
$Record.restore = [ordered]@{ capturedUtc = [DateTime]::UtcNow.ToString('o'); before0005Bookmark = $Bookmark.bookmark }
Save-Record
"Restore point before 0005: $($Bookmark.bookmark)"
Assert-Digest (-not (Test-Path -LiteralPath $ExportFile)) 'export file already exists'
Invoke-Wrangler d1 export $D1 --env production --remote --output $ExportFile | Out-Null   # Out-Null hides the one-hour signed URL
$ExportSql = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ExportFile))
foreach ($t in 'scores', 'runs', 'score_reports', 'moderation_audit', 'd1_migrations') { Assert-Digest ($ExportSql -match "CREATE TABLE[^(]*\b$t\b") "export has no CREATE TABLE for $t" }
Assert-Digest ($ExportSql -notmatch 'CREATE TABLE[^(]*\bmoderation_digests\b') 'export already contains moderation_digests'
$Record.export = [ordered]@{ file = $ExportFile; bytes = (Get-Item -LiteralPath $ExportFile).Length; sha256 = (Get-FileHash -LiteralPath $ExportFile).Hash }
Save-Record
$Record.export | Format-List
'STEP 5 OK'
```

### Step 6: prove the export restores, and dress-rehearse 0005 on it (local only)

Imports the export into two isolated local databases inside `$BackupDir`, then applies 0005 to the second. Wrangler asks to confirm applying 1 migration **locally**: answer `y`. EXPECT: `STEP 6 OK`. On a count mismatch (a score was submitted after the export), delete this attempt's export and copies and restart at step 5. On any other failure, STOP.

<!-- digest:step6 -->
```powershell
Invoke-Wrangler d1 execute $D1 --local --persist-to $VerifyState --file $ExportFile | Out-Null
$VerifyQ = { param($Sql) Invoke-LocalQuery $VerifyState $Sql }
Assert-Digest (Test-Ledger $VerifyQ $Ledger0004) 'imported ledger is not 0001-0004'
Assert-Digest ((ConvertTo-Canonical (Invoke-LocalQuery $VerifyState $CountsSql)[0]) -ceq (ConvertTo-Canonical (Invoke-ProdQuery $CountsSql)[0])) 'imported counts differ from production now (restart at step 5)'
$BackupScores = ConvertTo-Canonical (Invoke-LocalQuery $VerifyState $ScoresSql)
Assert-Digest ($BackupScores -ceq (ConvertTo-Canonical (Invoke-ProdQuery $ScoresSql))) 'imported scores differ from production'
Invoke-Wrangler d1 execute $D1 --local --persist-to $DressState --file $ExportFile | Out-Null
Invoke-Wrangler d1 migrations apply $D1 --local --persist-to $DressState
$DressQ = { param($Sql) Invoke-LocalQuery $DressState $Sql }
Test-Migration0005 $DressQ
Assert-Digest ((ConvertTo-Canonical (Invoke-LocalQuery $DressState $ScoresSql)) -ceq $BackupScores) 'dress rehearsal changed score rows'
$Record.backupVerified = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); dressRehearsal0005 = 'ok' }
Save-Record
'STEP 6 OK'
```

### Step 7: apply 0005 (PRODUCTION WRITE)

Records a fresh restore point, then applies. With the ledger at 0001-0004 and `migrations/` holding exactly 0001-0005 (both checked above), the only pending file is 0005. When Wrangler asks *About to apply 1 migration(s)*, answer `y` **only if its table lists `0005_moderation_digest.sql` alone**. Otherwise answer `n` (nothing is applied) and STOP.

<!-- digest:step7 -->
```powershell
$Pre = Get-WranglerJson d1 time-travel info $D1 --env production
Assert-Digest ([bool]$Pre.bookmark) 'no pre-migration bookmark'
$Record.restore.pre0005Utc = [DateTime]::UtcNow.ToString('o'); $Record.restore.pre0005Bookmark = $Pre.bookmark
Save-Record
"Restore point immediately before 0005: $($Pre.bookmark)"
Invoke-Wrangler d1 migrations apply $D1 --env production --remote
```

### Step 8: verify 0005 and data preservation (read-only)

EXPECT: `STEP 8 OK`. Scores submitted since the export are allowed; every backed-up score row must be unchanged.

<!-- digest:step8 -->
```powershell
Test-Migration0005 $ProdQ
$Now = @{}; foreach ($row in (Invoke-ProdQuery $ScoresSql)) { $Now[$row.id] = ConvertTo-Canonical $row }
$Changed = @((Invoke-LocalQuery $VerifyState $ScoresSql) | Where-Object { $Now[$_.id] -cne (ConvertTo-Canonical $_) }).Count
Assert-Digest ($Changed -eq 0) "$Changed backed-up score rows missing or changed"
$Deploy = Get-WranglerJson deployments status --env production
Assert-Digest ($Deploy.versions[0].version_id -eq $ExpectedWorkerVersion) 'active Worker changed during the migration'
$Post = Get-WranglerJson d1 time-travel info $D1 --env production
$Record.after0005 = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); counts = (Invoke-ProdQuery $CountsSql)[0]; publicReads = Test-PublicReads; after0005Bookmark = $Post.bookmark }
Save-Record
"STEP 8 OK. Record: $RecordFile"
```

**If a D1 step stops:** steps 4-6 change nothing in production; fix the cause and restart from setup. If step 7 fails, Wrangler rolls back the failing file and does not record it (documented behavior; rehearsed locally only for 0004), so rerun step 4's ledger check read-only and STOP. If step 8 fails after a recorded 0005, do not drop or edit anything: the table is additive and the current Worker ignores it. Investigate read-only. A Time Travel restore would discard every score submitted after the bookmark, so do not use it for a digest problem.

## 9. Configure the sender and release (needs policy approval)

1. On the release branch, in `phaser-asteroids/server/wrangler.toml` under `[env.production.vars]`, replace the commented line with your verified sender:
   `MODERATION_DIGEST_FROM = "Hull & Havoc <moderation@notify.davidandrea.ca>"`
   `MODERATION_DIGEST_TO` (`privacy@davidandrea.ca`) and `MODERATION_DASHBOARD_URL` are already set. Commit.
2. Run the local verification listed in [play-release-validation.md](play-release-validation.md#release-candidate-hull--havoc-2026-11-12) on that commit, including `npx wrangler deploy --env production --dry-run` from `phaser-asteroids/server`.
3. With policy approval, merge to `main` by pull request and push (the only step that triggers CI). CI validates, deploys the Worker, checks `/api/v1/health` and publishes Pages.
4. Verify (read-only): `npx wrangler deployments status --env production` shows one new version at 100%; the public board and `/admin` load; `https://djblackett.github.io/asteroids-bootdev/privacy/` loads in a private window. The digest is still disabled (no key), so `SELECT COUNT(*) FROM moderation_digests` stays 0 after the next cron.

## 10. Controlled delivery test (LIVE EMAIL: exactly one)

Proves the key, sender and mailbox, independently of the Worker (the Worker's request is covered by `npm run test:worker` against a local mock provider). It sends one fixed message with no player data and touches no database.

**Timing:** run it after 07:17 UTC, or before setting the secret in step 11. Its idempotency key has its own prefix, so it cannot collide with a daily digest key in any case.

```powershell
Set-Location 'C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\server'
$k = Read-Host 'Resend API key (input hidden)' -AsSecureString
$env:RESEND_API_KEY = [Net.NetworkCredential]::new('', $k).Password
$env:MODERATION_DIGEST_FROM = 'Hull & Havoc <moderation@notify.davidandrea.ca>'   # your verified sender
$env:MODERATION_DIGEST_TO = 'privacy@davidandrea.ca'
node scripts/digest-delivery-test.mjs                            # dry run: prints the request, sends nothing
node scripts/digest-delivery-test.mjs --confirm-one-live-email   # sends one email
Remove-Item Env:RESEND_API_KEY, Env:MODERATION_DIGEST_FROM, Env:MODERATION_DIGEST_TO; Remove-Variable k
```

EXPECT `{"status":"sent","id":"..."}` and the message in the mailbox (check spam; mark it *not spam*). On `timeout`, check the Resend dashboard's email log before retrying, because the message may have been accepted. On `http_403`/`http_422`, the domain or sender is not verified: fix it in step 2 and retry.

## 11. Enable the digest (SECRET)

```powershell
Set-Location 'C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\server'
npx wrangler secret put RESEND_API_KEY --env production   # paste at the hidden prompt; never as an argument
npx wrangler secret list --env production                 # names only: ADMIN_TOKEN, IP_HASH_SALT, RESEND_API_KEY
```

This creates a new Worker version with the same code. Do not add `RESEND_API_KEY` to `secrets.required` or to GitHub. The next 07:17 UTC cron sends a digest only if the **Needs review** queue is not empty or open reports expired. Do not create production reports to trigger one.

## 12. Post-activation verification (read-only)

After the next 07:17 UTC cron:

1. **Ledger** (the reliable record, because Workers Logs are not enabled for this Worker):
   `npx wrangler d1 execute asteroids-leaderboard --env production --remote --command "SELECT day, status, attempts, expired, error FROM moderation_digests ORDER BY day DESC LIMIT 5"`
   - No rows: nothing needed review (correct, no email).
   - `sent`: delivered to Resend; confirm the mailbox.
   - `failed` with `http_401`/`http_403`/`http_422`: key or sender problem; it retries once a day. Fix the key or domain.
   - `failed` with `timeout`/`http_5xx`: provider trouble. The next day's digest carries any expiry counts and marks the row `superseded`.
2. **Invocation health:** Cloudflare dashboard **Workers > asteroids-leaderboard > Metrics** shows the daily invocation with 0 errors. A digest problem never fails the cron, so errors there mean cleanup failed.
3. **Live log, if needed:** run `npx wrangler tail --env production --format json` around 07:17 UTC and look for `{"evt":"moderation_digest","status":...}`. It shows status and provider error names only, never the key.
4. **Duplicates:** at most one email per UTC day. More than one with the same date is a defect; disable it (below) and report it.

## Rollback and recovery

| Problem | Action | Effect |
| --- | --- | --- |
| Unwanted, wrong or duplicate emails | `npx wrangler secret delete RESEND_API_KEY --env production` | Digest `disabled` from the next cron; new Worker version, same code. Cleanup unaffected. |
| Key exposed | Revoke it in Resend, create a new one, repeat step 11 | Old key stops working immediately. |
| Worker regression unrelated to the digest | `npx wrangler rollback <previous version id> --env production` (e.g. `c2aef78f-ec27-4118-bd2c-a13f59b7313b`) | That version ignores `moderation_digests`; schema-compatible. Pages is not rolled back by this. |
| Sender domain problems | Remove the subdomain records in Cloudflare DNS | No effect on `davidandrea.ca` inbound mail. |
| 0005 itself | Leave the table. It is additive and holds counts only; ledger rows are pruned after 30 days. | Dropping it is unnecessary. If ever needed, that is a separately reviewed migration, not a manual edit. |

D1 Time Travel restore is **not** a digest recovery tool: it rewinds the whole database and discards scores submitted after the bookmark.

## Rehearsal evidence

See [play-release-validation.md](play-release-validation.md#release-candidate-hull--havoc-2026-11-12).
