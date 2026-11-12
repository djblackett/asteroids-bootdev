# Hull & Havoc privacy policy — review draft

**Not approved for publication or distribution.** Public contact, provider retention and final game name require review. Package: `ca.davidandrea.spacearcade`. Proposed effective date: set on approval.

**Deployment status (2026-11-12):** the reporting, operator moderation (name replacement, hide/restore, report resolution, audit history) and erasure functions this draft describes have been live in the production leaderboard service since 2026-11-04 (Worker version `c2aef78f`; [Stage 2 record](release-preflight.md#stage-2-production-worker-deployment-2026-11-04)). The policy text itself is **still an unapproved draft**: the public web build and any test APK show the bundled Privacy screen marked `DRAFT PRIVACY POLICY - REVIEW PENDING` with `[PRIVACY CONTACT PENDING]`. Deployment of these features does not approve this text, the contact, or the retention statements below.

Operator: **David Andrea** (confirmed 2026-11-04). Privacy, security and removal contact: **[PUBLIC EMAIL PENDING]**.

**Deferred follow-up — 2026-11-04:** David will choose the public address for privacy, security, leaderboard removal and moderation requests later. Keep the contact placeholders until that decision is made, then update this draft and `phaser-asteroids/src/ui/menu/pages/privacy.ts`. Confirm mailbox handling and retention before distribution; no address has been selected or invented.

Asteroids is a game without user accounts, advertising or analytics SDKs. You can play Practice without uploading gameplay. Menus may contact the online service to retrieve public scores and refresh scores previously saved on your device.

Ranked play requests a server-issued challenge. If you choose to submit your result, the game sends your nickname, gameplay replay (changes in movement, aiming and action controls), game/rules versions, configuration, timing, claimed result and control category. We use this to independently verify scores, operate the leaderboard and prevent cheating or abuse. Full replay submissions are processed in memory; we retain a hash of the submission, verified score and associated run metadata rather than the full replay.

Submitting a score makes its nickname, score, completion date, simulated duration, rules version, ending reason and score identifier publicly accessible. Use a nickname that does not reveal personal information. Other people may copy public entries; we cannot remove their copies.

Cloudflare hosts our API and D1 database and processes network requests, including IP addresses and ordinary request metadata. Our application database stores a salted hash derived from an IP address for rate limiting and abuse handling, rather than the raw IP address. Hashes are pseudonymous, not guaranteed anonymous. Cloudflare may process technical data to operate and secure its services. We do not sell your data or use it for advertising. Review Cloudflare's [privacy policy](https://www.cloudflare.com/privacypolicy/).

Accepted leaderboard entries and linked run records have no automatic deletion date, including entries hidden by moderators. Daily cleanup deletes abandoned challenges more than one day after their expiry, rejected runs more than 30 days after rejection, and request counters whose hourly window started more than two hours ago. Expiry of a challenge (normally one hour) limits submission; it is not immediate deletion. Cleanup depends on the scheduled job running successfully.

Reports contain the reported score identifier, a selected reason, a salted IP hash, a timestamp and review status. They are private to the operator and used for moderation. Reports are deleted after 30 days by daily cleanup, or when the associated score is erased. Moderation decisions retain a fixed action/category, time, score link and prior moderation state without copying names or reporter identifiers. These records have no automatic expiry; erasure removes their link to the deleted score. **Provider-retention review pending:** D1 recovery history and Cloudflare logs can retain information separately from the live database. Confirm the account's actual settings, recovery period, exports and other provider retention before publishing this paragraph. Do not promise immediate removal from backups.

The game stores audio, input, movement and vibration preferences, the last accepted nickname, up to 20 accepted scores with identifiers, and blocked nicknames locally on your device. There is no timed expiry. Clear the app's storage in Android settings (or site data in a browser) to remove this local data. This does not remove server records. Android backup is disabled in the manifest; device-transfer behavior may depend on the device vendor.

For removal of a leaderboard entry or associated run data, or for privacy or security questions, email **[PUBLIC EMAIL PENDING]** with the score identifier if available, nickname, score and approximate date. We may ask for context to avoid deleting someone else's entry. There is no account or account-deletion flow. Removal is handled by the operator; hiding a score is not erasure. Short-lived abuse counters and provider-controlled records follow their respective retention. Requests sent by email also disclose your email address and any information you include; use only the information necessary for the request. **Before publication, specify how the chosen mailbox provider and request correspondence are handled and retained.**

From High Scores, choose Report / Block to report an abusive nickname or hide entries using that nickname on your device. Nicknames are not unique accounts: blocking also hides other people using the same name and cannot follow someone who changes names.

App-to-service traffic uses HTTPS. Administration requires a secret credential. No transmission or storage system can be guaranteed completely secure. We will update this policy when our practices change; publish the revision date with the approved policy.

## Leaderboard rules

By submitting, you accept public display and these rules. Do not use hateful, sexual, threatening or harassing nicknames, impersonate others, or expose personal information. We may replace displayed nicknames, hide or remove entries that violate these rules. A replacement keeps the verified score intact; the original name remains private until the entry is erased. Reports are reviewed by the operator; submitting a report does not automatically remove an entry.

## Hosting proposal (not deployed)

**Decision (2026-11-12):** host the policy on the existing GitHub Pages site at `https://djblackett.github.io/asteroids-bootdev/privacy/`. The page is prepared, unpublished, at `phaser-asteroids/public/privacy/index.html`; its facts, open questions and the publish steps are in [privacy-policy-publication.md](privacy-policy-publication.md). Final name: **Hull & Havoc** (Android package ID unchanged). The URL must work without login, geo restrictions or downloading a PDF. Keep the operator/contact and app identity consistent with Play Console. The page now lives in `public/`, so merging it to `main` publishes it on the next release run: merge only after approval.

The game now includes an offline, paginated PRIVACY menu plus Privacy / Leaderboard Rules before score submission. Before distribution, replace review placeholders and keep its text synchronized with the approved public policy. A remote policy link can be added after its URL is approved; offline access remains useful on phones.
