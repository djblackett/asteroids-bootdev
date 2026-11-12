# Hull & Havoc privacy policy: publication record

Prepared 2026-11-12 on branch `feature/privacy-policy-page`. **Not published. Not approved.** Nothing was pushed, merged, deployed or uploaded.

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

**Deliberately not in the page:** the daily moderation digest. It is uncommitted work on `feature/moderation-digest`, not deployed (`MODERATION_DIGEST_FROM` and the Resend key are unset), so it is not described as operating. It sends the operator counts only, no player data; add a line only if you want to name the email provider.

## Unresolved: need your decision before publishing

1. **Mailbox handling.** The page says correspondence stays in the email provider's mailbox with no fixed deletion period. Confirm that is true and acceptable, or set a period.
2. **Provider retention.** The page makes no Cloudflare retention promise. Optionally verify D1 Time Travel and Workers Logs settings for this account (see the inventory) and state real periods.
3. **Effective date.** The page says "Last updated 12 November 2026". Change the date (and the `datetime` attribute) on the day you approve.
4. **Audience / children.** No age statement is made because the target audience and content rating are undecided. Play will require this, and the policy may need a matching sentence.
5. **Legal rights text.** No jurisdiction-specific rights (Canada/PIPEDA, EU/UK GDPR, CCPA) or response times are stated. Decide whether your location and audience need them.
6. **Google Play.** Not checked against live Console requirements (offline session). Confirm the Data safety answers, that the URL is public and non-PDF, and that the policy identifies the developer/app name as shown in the listing. Rebuild the APK and remove the offline DRAFT marker (privacy.ts and `inspect-android-release.ps1` markers) only after approval.

## Merge notes

`docs/privacy-policy-draft.md`, `privacy.ts` and `google-play-release.md` also have uncommitted edits in the main worktree (`feature/moderation-digest`). `privacy.ts` here already contains the same contact/wording edits, so they should merge cleanly. Merge the digest branch first, then this one.

## Publishing (after your explicit approval)

1. Review `public/privacy/index.html`; resolve the questions above; update the date.
2. Remove nothing from the offline screens yet unless approving for distribution; if approving, drop the DRAFT marker in `privacy.ts` and the matching marker in `scripts/inspect-android-release.ps1` plus `tests/androidRelease.test.ts` expectations.
3. Open a PR into `main`. CI validates (typecheck, tests, build, `pages-check`).
4. Merge. The workflow deploys the Worker first, then GitHub Pages, so follow the release preflight (migrations/secrets) before merging.
5. Open the URL in a private window. Enter it in Play Console.
