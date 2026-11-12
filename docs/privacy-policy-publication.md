# Hull & Havoc privacy policy: publication record

Prepared 2026-11-12 on branch `feature/privacy-policy-page`; integrated into `release/hull-and-havoc-rc` the same day; wording and in-game access revised on `feature/privacy-play-ux` (see [Review remediation](#review-remediation-2026-11-12)). **Not published. Not approved.** Nothing was pushed, merged, deployed or uploaded.

- Public page source: `phaser-asteroids/public/privacy/index.html` (standalone, no scripts or third-party resources; Vite copies `public/` unchanged to `dist/privacy/index.html`).
- Proposed URL: `https://djblackett.github.io/asteroids-bootdev/privacy/`
- Contact: `privacy@davidandrea.ca`. Name: Hull & Havoc. Package ID: `ca.davidandrea.spacearcade` (unchanged).
- Offline copy: `phaser-asteroids/src/ui/menu/pages/privacy.ts` (still carries the `DRAFT PRIVACY POLICY - REVIEW PENDING` marker, so the signed-release inspector keeps refusing it; it now also shows the URL above).
- Guards: `tests/privacyPage.test.ts` (content, no placeholders/secrets/external resources) and `scripts/pages-check.mjs` check 4 (served at `/asteroids-bootdev/privacy/` and `/privacy/`).

## Fact check (page statement → evidence)

| Statement | Evidence |
| --- | --- |
| Retention: abandoned challenges 1 day after expiry, rejected runs 30 days, counters >2 h, reports 30 days | `server/src/runs.ts` (`pruneStaleRuns`), `moderation.ts` (`pruneReports`), `ratelimit.ts`; cron `17 7 * * *` in `wrangler.toml`; production cron success verified 2026-11-12 per release docs |
| Scores kept indefinitely | Owner decision 2026-11-12; no delete path for accepted scores in the cron |
| Nickname screening is a short English word list | `server/src/nickname.ts` |
| Public fields; private fields | `docs/play-data-inventory.md`, `server/src/leaderboard.ts` |
| Hash is salted SHA-256 prefix, same salt, links entries | `server/src/router.ts`, `config.ts` per inventory |
| Local storage contents; backup disabled | inventory; Android manifest/`data_extraction_rules.xml` |
| Reports: fixed reason, no free text, IP hash, private | `migrations 0003/0004`, `moderation.ts` |
| Moderation actions, audit without names | migration 0004, `moderation.ts` |
| Moderation features live in production | Stage 2 record in `release-preflight.md` (Worker `c2aef78f`, 2026-11-04) |

**Deliberately not in the page:** the daily moderation digest. It is on the release candidate but not deployed (`MODERATION_DIGEST_FROM` and the Resend key are unset), so it is not described as operating. It sends the operator counts only, no player data; add a line only if you want to name the email provider.

## Unresolved: need your decision before publishing

1. **Mailbox handling.** The page says correspondence stays in the email provider's mailbox with no fixed deletion period. Confirm that is true and acceptable, or set a period.
2. **Provider retention.** The page makes no Cloudflare retention promise. Optionally verify D1 Time Travel and Workers Logs settings for this account (see the inventory) and state real periods.
3. **Effective date.** The page still says "Last updated 12 November 2026" (the preparation date; source edits do not change it). Follow the [date procedure](#approval-and-publication-date-procedure).
4. **Audience / children.** No age statement is made because the target audience and content rating are undecided. Play will require this, and the policy may need a matching sentence.
5. **Legal rights text.** No jurisdiction-specific rights (Canada/PIPEDA, EU/UK GDPR, CCPA) or response times are stated. Decide whether your location and audience need them.
6. **Google Play.** Not checked against live Console requirements (offline session). Confirm the Data safety answers, that the URL is public and non-PDF, and that the policy identifies the developer/app name as shown in the listing. Rebuild the APK and remove the offline DRAFT marker (privacy.ts and `inspect-android-release.ps1` markers) only after approval.

## Merge notes

Merged into `release/hull-and-havoc-rc` after the digest commits, without conflicts. The offline screen's retention line about provider logs was aligned with the page ("Cloudflare logs and backups follow their own retention periods"); the DRAFT marker is unchanged.

## Additional wording for your review (release-candidate check, 2026-11-12)

7. ~~Review commitment~~: **resolved in wording** (A below). Still yours to decide: whether to publish a review target (for example "within a few days of a report"); none is stated.
8. ~~"Kept indefinitely by default"~~: **purpose added** (D below). Still yours: whether EU/UK users need more (see item 5).
9. ~~Rules acceptance~~: **explicit control implemented** (below). Still yours: whether it is enough for Play without a stored acceptance record.
10. **Operator identity.** The page names "David Andrea" as operator and gives no postal address. Play does not require an address in the policy, but Play's developer account may display one; keep the names consistent.

## Review remediation (2026-11-12)

Branch `feature/privacy-play-ux` from `release/hull-and-havoc-rc` (`d06ad4c`). Client-only; no Worker, D1, migration, digest, gameplay, scoring, replay or Android-identity change. The policy is still **not approved** and the DRAFT gate is unchanged.

### Exact wording changes

| | Public page (`public/privacy/index.html`) | Offline screens (`privacy.ts`) |
| --- | --- | --- |
| A. Moderation | "Reports are private and are reviewed by the operator." → "Reports are private and go only to the operator." plus a new paragraph: "A person (the operator) reviews reports and flagged scores when they need attention. The leaderboard is not monitored continuously or in real time, so there can be a delay before anything is reviewed, and a report can reach its 30-day retention limit before it has been looked at. Sending a report does not automatically hide or remove anything; only the operator can change an entry." Screening sentence now says names are screened "before a score is accepted". | Rules page: "Reports go privately to the operator for review; they do not auto-hide scores." → "Names are screened automatically. Reports are private and never auto-hide; / the operator reviews them when needed, not continuously or instantly." The two blocking lines were merged into "Block hides that name on this device only; it cannot follow name changes." |
| B. Practice | Summary: "without uploading anything" → "without uploading gameplay or submitting a score". The *Playing without going online* paragraph (menus may still contact the service) is unchanged. | "Practice does not upload gameplay." → "Practice uploads no gameplay and submits no score. Menus may fetch public scores." |
| C. Requests | Heading "Removal requests, appeals and questions" → "Your requests: removal, access, correction and questions", with a list: removal; what information we hold / a copy; correction where inaccurate and applicable; appeal; how long information is kept or how it is used. New limits: "Because there are no accounts and nicknames are not unique, we can only find entries from the details you give us, and we may not be able to confirm that an entry is yours. We may ask for more context before acting, so that we do not disclose, change or remove someone else's entry, and we may be unable to complete a request if we cannot reasonably identify the information." | "Email to ask for removal, access, correction, an appeal, or how data is used:" and "With no accounts and shared nicknames we may not be able to tell which / entries are yours, so we may ask for context or be unable to act." |
| D. Retention | Scores row adds: "We keep verified scores and the run records linked to them to preserve the leaderboard's history and integrity, and so that results can be checked again later." No retention period changed; no claim that every field is needed forever. | "…no automatic expiry, even if hidden, / to keep the leaderboard's history and let results be checked later." |
| Rules | "By submitting a score you accept…" → "Before a score is submitted, the game shows a summary of these rules with a link to the full text, and you submit by choosing **Accept rules & submit**. Doing so means you accept public display of the entry and these rules. You can always skip submitting instead." | "Before each submission you choose ACCEPT RULES & SUBMIT: that accepts / these rules and the public display of your nickname and score." |

Unchanged (pinned by `tests/privacyPage.test.ts`): Cloudflare infrastructure, salted IP hash, in-memory replay verification, report contents and 30-day retention, device-local blocking, provider backups/logs, public fields, operator and contact, name, package ID, date. The review draft `privacy-policy-draft.md` received the matching rules/review/Practice sentences and now marks the digest as not yet deployed.

### Full policy in the game

- Every offline privacy page has **VIEW FULL POLICY** between BACK and NEXT. It opens `PRIVACY_POLICY_URL` (`https://djblackett.github.io/asteroids-bootdev/privacy/`, defined once in `privacy.ts`; a test checks every copy of the address in the code and these docs). The summary pages still work without a network.
- Browser: `window.open(url, '_blank')`, then the new tab's `opener` is cleared. If the browser blocks it, the page says so and shows the address.
- Android app: a plain navigation. Capacitor's WebView hands any URL outside the app's own host to the system browser (Android `ACTION_VIEW`) and cancels the load, so the game page stays (verified in `@capacitor/android`'s `Bridge.launchIntent`). No plugin, dependency, permission or native change. Capacitor cannot report "no browser installed", so the page always shows the address and "needs internet" after the tap.
- Code: `src/platform/openExternal.ts` (https only), `src/ui/menu/pages/privacy.ts`.

### Rules acceptance

- The result page's submit button is now **ACCEPT RULES & SUBMIT** (keyboard hint ENTER), beside SKIP. Beneath it: "SUBMITTING MAKES YOUR NICKNAME AND SCORE PUBLIC." and a one-line rules summary ("RULES: NO HATEFUL, SEXUAL, THREATENING OR HARASSING NAMES, IMPERSONATION OR PERSONAL INFO."). **LEADERBOARD RULES** opens the full rules page directly; BACK returns with the typed name kept. **PRIVACY** opens page 1.
- On touch screens the phone keyboard's Done key now only closes the keyboard; it no longer submits. On a keyboard, Enter remains the labelled shortcut of the accept button. Controllers press the same button.
- Asked on every submission, so nothing is stored: no consent table, no local flag, no API change. Practice and Skip need no acceptance.
- Code: `src/ui/menu/pages/rankedResult.ts`, one callback in `src/scenes/GameScene.ts`.

### Tests (this branch)

All local; the policy site was stubbed in the browser tests, and no production data or real email was involved.

| Check | Result |
| --- | --- |
| Focused unit tests (`privacyPage`, `openExternal`, `androidRelease`, `branding`) | 31/31 (privacy page 13: wording A-D, rules, unchanged facts, page length, one canonical URL) |
| Full Vitest | 72 files / 1,718 tests passed |
| Frontend typecheck + production build | pass |
| Android build guards | 8/8 |
| Menus (`scripts/menu.mjs`) | 139/139, incl. 12 new: VIEW FULL POLICY on all 4 pages; mouse, Enter, phone tap and controller (D-pad + A) open the canonical URL in a new tab with no opener link; blocked tab shows the address; layout review of every privacy page at 5 phone + 5 desktop sizes |
| Ranked result UI (`scripts/ranked-ui.mjs`, local Worker + D1) | 106/106, incl. 7 new: ACCEPT RULES & SUBMIT with ENTER hint, rules summary, LEADERBOARD RULES → rules page → BACK keeps the name with nothing sent, phone Done key sends nothing, touch submission still verified; 44 CSS px and overlap checks at phone sizes |
| GitHub Pages subpath (`scripts/pages-check.mjs`) | 35/35 |
| Client bundle | no Resend/digest/admin-secret strings; the DRAFT marker is present, so the signed-release inspector still refuses it |

**Untested:** the Android hand-off on a real device or emulator (verified from the Capacitor source and a unit test only), a phone with no browser installed, real screen readers, and a physical controller (simulated `navigator.getGamepads`).

### Approval and publication-date procedure

1. Do not change the "Last updated" date while the text is under review. It records when the text was prepared.
2. On the day you approve, in **one commit**: set both the visible date and `<time datetime="YYYY-MM-DD">` in `public/privacy/index.html` to the approval date, and remove the `DRAFT PRIVACY POLICY - REVIEW PENDING` line from `privacy.ts`. **Keep** the inspector's marker list (`scripts/inspect-android-release.ps1`): it still refuses any build that reintroduces the marker, and `tests/androidRelease.test.ts` passes with no marker present.
3. The page becomes public when that commit reaches `main` (Pages deploy). If publication happens on a later day than approval, use the publication day instead, so the date never precedes public availability.
4. Later changes: update the date only when the published meaning changes, in the same commit as the change.

## Remaining decisions (owner)

Technical issues raised in review are resolved above. What is left is yours:

1. Approve the policy text (items 1-6 and 10 above; 7-9 are reduced to the residual questions noted).
2. Whether to publish a review target, and the report-retention option (A, 30 days, is implemented).
3. Mailbox retention for privacy correspondence (item 1).
4. Target audience / content rating, and whether jurisdiction-specific rights text is needed (items 4-5).
5. Whether the per-submission ACCEPT RULES & SUBMIT control is sufficient for Play, or a stored acceptance record is wanted (not implemented, by design).

## Publishing (after your explicit approval)

1. Review `public/privacy/index.html` and resolve the decisions above.
2. Follow the [date procedure](#approval-and-publication-date-procedure): one commit sets the date and removes the DRAFT line from `privacy.ts`; the inspector's marker list stays.
3. Open a PR into `main`. CI validates (typecheck, tests, build, `pages-check`).
4. Merge. The workflow deploys the Worker first, then GitHub Pages, so follow the release preflight (migrations/secrets) before merging.
5. Open the URL in a private window. Enter it in Play Console.
