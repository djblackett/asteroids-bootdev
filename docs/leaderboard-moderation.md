# Leaderboard moderation: audit and operator guide

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
2. The **Needs review** view lists reported entries and unreviewed integrity flags, 50 at a time. Review all pages routinely (recommended daily while testing; establish sustainable coverage before release). **All entries**, **Hidden entries**, and exact score-ID lookup support proactive review, appeals and restoration. Do an initial review of existing names: the new filter does not rewrite historical data.
3. Open **Reports / decision history**. The console shows grouped reasons/counts, timestamps, original/current names, rules, score, duration and kill counts. It never reveals reporter/issuer IP hashes, run tokens or full submissions. Reports describe allegations; multiple reports are not proof.
4. Choose the decision category. For an offensive name on a legitimate run, use **Replace name** (default Anonymous). The original nickname remains private in D1; score/rank inputs stay unchanged. Use **Hide** when the entry itself needs removal from public view. Use **Restore score** and **Restore original name** independently after review. Original-name restoration intentionally permits reversal of a false positive and can republish offensive content; review before confirming.
5. **Resolve reports / flag** closes the current complaints and acknowledges the integrity flag. Name/visibility changes do not silently resolve reports. **Reopen review** reverses resolution. New reports or changed open-report categories advance the revision; a stale decision fails with 409 and requires Refresh. Identical repeats do not invalidate a snapshot, and the same reporter cannot reopen an already resolved report. A different reporter can submit a new complaint.
6. The **Audit log** pages through every decision, including anonymized erasures. Per-entry history shows the newest 100. Lock when finished. The token is only held in tab memory, cleared on reload/navigation/lock and after 15 minutes without console actions. The shell is public when enabled, but contains no private data or credentials. CSP, text-only DOM rendering, no third-party resources, no framing and no referrer forwarding protect the console.

This is usable for a solo operator without routine SQL. There are **no notifications, automatic review staffing, multiple-admin identities, or appeal messaging**. The shared admin secret identifies the authorized operator role, not an individually authenticated staff member. Use the external support/removal contact for appeals. Direct privileged D1 changes bypass the application audit and should be exceptional. The log is not cryptographically tamper-proof against a database administrator.

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

Reports accept only `offensive`, `personal_info`, `suspicious_score` or `other`, with a 4 KiB decoded body limit, public-score existence/visibility check, configured origin check, 10 attempts/IP/hour and 1,000 globally/hour. One record per score/salted-IP hash; repeat reports never extend the original 30-day lifetime. Daily cron deletes old open **and resolved** reports. Never use expiry as the review schedule. Rate limits bound writes, not determined distributed abuse: rotating IPs can exhaust the global report budget; shared networks can share limits/deduplication. There is no identity or ownership proof in a report. Reports never directly affect ranking or visibility.

Device-local blocks remain case-insensitive nickname blocks, with unblock and personal-best name suppression. Shared names affect unrelated people, and changing a nickname evades a block. No stable player identity was added.

## Suspicious scores: actual rules, conservative interpretation

For **frozen rules 1.2.0 only**, maximum asteroid points are `trunc(50 * 1.75 + 20) * 3 = 321`; UFOs pay at most 500. The stored kill counters include non-scoring destruction, so `score > 321 * asteroids_destroyed + 500 * ufos_destroyed` is a conservative impossible-data indicator. The queue also flags negative counts, ticks outside 1-72,000 and duration inconsistent with 60 ticks/second (1 ms tolerance). See the frozen engine and `server/src/moderation.ts`. Tests cover the boundary, a real valid replay, and unknown rules.

Flags are computed for existing and new rows when reading the private queue. They do not rewrite scores, reject an otherwise verified run, hide entries, or accuse a player. These anomalies can indicate data corruption or a server defect. Unknown/future rules are not evaluated by these constants; add a reviewed rule-specific bound when supporting another scoring system. No percentile or arbitrary points-per-second threshold is used. Frozen replay verification remains the primary check. It does not prove a human played: bots can generate valid inputs and wait out elapsed-time checks. Full recordings are not stored, so post-hoc human replay review is unavailable.

## Erasure, cache consistency and release configuration

Establish the public mailbox, review responsibility, ownership/context checks and correspondence retention before release. A nickname or public score ID is not ownership proof; shared IPs are not ownership proof either. Ask for minimal contextual evidence and never bulk-delete all records sharing a name or network. No identity documents are needed by this workflow.

After approving a request, use **Erase score and linked records**, typing the full ID to confirm. One transaction writes the deletion event, deletes the score and its actual accepted run, cascades reports and nulls related audit score IDs. Original/override names and token/submission/IP hashes in the linked run disappear. Other scores/runs remain. The retained audit contains only anonymous decision metadata and cannot identify which erased score to remove from a restored backup. Maintain a separately protected, minimal erasure ledger of approved IDs for backup restoration, with a reviewed retention process; do not copy deleted names or IP hashes into it.

Public boards/details and admin responses now send `Cache-Control: no-store`; current frontend reads also bypass browser HTTP caching. No Cache API is used. Existing old-client caches may remain fresh for their former five-second lifetime during rollout. Already displayed screens, offline local records, downloaded copies and screenshots cannot be recalled. Refresh/reopen fetches current server state; there is no push removal from an already open screen.

Before a separately authorized production release:

- Back up/rehearse the migration against a disposable copy and review provider restore/retention practices. Apply pending 0003 **and 0004** to the correct `env.production` D1 before deploying this Worker. Do not deploy the code against an unmigrated database. This task ran migrations only with `--local`.
- Preserve existing `ADMIN_TOKEN`, `IP_HASH_SALT`, origin allowlist and frozen engines. No new secret/service/dependency is needed. Verify administration is enabled, the 07:17 UTC cleanup cron runs, and report review is assigned. Confirm HTTPS to the actual Worker origin. Protect that origin and D1 access through existing account controls.
- Verify Cloudflare Cache Rules do not override `no-store` for `/api/v1/*` or `/admin`. Purge any previously forced edge caches at deployment if such a rule existed; this source checkout cannot verify dashboard rules. Do not promise instant removal from old copies.
- Review Cloudflare observability, logs, D1 Time Travel and exports separately. SQL erasure does not erase provider backups/logs. Reapply approved erasures before serving a restored database.
- Deploy backend before the updated app (new report reason requires it). Rebuild/sync Android assets and test a Play-delivered build. Old challenge/submission/board/detail shapes, default rules and frozen verifier remain unchanged; old report reasons and legacy admin APIs remain supported.

## Google Play UGC review

The [current Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en), checked 2026-11-04, calls for acceptance before upload, prohibited-content rules, ongoing moderation, and in-app reporting/blocking appropriate to public UGC. Implementation is not proof of Play approval.

Demonstrable locally: rules/disclosure beside Submit and in Privacy/Rules; the Submit action is presented as acceptance; prohibited-name rules; in-app reporting and nickname blocking; server screening; authenticated review and corrective actions. There is no in-app monetization encouraging abusive content.

Still requires interpretation/external evidence: whether submit-as-acceptance is sufficient for this UX and historical installed builds; whether blocking a mutable, shared nickname satisfies user blocking without accounts; target ages/content rating and any applicable child-safety obligations; actual timely moderation, deployed availability, support contact, published privacy policy and provider handling. There is no server-side acceptance receipt. No incidental-sexual-content exception or Families compliance is claimed. Confirm the accountless interpretation with Play review/support; if rejected, reassess identity or freeform names explicitly rather than silently asserting compliance.

## Verification

Production preparation at committed HEAD `f540caf` is documented in the [release preflight/runbook](release-preflight.md): staged migration commands, backup/recovery, historical-client compatibility, configuration checklist and stop/go gates. The earlier implementation-pass statements above are historical; this follow-up verified the code is committed and ran only local mutation tests plus a public production health GET. No production migration/deployment/backup/restore was performed.

See [release validation](play-release-validation.md) for results. Reproduce from `phaser-asteroids`: full Vitest, server typecheck, production build, `test:worker`, `test:ranked:ui`, `test:menu`, and `test:moderation:admin`. The last runs real Chromium against a disposable local Worker/D1 and covers login, report review, name replacement/restoration, hide/restore, resolution/reopening, history, erasure, unrelated-row preservation, lock/reload and responsive layout. Screenshots are under ignored `scripts/.smoke-output/moderation-admin-*.png`. Nothing in these tests targets production.
