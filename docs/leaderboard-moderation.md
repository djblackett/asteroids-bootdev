# Leaderboard moderation: audit and operator guide

**Current status (2026-11-12):** live in production since 2026-11-04 (see [Verification](#verification)). The deployment checklist under [Erasure, cache consistency and release configuration](#erasure-cache-consistency-and-release-configuration) is complete except where marked open. The public removal/privacy contact is **privacy@davidandrea.ca** (confirmed 2026-11-12). A [daily moderation digest](#daily-moderation-digest) is implemented and tested locally on `feature/moderation-digest` but **not deployed or configured**: it needs migration 0005, a Resend sender domain and API key. The remaining operator tasks are the initial review of existing names, digest activation, and the [policy decisions](#report-retention-and-review-policy) listed below. The rest of this page records the implementation pass as written at the time.

Audited and extended on 2026-11-04 on `dev`, starting at `91c349c` (`add moderation tooling`). Local implementation and tests only. No production deployment, production data changes, credentials changes, commits or pushes were performed. Existing inaccessible root `tmp/` deletions were left alone.

## Assessment of the previous implementation

| Area | Verified behavior / gap | Result of this pass |
| --- | --- | --- |
| Authorization | Hide/unhide and erasure checked a hashed bearer secret and throttled failed authentication; no anonymous admin bypass found. CORS alone was not the credential boundary. | One fail-closed gate now covers every admin API read/write, including unknown routes. Cross-origin browser admin requests are explicitly refused. |
| Public moderation | Both boards, totals, detail and rank calculations excluded hidden scores. A token-authenticated accepted-run retry still returned its own result with null ranks. | Preserved; replacement names also apply to boards, detail and accepted retries. |
| Reporting | In-app fixed reasons, per-IP/global limits, deduplication, retention and local nickname blocks existed and were tested. Reports did not auto-hide. | Separate suspected-cheating reason; explicit resolution/reopening; new evidence invalidates stale admin decisions. |
| Nicknames | Character/Unicode sanitation already ran on the server, not only locally. It was not an objectionable-content filter. | Narrow server-only whole-token content screen, with false-positive regression cases and the existing correctable error contract. |
| Operator workflow | Direct D1 SQL was necessary to inspect and clear reports. No practical review UI, name replacement, or decision history existed. | Worker-hosted `/admin` console, paged review/history, exact score lookup, reversible decisions and atomic audit writes. |
| Erasure | Score + accepted run + cascading reports were deleted in a batch. Run deletion trusted a reverse pointer instead of the actual FK. Exact change-count checks were unsafe with D1 cascading changes. | Uses `scores.run_id`, preserves unrelated records, anonymizes audit links, and correctly returns success for D1 cascades. Real-Worker browser coverage exercises this. |
| Cache | Public responses advertised five seconds of freshness; a prior cached response could republish a hidden name temporarily. | Public board/detail responses and new-client fetches use `no-store`. See deployment caveat below. |
| Audit / reversal | Hide could be reversed, but overwritten reasons destroyed history. Deletion was irreversible. | Append-only API audit history; hide/restore, replacement/original-name restore, resolve/reopen. Erasure remains deliberately irreversible. |
| Integrity | Frozen replay verification already rejected forged scores, wrong rules/seed/config, invalid endings and faster-than-wall-clock play. No review flags for stored-data anomalies existed. | Conservative, version-specific score/count/duration flags; never an automatic cheat verdict or ban. |

## Daily solo-administrator workflow

1. Open **the Worker's own HTTPS origin + `/admin`**, not the game's origin. Use a trusted browser/device and obtain the existing `ADMIN_TOKEN` from the protected secret store. Enter it in the password field. Do not put it in URLs, shell history, Vite variables, screenshots or the player application.
2. The **Needs review** view lists reported entries and unreviewed integrity flags, 50 at a time. Once the [daily digest](#daily-moderation-digest) is active, open it when the digest arrives and work through every page; no email means the view is empty. Until then, check it routinely. **All entries**, **Hidden entries**, and exact score-ID lookup support proactive review, appeals and restoration. Do an initial review of existing names: the new filter does not rewrite historical data.
3. Open **Reports / decision history**. The console shows grouped reasons/counts, timestamps, original/current names, rules, score, duration and kill counts. It never reveals reporter/issuer IP hashes, run tokens or full submissions. Reports describe allegations; multiple reports are not proof.
4. Choose the decision category. For an offensive name on a legitimate run, use **Replace name** (default Anonymous). The original nickname remains private in D1; score/rank inputs stay unchanged. Use **Hide** when the entry itself needs removal from public view. Use **Restore score** and **Restore original name** independently after review. Original-name restoration intentionally permits reversal of a false positive and can republish offensive content; review before confirming.
5. **Resolve reports / flag** closes the current complaints and acknowledges the integrity flag. Name/visibility changes do not silently resolve reports. **Reopen review** reverses resolution. New reports or changed open-report categories advance the revision; a stale decision fails with 409 and requires Refresh. Identical repeats do not invalidate a snapshot, and the same reporter cannot reopen an already resolved report. A different reporter can submit a new complaint.
6. The **Audit log** pages through every decision, including anonymized erasures. Per-entry history shows the newest 100. Lock when finished. The token is only held in tab memory, cleared on reload/navigation/lock and after 15 minutes without console actions. The shell is public when enabled, but contains no private data or credentials. CSP, text-only DOM rendering, no third-party resources, no framing and no referrer forwarding protect the console.

This is usable for a solo operator without routine SQL. The [daily digest](#daily-moderation-digest), once configured, is the only notification. There is **no automatic review staffing, multiple-admin identities, or appeal messaging**. The shared admin secret identifies the authorized operator role, not an individually authenticated staff member. Appeals and removal requests go to **privacy@davidandrea.ca** (shown in the in-game Privacy screen); record the outcome in the console with the `appeal` category. Direct privileged D1 changes bypass the application audit and should be exceptional. The log is not cryptographically tamper-proof against a database administrator.

## Data and reversible decisions

Migration `0004_moderation_workflow.sql` extends the existing scores/reports tables and adds `moderation_audit`. It preserves scores, runs, original names and existing reports. It requires migrations 0001-0003 first. `display_name` is a nullable override; public APIs use it when present. No verified scoring field changes through moderation.

Each decision and audit insert commit in one database batch. A revision check prevents stale actions, including resolution after a new report. Audit records retain action, fixed category, time, prior revision, prior visibility/name-override presence and open-report count. They do not copy nicknames, replacement text, free-text complaints, tokens or IP hashes. Consequently the log proves a replacement happened but does not retain every superseded replacement string. Restore-name returns to the original, not an arbitrary historic replacement. Audit metadata has no automatic expiry; the existing original name/override share score retention. Legacy visibility requests preserve their bounded private reason, with a fixed audit category (or `other`).

Administrative routes (all bearer-authenticated, no CORS, no-store):

| Route | Purpose |
| --- | --- |
| `GET /api/v1/admin/scores?filter=queue|hidden|all&before=<cursor>&id=<optional exact ID>` | Up to 50 entries, stable row cursor; `next` for another page |
| `GET /api/v1/admin/scores/:id/history` | Aggregated reports and latest 100 decisions |
| `GET /api/v1/admin/audit?before=<cursor>` | 100 decisions, including erasures; `next` cursor |
| `POST /api/v1/admin/scores/:id/moderate` | `{action, category, revision, name?}`; actions `hide`, `restore`, `rename`, `restore_name`, `resolve`, `reopen`; categories `offensive`, `personal_info`, `suspicious_score`, `other`, `appeal` |
| `POST /api/v1/admin/scores/:id/visibility` | Existing `{visible, reason?}` interface, now audited; legacy callers may receive a retryable stale-revision conflict during concurrent moderation |
| `POST /api/v1/admin/scores/:id/delete` | Existing irreversible operator erasure |

All administrative endpoints and the console are absent when `ADMIN_TOKEN` is unset/too short. Authentication uses constant-time comparison of hashes. Failed authentication is throttled per IP; valid credentials are not locked out by another caller's failures. Origin restrictions are defense in depth, not authentication. No cookies or cross-origin browser admin integration are supported.

## Nickname screening and report abuse limits

`server/src/nickname.ts` first applies the existing Unicode/length/character rules. A small English denylist then checks complete tokens, Unicode compatibility/accent folding, common leetspeak, and an entire name split with separators. It never searches arbitrary substrings. Tests allow Scunthorpe, Dickson, Assassin, Fukuda, Shitake and international names. No name, IP or device ban is created. Filter rejection uses the existing `400 invalid_nickname` response before claiming the run: players can correct the name or choose Anonymous and resubmit.

This is deliberately incomplete: it cannot reliably detect all languages, homoglyphs, contextual harassment, disguised personal details or every evasion. Do not describe it as comprehensive profanity/PII detection. Keep human review and in-app reports. Old installed clients retain their local character-only feedback and receive the authoritative server error when submitting. No new client field, rules version, replay schema or consent protocol is required.

Reports accept only `offensive`, `personal_info`, `suspicious_score` or `other`, with a 4 KiB decoded body limit, public-score existence/visibility check, configured origin check, 10 attempts/IP/hour and 1,000 globally/hour. One record per score/salted-IP hash; repeat reports never extend the original 30-day lifetime. Daily cron deletes old open **and resolved** reports. Never use expiry as the review schedule. The cleanup now counts open reports it deletes, and the digest warns 7 days ahead and announces any that expire unreviewed (see [Report retention and review policy](#report-retention-and-review-policy)). Rate limits bound writes, not determined distributed abuse: rotating IPs can exhaust the global report budget; shared networks can share limits/deduplication. There is no identity or ownership proof in a report. Reports never directly affect ranking or visibility.

Device-local blocks remain case-insensitive nickname blocks, with unblock and personal-best name suppression. Shared names affect unrelated people, and changing a nickname evades a block. No stable player identity was added.

## Suspicious scores: actual rules, conservative interpretation

For **frozen rules 1.2.0 only**, maximum asteroid points are `trunc(50 * 1.75 + 20) * 3 = 321`; UFOs pay at most 500. The stored kill counters include non-scoring destruction, so `score > 321 * asteroids_destroyed + 500 * ufos_destroyed` is a conservative impossible-data indicator. The queue also flags negative counts, ticks outside 1-72,000 and duration inconsistent with 60 ticks/second (1 ms tolerance). See the frozen engine and `server/src/moderation.ts`. Tests cover the boundary, a real valid replay, and unknown rules.

Flags are computed for existing and new rows when reading the private queue. They do not rewrite scores, reject an otherwise verified run, hide entries, or accuse a player. These anomalies can indicate data corruption or a server defect. Unknown/future rules are not evaluated by these constants; add a reviewed rule-specific bound when supporting another scoring system. No percentile or arbitrary points-per-second threshold is used. Frozen replay verification remains the primary check. It does not prove a human played: bots can generate valid inputs and wait out elapsed-time checks. Full recordings are not stored, so post-hoc human replay review is unavailable.

## Erasure, cache consistency and release configuration

The public mailbox is **privacy@davidandrea.ca** (confirmed 2026-11-12; it is delivered by the domain's Google Workspace MX). Still establish review responsibility, ownership/context checks and correspondence retention before release. A nickname or public score ID is not ownership proof; shared IPs are not ownership proof either. Ask for minimal contextual evidence and never bulk-delete all records sharing a name or network. No identity documents are needed by this workflow.

After approving a request, use **Erase score and linked records**, typing the full ID to confirm. One transaction writes the deletion event, deletes the score and its actual accepted run, cascades reports and nulls related audit score IDs. Original/override names and token/submission/IP hashes in the linked run disappear. Other scores/runs remain. The retained audit contains only anonymous decision metadata and cannot identify which erased score to remove from a restored backup. Maintain a separately protected, minimal erasure ledger of approved IDs for backup restoration, with a reviewed retention process; do not copy deleted names or IP hashes into it.

Public boards/details and admin responses now send `Cache-Control: no-store`; current frontend reads also bypass browser HTTP caching. No Cache API is used. Existing old-client caches may remain fresh for their former five-second lifetime during rollout. Already displayed screens, offline local records, downloaded copies and screenshots cannot be recalled. Refresh/reopen fetches current server state; there is no push removal from an already open screen.

Before a separately authorized production release (status as of 2026-11-12 in brackets):

- [**Done 2026-11-04**: backup verified, 0003/0004 applied before the Worker.] Back up/rehearse the migration against a disposable copy and review provider restore/retention practices. Apply pending 0003 **and 0004** to the correct `env.production` D1 before deploying this Worker. Do not deploy the code against an unmigrated database. This task ran migrations only with `--local`. [Provider retention review still open.]
- [**Done**: secrets and origins preserved, administration enabled, cron verified indirectly 2026-11-12. **Open**: report review assignment.] Preserve existing `ADMIN_TOKEN`, `IP_HASH_SALT`, origin allowlist and frozen engines. No new secret/service/dependency is needed. Verify administration is enabled, the 07:17 UTC cleanup cron runs, and report review is assigned. Confirm HTTPS to the actual Worker origin. Protect that origin and D1 access through existing account controls.
- Verify Cloudflare Cache Rules do not override `no-store` for `/api/v1/*` or `/admin`. Purge any previously forced edge caches at deployment if such a rule existed; this source checkout cannot verify dashboard rules. Do not promise instant removal from old copies.
- Review Cloudflare observability, logs, D1 Time Travel and exports separately. SQL erasure does not erase provider backups/logs. Reapply approved erasures before serving a restored database.
- Deploy backend before the updated app (new report reason requires it). Rebuild/sync Android assets and test a Play-delivered build. Old challenge/submission/board/detail shapes, default rules and frozen verifier remain unchanged; old report reasons and legacy admin APIs remain supported.

## Daily moderation digest

Implemented 2026-11-12 on `feature/moderation-digest`, integrated (with the expiry carry-forward below) on `release/hull-and-havoc-rc`; **not deployed, not configured, no live email sent.** Code: `server/src/digest.ts` (queue summary, email text, Resend adapter, daily claim) and `server/src/scheduled.ts` (cron order). Migration `0005_moderation_digest.sql` adds one table.

**Behaviour.** The existing daily cron (`17 7 * * *`, 03:17/04:17 Halifax) first runs the unchanged cleanup, then the digest. The digest counts the console's **Needs review** view (the same SQL), so the total matches what `/admin` shows:

- Empty queue and nothing expired: no email.
- Otherwise one email, subject `Hull & Havoc — N moderation items awaiting review` (N = entries in Needs review), containing open reports by reason, entries with reports, unreviewed integrity flags, open reports within 7 days of the 30-day limit, open reports the cleanup just deleted unreviewed, and the console link.
- If the queue is empty but open reports expired that day, the subject is `Hull & Havoc — N unreviewed reports expired`.
- It repeats once per UTC day while anything stays open and stops when the queue is clear.

It contains **no nicknames, score IDs, reporter or IP hashes, tokens or replay data**, and it never hides, renames, resolves, deletes or bans anything.

**Duplicates and failures.**

- *One email per day.* One `moderation_digests` row per UTC day of the cron's `scheduledTime` is claimed atomically. Cloudflare retries, duplicate invocations and manual triggers on the same day are skipped (verified in Vitest and real workerd/D1).
- *Identical retries.* The day's text is stored on first claim, and every attempt resends it with `Idempotency-Key: hull-and-havoc-moderation-digest-YYYY-MM-DD`. Resend keeps keys for 24 hours, which covers every attempt of one UTC day, so a timeout whose request the provider actually accepted is deduplicated rather than sent twice.
- *Not exactly-once.* The D1 row is the reliable local guard; the provider key is the second layer. If every attempt of a day ends ambiguously (timeout, Worker killed mid-send), whether that day's email arrived is unknown. The digest never resends that day under a new key.
- *Outages across days.* An undelivered day (failed, or `sending` past its 10-minute lease) is not retried after its day ends. The next day's digest is composed from the live queue, and it **carries the undelivered days' expired-report counts** (column `expired`), because those reports are already deleted. The earlier rows become `superseded`, so nothing stays pending. An expiry notice is therefore repeated rather than lost when an earlier email did arrive after all.
- *Retry limits.* Transient errors (timeout after 10 s, network, 408/429/5xx, concurrent-idempotency 409) get one immediate retry. A later invocation the same day can retry, up to 3 claims per day; a send abandoned mid-flight is taken over after 10 minutes. Permanent errors (401/403/422, payload-mismatch 409) are not retried that day. Either way the next day's run tries again if items remain, so an outage costs at most 6 API calls a day, and the provider key prevents a second delivery within a day.
- *Isolation.* Digest errors are caught and logged as `{"evt":"moderation_digest","status":...}` with a status/provider error name only; the API key is redacted from any error text. They never stop the cleanup, and the digest does not run on request paths, so gameplay is unaffected. A cleanup failure still lets the digest run, then fails the invocation as before. Ledger rows (counts only) are deleted after 30 days. In the unusual case of a second invocation on a day whose first cleanup had failed, reports deleted after that day's email was sent are logged as `expiredNotAnnounced` rather than emailed.

**Configuration** (all four required; any missing means `disabled`, which touches no digest table):

| Name | Kind | Value |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | Resend API key, *sending access* restricted to the sender domain. Never in Git, `wrangler.toml`, Vite or CI variables. Not added to `secrets.required`, so deploys still work without it. |
| `MODERATION_DIGEST_FROM` | var | Sender on a Resend-verified domain, e.g. `Hull & Havoc <moderation@SUBDOMAIN.davidandrea.ca>`. **Not yet chosen**; commented out in `wrangler.toml`. |
| `MODERATION_DIGEST_TO` | var | `privacy@davidandrea.ca` (set in `[env.production.vars]`). |
| `MODERATION_DASHBOARD_URL` | var | `https://asteroids-leaderboard.davejandrea.workers.dev/admin` (set). |

`RESEND_API_URL` exists only for the local integration test (https or loopback http only). No other dependency, permission or service was added.

**Why Resend.** `davidandrea.ca` uses Cloudflare DNS but Google Workspace MX (public DNS, checked 2026-11-12), so Cloudflare Email Routing's `send_email` binding is not available without moving mail routing. A plain HTTPS API call needs no SDK. No Resend account, domain or key exists in this repository or was verified.

**Activation:** follow the ordered [digest activation runbook](digest-activation-runbook.md) (D1 backup, staged 0005, Resend subdomain DNS, sending-only key, Worker configuration, authorized delivery test, verification, rollback). Every production step there needs separate authorization.

Deploying the code before 0005 is safe: it stays disabled until configured, and if enabled without the table it logs `error` and cleanup continues. Rollback: delete the secret (`wrangler secret delete RESEND_API_KEY --env production`) or roll the Worker back; the table can stay.

**Not covered by tests:** real Resend delivery and its idempotency behaviour, domain verification, Cloudflare's production cron retry behaviour, and mailbox delivery/spam filtering. Tests use an in-process mock sender and a loopback mock HTTP provider under real workerd. Regression tests pin the cleanup-then-digest ordering (a report expiring in the same run's cleanup, empty remaining queue) and the cross-day carry-forward.

## Report retention and review policy

**Finding.** Reports are deleted 30 days after creation, open or not (published in the draft policy and the in-game screen). Before the digest, nothing told the operator a report existed, so an unresolved complaint could expire without ever being seen. The cleanup also logged only a total.

**Implemented (narrow, no retention change):**

- The digest includes a new report in the next day's email and every day after until it is resolved, so it appears about 29 times before expiry.
- Reports in their last 7 days are called out as expiring.
- The cleanup now counts open reports it deletes (`unresolvedReportRows` in the cron log), and the digest announces them, even when the queue is otherwise empty.

The 30-day limit, the deletion of resolved reports, and the reporter data kept are unchanged.

**Residual gaps:**

- Until the digest is configured, expiry is as silent as before.
- A delivery failure on the expiry day no longer loses the notice: the count is carried to the next day's digest. It is lost only if the digest cannot claim a ledger row at all for 30 days (ledger rows are pruned after 30 days), or in the `expiredNotAnnounced` edge case above. Workers Logs are not enabled for this Worker, so the cron log is visible only live (`wrangler tail`).
- The expiry notice gives counts, not which entries (by design). The entries themselves remain public and reviewable in **All entries**.
- If the cleanup cron fails, reports outlive 30 days until it next succeeds (already disclosed as dependent on the job).

**Options (owner decision; A is what is implemented and matches the published text):**

| Option | Effect | Needs |
| --- | --- | --- |
| A. Keep 30 days for all reports, rely on daily digest + 7-day warning + expiry notice | No policy change | Digest activation; a review-time commitment |
| B. Keep unresolved reports past 30 days (e.g. to 60/90) until reviewed | No complaint lost to delay; keeps reporter IP hashes longer | Policy/in-app text change, small code change |
| C. At 30 days, drop the reporter hash but keep an anonymous "unresolved" marker (entry, reason, date) until reviewed | Keeps the review signal without reporter data | Migration, code, policy text ("de-identified after 30 days") |
| D. Additionally delete resolved reports sooner (e.g. 7 days after resolution) | Less retention | Small code change; shortening the text is low-risk |

Recommendation: A now. Choose C if digests prove unreliable in practice. Do not adopt B or C silently: the published retention text must change first.

## Google Play UGC readiness (rechecked 2026-11-12)

The [current Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en) (fetched 2026-11-12) requires users to accept terms/user policy before creating UGC, defined and prohibited objectionable content, "an in-app system for reporting and blocking objectionable UGC and users", and moderation that is "robust, effective, and ongoing". It names apps that "continually fail to address user complaints" as violations. It sets **no response time** and no account requirement. Blocking is called for in apps with one-to-one interaction and in public UGC apps. Implementation is not proof of Play approval; **compliance has not been established.**

| | Item | Status |
| --- | --- | --- |
| 1. Implemented | Prohibited-content rules | In-game LEADERBOARD RULES page and the draft policy's rules section |
| | Acceptance before submission | Rules/disclosure beside Submit; "By submitting a score you accept these rules". Submit-as-acceptance, no separate control or server receipt |
| | Automatic nickname screening | Server, before a run is claimed; narrow English whole-token denylist; not comprehensive |
| | In-app reporting | HIGH SCORES > REPORT / BLOCK, fixed reasons, rate-limited, never auto-hides |
| | Blocking | Device-local nickname block/unblock (no accounts) |
| | Review and corrective actions | `/admin`: replace name, hide/restore, resolve/reopen, erase; audited, revision-guarded |
| | Removal and appeals | Contact `privacy@davidandrea.ca` in-game and in the draft; erasure procedure above |
| | Operational response | Daily digest **implemented but not active**; becomes the response trigger once configured |
| 2. Small engineering changes | Activate the digest | Configuration only (above) |
| | Explicit acceptance | An "Accept rules & submit" label or a one-time checkbox before the first ranked submission; client-only, no server change |
| | Appeal wording | Done: the contact line now says "removal, appeal, privacy or security" |
| 3. Owner policy decisions | Review commitment | E.g. queue cleared within 2-3 days of a digest, with cover while away |
| | Report retention | Option A-D above |
| | Acceptance | Whether submit-as-acceptance is enough, or add the explicit control |
| | Mailbox | Handling and retention of removal/appeal correspondence |
| | Audience and rating | Target ages and content-rating answers (the questionnaire asks about user interaction/UGC) |
| | Policy approval | Approve and host the policy; the contact being filled in does not approve it |
| 4. Uncertain | Blocking without accounts | Whether name-based blocking satisfies "blocking ... users": names are shared and changeable |
| | Ongoing moderation | Whether "robust, effective, and ongoing" is met depends on actual responsiveness, not on code |
| | Screening coverage | Non-English, homoglyph and contextual abuse |
| | Earlier exposure | Web builds already exposed the draft screen without a contact |

No incidental-sexual-content exception or Families compliance is claimed. If Play review rejects the accountless interpretation, reassess preset names or identity explicitly rather than asserting compliance.

## Verification

**Live since 2026-11-04 18:32 UTC** (Worker version `c2aef78f`; [Stage 2 record](release-preflight.md#stage-2-production-worker-deployment-2026-11-04)). Production `/admin` is reachable at the Worker origin. Authenticated read-only checks show an empty queue and audit log. No production moderation decision has been made yet. The initial review of existing names (workflow step 2) is still to do.

Production preparation at committed HEAD `f540caf` is documented in the [release preflight/runbook](release-preflight.md): staged migration commands, backup/recovery, historical-client compatibility, configuration checklist and stop/go gates. The earlier implementation-pass statements above are historical; this follow-up verified the code is committed and ran only local mutation tests plus a public production health GET. No production migration/deployment/backup/restore was performed.

See [release validation](play-release-validation.md) for results. Reproduce from `phaser-asteroids`: full Vitest, server typecheck, production build, `test:worker`, `test:ranked:ui`, `test:menu`, and `test:moderation:admin`. The last runs real Chromium against a disposable local Worker/D1 and covers login, report review, name replacement/restoration, hide/restore, resolution/reopening, history, erasure, unrelated-row preservation, lock/reload and responsive layout. Screenshots are under ignored `scripts/.smoke-output/moderation-admin-*.png`. Nothing in these tests targets production.
