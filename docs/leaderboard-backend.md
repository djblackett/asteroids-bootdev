# Phaser Asteroids — Secure Online Leaderboard Backend (Phase 2)

> **Status:** Implemented and tested locally (Node + real workerd/D1 runtime + real Chromium). **Not deployed.** Nothing in this repository talks to a Cloudflare account.
> **Code:** `phaser-asteroids/server/` (backend), `phaser-asteroids/src/ranked/` (browser client), builds on `phaser-asteroids/src/replay/` (Phase 1, see [deterministic-replay.md](deterministic-replay.md)).

The single security rule: **no score enters the public leaderboard unless the server independently reproduces it from a ranked run the server itself issued.** The browser never sends a score; it sends the inputs it played, and the server replays them with the same deterministic engine.

---

## 1. Architecture

```
 Browser (GitHub Pages)                       Cloudflare Worker  +  D1 (SQLite)
 ──────────────────────                       ─────────────────────────────────
 ?ranked  ── POST /api/v1/runs ─────────────► issue run: id, secret token, random seed,
                                              rules version, approved config, expiry   ──► runs (status=issued)
 ◄─────────── 201 {runId, token, seed, …} ───
 play locally with the server's seed/config
 (60 Hz fixed step, records input changes)
 game over
          ── POST /runs/:id/submit ─────────► rate limit → check token → read bounded body → claim run
             Bearer token, gzip replay         (issued→verifying) → verifyReplay() → finalize
                                               accepted: INSERT scores + UPDATE runs (one atomic batch)
 ◄──────────── 200 {score, ranks} ───────────  rejected: runs.status=rejected (terminal)
 GET /api/v1/leaderboard/all-time|weekly ───► read-only, top N, bounded paging
```

Layers, from portable to provider-specific:

| Layer | Files (`server/src/`) | Knows about Cloudflare? |
| --- | --- | --- |
| Replay engine (Phase 1, unchanged) | `../../src/replay/*`, `../../src/core/*` | No |
| Ranked verification policy | `verify.ts` | No |
| Run lifecycle, ranking, nicknames, weeks, rate limits | `runs.ts`, `leaderboard.ts`, `nickname.ts`, `week.ts`, `ratelimit.ts`, `body.ts` | No (SQL goes through the `Db` interface in `db.ts`) |
| HTTP routing (`Request` → `Response`) | `router.ts` | No (Web-standard types only) |
| Cloudflare glue | `worker.ts`, `d1.ts`, `wrangler.toml` | **Yes** — about 60 lines |

Moving to another host means writing a new `Db` adapter (the unit tests already do this for `node:sqlite`) and a new entry point.

There is **one** replay engine. The Worker bundles the same `verifyReplay()` the browser tests use; `scripts/bench-workerd.mjs` confirms it produces bit-identical scores inside workerd.

## 2. Hosting strategy and justification

**Chosen: Cloudflare Workers (Paid plan) + D1.** Synchronous verification inside the submit request; no queues, Durable Objects, R2 or Redis.

Verified against Cloudflare's current documentation (fetched 2026-10-22):

| | Workers Free | Workers Paid |
| --- | --- | --- |
| CPU time per HTTP request | **10 ms** | 30 s default, configurable to 5 min |
| Memory per isolate | 128 MB | 128 MB |
| Price | $0 | **US$5 / month** (10 M requests and 30 M CPU-ms included; then $0.30 / M requests, $0.02 / M CPU-ms) |
| D1 | 5 GB, 5 M rows read/day, 100 k rows written/day | 5 GB, 25 B reads/month, 50 M writes/month included |

**Free plan is not viable:** replay verification costs 50–250 ms of CPU, 5–25× the 10 ms cap. D1 itself would have been fine on Free; the Worker CPU limit is the blocker. The implementation therefore targets **Workers Paid. It is not activated; that needs your approval and your account.**

### Measured: the verifier inside the Workers runtime

`npm run bench:workerd` runs the real `verifyReplay()` in workerd (`wrangler dev --local`) and times whole requests from outside the isolate (in-isolate clocks do not advance during CPU work). Windows x64, Node 22.14, wrangler 4.151.3, median of 7 requests, two separate runs:

| Scenario | Ticks | Score | Body | workerd (2 runs) | Node, same machine |
| --- | --- | --- | --- | --- | --- |
| 2-min game | 7,621 | 9,114 | 680 KB | 56–77 ms | 40–57 ms |
| 10-min game | 36,554 | 40,634 | 3.3 MB | 134–195 ms | 194–244 ms |
| 2-min stress | 13,416 | 15,042 | 954 KB | 51–61 ms | 66–69 ms |
| Maximum-size body (67,945 changes, 7.5 MiB) | — | (rejected after parse + 36 k ticks) | 7.5 MiB | 225 ms median, 289 max | — |

Scores in workerd equal Node's exactly. A 10-minute game is a few hundred ms of CPU against a 30 s limit. `wrangler.toml` sets `limits.cpu_ms = 5000` as a runaway-loop safety net.

Caveats, stated plainly: this is **local** workerd, not Cloudflare's network. Local workerd does not necessarily enforce production's 128 MB isolate cap; the 7.5 MiB / 68 k-change case ran without trouble, and the 8 MiB body limit was chosen so parsed data plus simulation stays well under 128 MB by a wide margin, but real CPU/memory should be confirmed with `wrangler tail` and the dashboard after the first deployment (see §14).

### Cost estimate (Workers Paid)

Assumptions: each submission is one `POST /runs` + one `POST /submit` + ~10 leaderboard reads (12 requests); verification 300 ms CPU (conservative; measured 50–225 ms); ~15 D1 rows written per run (run, score, updates, rate-limit counters, indexes).

| Submissions / month | Requests | Worker CPU | D1 rows written | Estimated bill |
| --- | --- | --- | --- | --- |
| 100 | ~1.2 k | ~30 s | ~1.5 k | **$5.00** (base fee) |
| 1,000 | ~12 k | ~5 min (1% of included) | ~15 k | **$5.00** |
| 10,000 | ~120 k | ~50 min (10% of included) | ~150 k | **$5.00** |

All three sit inside the included allowances; the bill is the flat base fee. Overage would only start around 100 k submissions/month for CPU. The `submit` global rate limit (default 1,200/hour) caps worst-case CPU at about 6 CPU-minutes/hour even under attack.

### Node-compatible alternative (not needed, not built)

Because the service code is portable, any small Node host (a ~$5 VPS, Fly.io/Render-class container) running the same router with a SQLite/Postgres `Db` adapter would work and has no CPU cap. I did not research those providers' current pricing for this phase (the Worker proved suitable), so treat that as an unverified option rather than a quoted figure.

## 3. Ranked run lifecycle

```
(no run)  ──POST /runs──►  issued  ──claim──►  verifying  ──finalize──►  accepted   terminal, owns exactly one scores row
                              │                   │    └─────finalize──►  rejected   terminal
                              │                   └──── release (internal error only) ──► issued
                              └── time passes ──► expired (derived: issued and expires_at ≤ now; pruned after a day)
```

Every arrow is a **single conditional SQL statement or one atomic batch**, so the database—not process memory—decides races (§7).

**What the server decides at issue time** (`POST /api/v1/runs`): a UUIDv4 run id; a 256-bit random bearer token (only its SHA-256 is stored); a CSPRNG 32-bit seed; the rules version; the approved config (`{playerCount:1, livesMode:"independent", friendlyFire:false, speed:[1,1]}`); `created_at`; `expires_at`. The request body is ignored: the client cannot influence any of it. A salted hash of the caller's IP is kept for abuse triage; the IP itself is not stored.

**MVP ranked rules:** single player only, standard lives, existing scoring. The replay header must carry exactly the issued seed, rules version and config (extra config keys are a mismatch). The experimental `?verified&seed=` developer path remains but can never be submitted: only a server challenge carries a token.

### Timing policy

| Rule | Value | Why |
| --- | --- | --- |
| Challenge lifetime | **60 minutes** from issue (`RUN_TTL_SECONDS`, 60 s–24 h) | Covers the longest allowed run plus long pauses |
| Minimum elapsed time | simulated duration (`totalTicks / 60`) must be ≤ real time since issue **+ 2 s** | The fixed-step runner never advances more than real time (and not at all while paused), so a legitimate client cannot finish faster than its replay claims. Rejects "10 minutes of play submitted 5 s after issue" (`too_fast`) before any simulation runs |
| Maximum length | **72,000 ticks = 20 simulated minutes** | Bounds CPU and memory |
| Pause / tab suspension / blur | Allowed | Simulation time stands still while paused, wall time continues; both sides of the inequality stay true. Only the 60-minute window limits how long a player can sit paused |

**This does not prove a human played.** A bot can generate a replay offline and simply wait. See §12.

## 4. Replay submission and verification

`POST /api/v1/runs/:id/submit`, `Authorization: Bearer <token>`, body JSON `{ replay, nickname?, controls? }`, optionally `Content-Encoding: gzip`.

Order of work (cheap and fail-fast first):

1. **Rate limit** (per hashed client + global) — before anything else.
2. **Run lookup, token check (constant-time on hashes), state check** (rejected → 409, expired → 410) — before reading the body.
3. **Bounded body read** (§ limits below), SHA-256 of the decoded bytes.
4. Already accepted? Same body → idempotent 200; different body → 409.
5. **Envelope**: UTF-8 JSON object with a `replay` object; nickname validated; `controls` whitelisted.
6. **Claim** (atomic).
7. `verifyRankedReplay()`: rules version still served → seed → rules → exact config → `totalTicks` bounds → elapsed-time rule → **`verifyReplay()`** (Phase 1: schema validation, full re-simulation, strict game-over boundary, claim cross-check).
8. **Finalize** (atomic): accepted with the **server-computed** score, or rejected.

`claimedResult` inside the replay is never used as a score. Phase 1's verifier cross-checks it and a disagreement is a rejection (`score_mismatch`).

### Payload limits (`server/src/config.ts`, enforced in `body.ts` and `verify.ts`)

| Limit | Value | Enforcement |
| --- | --- | --- |
| Compressed request | 1 MiB | `Content-Length` pre-check, then bytes counted while streaming; stream cancelled when exceeded |
| Decompressed / plain body | 8 MiB | Same, and the inflate stream is counted and cancelled at the limit (a 32 MiB-of-spaces gzip bomb is refused with 413) |
| Encodings | `identity`, `gzip` | Others → 415 |
| Ticks | 72,000 | `too_long` |
| Input changes | ≤ ticks (the replay schema allows at most one change per tick; Phase 1 also caps at 100 k) | Structure validation |
| Structure/types | every field type- and range-checked by Phase 1's `validateReplayStructure` | Before simulation |
| Simulation work | ≤ 72,000 ticks, bounded entity counts in the game itself | `limits.cpu_ms = 5000` as a backstop |

Reference points: a 10-minute replay is 3.3 MB raw / ~210 KB gzipped, well inside the limits.

### Failure and retry semantics (deliberate)

| Situation | Result | Consumes the run? |
| --- | --- | --- |
| Truncated/oversized/non-JSON body, bad gzip, wrong envelope, invalid nickname | 4xx | **No** — fix and resend |
| Replay content fails verification (schema, seed, rules, config, too fast, no game over, extra ticks, score claim mismatch) | 422 `replay_rejected` + `reason` | **Yes**, terminal (no oracle for iterating on forgeries) |
| Internal error while recording (database down, bug) | 503 | **No** — the claim is released; retry later |
| Verifier crashes on a crafted payload | 422 `invalid_replay` | Yes (a crafted payload cannot be resubmitted forever) |
| Response lost after acceptance; client resends identical bytes | 200, `replayed: true`, same score id | Idempotent |
| Another request is mid-verification | 409 `run_in_progress` + `Retry-After` | No |
| Worker died holding a claim | After a 30 s lease any request may take over | No |

## 5. Database schema

Migration `server/migrations/0001_init.sql` (applied to D1 with `wrangler d1 migrations apply`):

**`runs`** — `id` (PK, UUID), `token_hash`, `seed` (0…2³²−1), `rules_version`, `config_json`, `created_at`, `expires_at`, `status` (`issued|verifying|accepted|rejected`), `claim_token`, `claimed_at`, `replay_hash` (SHA-256 of the submitted body: enables idempotent retries; **not** proof of authenticity), `finished_at`, `score_id`, `reject_reason`, `reject_detail`, `issuer_hash`. CHECK constraints tie `status='accepted'` ⇔ `score_id` set and `status='rejected'` ⇔ `reject_reason` set.

**`scores`** — `id` (PK, UUID, public), `run_id` (**UNIQUE**, FK → runs), `score`, `nickname`, `completed_at` (server clock), `rules_version`, `ticks`, `duration_ms`, `asteroids_destroyed`, `ufos_destroyed`, `reported_controls` (**untrusted** client metadata), `visibility` (`visible|hidden`), `hidden_reason`, `hidden_at`.

**`rate_limits`** — `(bucket, window_start)` PK, `count`.

Indexes: partial board index `(rules_version, score DESC, completed_at ASC, id ASC) WHERE visibility='visible' AND score>0` (serves every leaderboard read) and `(rules_version, completed_at)` for weekly ranges. **Replays are not stored.** Only `replay_hash` is kept. Housekeeping (daily cron): abandoned runs a day past expiry, rejected runs after 30 days, stale rate-limit rows. Accepted runs are kept.

## 6. API contracts

All JSON, all under `/api/v1`. Errors: `{"error":{"code":"…","message":"…", …}}`.

### `POST /runs` → 201

```json
{
  "runId": "8c9f3e1a-5b0e-4f55-8d71-2d9bf0a1c001",
  "token": "kQ3x…43 chars of base64url…",
  "seed": 3898162777,
  "rulesVersion": "1.0.0",
  "schemaVersion": 1,
  "tickRate": 60,
  "config": { "playerCount": 1, "livesMode": "independent", "friendlyFire": false, "speed": [1, 1] },
  "issuedAt": "2026-10-22T15:00:00.000Z",
  "expiresAt": "2026-10-22T16:00:00.000Z"
}
```
The `token` is shown once. Errors: 429 `rate_limited` (+ `Retry-After`), 403 `origin_not_allowed`.

### `POST /runs/:id/submit` → 200

Request body (before optional gzip): `{"replay": {header, inputs, totalTicks, claimedResult?}, "nickname": "Dave J", "controls": {"scheme": "keyboard"}}`.

```json
{
  "status": "accepted",
  "replayed": false,
  "score": { "id": "c649cb33-…", "nickname": "Dave J", "score": 9114, "completedAt": "2026-10-22T15:03:11.204Z", "durationSeconds": 127.02 },
  "ranks": { "allTime": 3, "weekly": 1 }
}
```
Rejection (422):
```json
{ "error": { "code": "replay_rejected", "message": "The replay did not verify", "status": "rejected", "reason": "score_mismatch", "detail": "Score mismatch: claimed 9214 but independently calculated 9114" } }
```
`reason` ∈ `invalid_replay, seed_mismatch, rules_mismatch, config_mismatch, too_long, too_fast, not_game_over, score_mismatch`.

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_submission`, `invalid_nickname`, `invalid_body`, `empty_body` | Envelope/transport problem; run still open |
| 401 | `invalid_token` | Missing/wrong token |
| 404 | `run_not_found` | Unknown or malformed run id |
| 409 | `run_rejected`, `run_already_submitted`, `run_in_progress`, `run_busy` | Terminal or busy state |
| 410 | `run_expired` | Past `expiresAt` |
| 413 | `payload_too_large` | Over a size limit |
| 415 | `unsupported_encoding` | Not identity/gzip |
| 422 | `replay_rejected` | Verification failed |
| 429 | `rate_limited` | Throttled |
| 503 | `service_unavailable` | Could not record; retry |

### `GET /leaderboard/all-time` and `/leaderboard/weekly` → 200

Query: `limit` (1–100, default 10), `offset` (0–1000). Anything else → 400 `invalid_parameter`.

```json
{
  "scope": "weekly", "rulesVersion": "1.0.0",
  "timeZone": "America/Halifax", "weekStart": "2026-10-19T03:00:00.000Z", "weekEnd": "2026-10-26T03:00:00.000Z",
  "limit": 10, "offset": 0, "total": 42,
  "entries": [ { "id": "c649cb33-…", "rank": 1, "nickname": "Dave J", "score": 9114, "completedAt": "2026-10-22T15:03:11.204Z", "durationSeconds": 127.02 } ]
}
```
### `GET /scores/:id` → 200 `{ "score": {…}, "ranks": { "allTime": 3, "weekly": 1 } }` (404 if unknown **or hidden**)
### `GET /health` → `{ "ok": true, "rulesVersion": "1.0.0", "schemaVersion": 1, "maxTicks": 72000, "time": "…" }`
### `POST /admin/scores/:id/visibility` — body `{"visible": false, "reason": "offensive"}`, `Authorization: Bearer <ADMIN_TOKEN>`. The route does not exist (404) unless `ADMIN_TOKEN` (≥ 16 chars) is configured; never sends CORS headers; failed attempts are rate limited.

Public entries expose only `id, rank, nickname, score, completedAt, durationSeconds`.

## 7. Atomic, one-use submission

* **Claim:** `UPDATE runs SET status='verifying', claim_token=?, … WHERE id=? AND expires_at>? AND (status='issued' OR (status='verifying' AND claimed_at<=?lease))`. `changes = 1` means this request owns the run; everyone else gets the current state (409 / idempotent 200).
* **Finalize (one atomic `batch`):** `INSERT INTO scores … SELECT … WHERE EXISTS (SELECT 1 FROM runs WHERE id=? AND status='verifying' AND claim_token=?)` then `UPDATE runs SET status='accepted', score_id=? WHERE … claim_token=?`. If the claim was lost to a lease takeover, neither statement does anything.
* **Backstop:** `scores.run_id UNIQUE`. A bug in the state machine still cannot create two entries for a run (tested by inserting a duplicate directly).

Tested: 12 simultaneous identical submissions and 5 simultaneous *different* ones on one database; 16 requests spread over **4 separate SQLite connections** to one file (the multi-instance case); injected database failures at the score insert and at claim release; a 10-way concurrent submit against the real Worker/D1.

*Honesty note:* workerd runs the CPU-bound verification of one isolate's requests one at a time, so in the real-Worker test the later requests arrive after the first has finished and are answered idempotently. The genuinely interleaved race (claim vs claim) is exercised by the multi-connection SQLite tests, which run the identical SQL.

## 8. Scoring-version compatibility policy

* `GAMEPLAY_RULES_VERSION` (`src/replay/constants.ts`) must change whenever physics, spawning, collision or scoring changes. The server only verifies the version it was built with, and the replay header and the run must both match it.
* Leaderboards **only rank scores of the current rules version**; older scores stay in the table (not deleted) but are not mixed in.
* A client built for different rules refuses to start ranked play (`update_required`) when the challenge's rules version differs from its own.
* Deploy the new game and the new Worker together. Runs issued before a server upgrade can no longer be reproduced and are rejected with `rules_mismatch` (a player mid-game at deploy time loses that one run).

## 9. Weekly / all-time definitions

* **All-time:** visible scores > 0 under the current rules version.
* **Weekly:** the same, with `completed_at` in `[Monday 00:00, next Monday 00:00)` in **America/Halifax**, from the server's own completion timestamp. Window boundaries are computed with real zone offsets, so a DST week is 167 or 169 hours. Tested: ordinary week, the exact instants either side of Monday midnight, spring (2026-03-08) and autumn (2026-11-01) changes, the New Year week, and a year of random instants tiling without gaps or overlaps.
* **Order:** score descending, then earlier `completed_at`, then smaller `id`. Ranks are ordinal (no shared places). Hidden, zero-score, and other-version entries are excluded; ranks of lower entries shift when an entry is hidden.
* Zero-score runs are accepted (the run is finished, one-use) but never listed.

## 10. Abuse prevention

One-use run ids; CSPRNG tokens and seeds; expiry; atomic state transitions; per-client and global rate limits stored in the database (exact, shared by all instances); credentials and cheap checks before the body is read; strict size/encoding limits; validation before simulation; minimum-elapsed-time rule; rejection of non-approved configuration; an `Origin` allow-list for browser POSTs (hygiene, not authentication); nickname charset with no markup characters; admin routes disabled by default; no frontend API key (none would be secret). Rate limits (defaults, env-tunable): 30 run starts and 30 submissions per client-hash per hour; 3,000 starts and 1,200 submissions per hour globally. Client identity is a salted hash of `CF-Connecting-IP`, used only as one coarse layer; shared networks share a bucket, so limits are generous and nothing is *granted* based on an IP. Turnstile was not added: it adds friction and the main risk (bots playing well) is not something it fixes.

Minimal logging (no IPs, nicknames or tokens): `run_rejected`, `verifier_threw`, `submit_failed`, `unhandled`, `prune`.

Moderation: `POST /admin/scores/:id/visibility`, or directly: `wrangler d1 execute asteroids-leaderboard --remote --command "UPDATE scores SET visibility='hidden', hidden_reason='…', hidden_at=strftime('%s','now')*1000 WHERE id='…'"`.

## 11. What an attacker can and cannot do

Assume the attacker reads the JavaScript, edits local state, hand-writes replay JSON, runs the simulation headlessly, scripts inputs, replays HTTP requests and calls the API directly.

| Attack | Outcome |
| --- | --- |
| POST a score, or a replay with an inflated claimed score | Rejected: the server's own replay decides |
| Choose a convenient seed, rules version or co-op/speed config | Rejected: must equal what the server issued |
| Edit, reorder, pad or truncate inputs | Rejected (`invalid_replay`/`score_mismatch`/`not_game_over`) |
| Reuse a token / re-send a captured request | Same bytes → the original result, no second entry; different bytes → 409 |
| Use another run's token | 401 |
| Submit a long replay immediately | `too_fast` |
| Flood run starts or submissions | 429; global CPU ceiling |
| Gzip bomb / giant body / truncated upload | 413 / 400 without consuming CPU on simulation |
| Submit from a hostile web page | Refused by Origin check; a token is required anyway |

## 12. Remaining security limitations (not hidden)

1. **Bots are not detected.** The seed is revealed at issue time, so an attacker can run an optimizer or AI offline against *that exact seed* for up to the challenge lifetime (60 min), then submit a perfectly valid replay that a human could never produce. A bot (like `server/testing/bot.mjs`) is indistinguishable from a player. Verification proves the score is *reproducible under the rules*, not that it was *achieved by a person*. Mitigations available later: shorter challenge lifetime, statistical input analysis (reaction-time/APM heuristics), hiding top replays for review, Turnstile, device-level reputation.
2. **No identity.** Nicknames are not unique and not owned. A browser-local score list is a convenience only; clearing storage or switching devices loses it. Anyone can use any nickname.
3. **Reported controls are self-declared.** `reported_controls` is for analysis; a modified client can lie, and ranking never depends on it.
4. **Offensive nicknames** are limited by charset only; there is no word filter. Moderation is after-the-fact (hide).
5. **Denial of service** is bounded, not prevented: a flood of cheap requests still costs request fees, and the global rate limits can be exhausted by an attacker to block legitimate starts/submissions. Consider a Cloudflare WAF rate-limiting rule at the edge (an account setting, not done here).
6. **Rate limiting by IP** is imperfect in both directions (shared NATs, rotating proxies).
7. **In-flight runs lost on deploy** if rules change; a run longer than 20 simulated minutes cannot be submitted (the client reports it; the game does not yet stop the run at the cap).
8. **Memory/CPU limits have been checked on local workerd only**, not on Cloudflare's network.
9. **Only single-player, keyboard-driven ranked play was exercised end-to-end in a browser.** Touch and gamepad metadata are unit-tested (`tests/ranked.test.ts`) but not driven through a ranked browser run.
10. **D1 is a single-region primary** and there is no backup beyond D1 Time Travel.

## 13. Local setup and testing

Requires Node 22+ (`node:sqlite` is used by tests; workerd is downloaded by `npm install`) and a Chrome/Edge for the browser tests (or `CHROME_PATH`).

```bash
cd phaser-asteroids && npm install
cd server && npm install                  # wrangler, @types/node (devDependencies only)

# Run the API locally (workerd + local D1 under server/.wrangler/state; no Cloudflare account needed)
npm run migrate:local
npm run dev                               # http://127.0.0.1:8787
# optional secrets for local admin/IP hashing: server/.dev.vars   (git-ignored)
#   ADMIN_TOKEN=some-long-random-string-of-16+chars
#   IP_HASH_SALT=any-random-string

# Run the game against it (separate terminal, from phaser-asteroids/)
npm run dev                               # http://localhost:5173
# open  http://localhost:5173/?ranked=1&nick=YourName     (PLAY now requests a server-issued run)
```

| Command (from `phaser-asteroids/`) | What it proves | Runtime |
| --- | --- | --- |
| `npm test` | All unit tests, including server (`node:sqlite`, same SQL/migrations) and client | local, mocked clock |
| `npm run test:server` | Only the 108 server tests: lifecycle, forgery, concurrency, limits, leaderboard, weeks, moderation, nicknames, rate limits | local, mocked clock |
| `npm run test:worker` | 32 HTTP checks against the **real Worker in workerd with a real local D1** and the real clock | local service |
| `npm run test:ranked` | **Chromium → game → Worker → D1 → leaderboard**, plus casual play with the backend down | local service, real browser |
| `npm run bench:workerd` | CPU/latency of the verifier in workerd | local service |
| `npm run typecheck`, `cd server && npx tsc --noEmit -p tsconfig.json` | Types | — |

Nothing above is a test against production Cloudflare infrastructure.

## 14. Deployment procedure (not executed; needs your approval and account)

1. `cd phaser-asteroids/server && npx wrangler login` and upgrade the account to **Workers Paid** in the dashboard (US$5/month).
2. `npx wrangler d1 create asteroids-leaderboard` — paste the printed `database_id` into `[env.production]` in `wrangler.toml`.
3. Set `ALLOWED_ORIGINS` in `[env.production.vars]` (default `https://djblackett.github.io`; include a custom domain if used).
4. `npx wrangler d1 migrations apply asteroids-leaderboard --env production --remote`
5. Secrets: `npx wrangler secret put IP_HASH_SALT --env production` (any long random string) and, if you want moderation via API, `npx wrangler secret put ADMIN_TOKEN --env production` (≥ 16 chars).
6. `npx wrangler deploy --env production` — note the `*.workers.dev` URL (or attach a custom domain).
7. Check: `curl https://<worker>/api/v1/health`.
8. Point the game at it: build the site with `VITE_LEADERBOARD_API_URL=https://<worker>` (for GitHub Pages, set it in the build workflow's environment). Until it is set, `?ranked` shows "Ranked play is not available in this build" and casual play is untouched.
9. Smoke test: open `https://…/?ranked=1`, play a short game, confirm the score on `GET /api/v1/leaderboard/all-time`.

**Monitoring:** `npx wrangler tail --env production` (look for `run_rejected`, `verifier_threw`, `submit_failed`, `unhandled`); Cloudflare dashboard → Workers → Metrics (CPU time p50/p99, errors) and D1 metrics. Confirm real-world CPU per verification stays well under the 5 s cap.

**Rollback:** `npx wrangler rollback --env production` restores the previous Worker version (also available in the dashboard). Migrations are forward-only; 0001 is additive. For data problems, D1 Time Travel: `npx wrangler d1 time-travel restore asteroids-leaderboard --env production --timestamp=<RFC3339>`. Removing `VITE_LEADERBOARD_API_URL` from the site build turns ranked play off without touching the backend.

## 15. Future client UI integration

Everything the UI needs is already exposed by the game and API:

* **Start:** `requestChallenge()` / `StartScene.startRanked()` (`src/ranked/api.ts`); replace the `?ranked` dev flag with a menu item.
* **State:** `rankedSession` (`src/ranked/session.ts`) with phases `requesting → playing → submitting → accepted | rejected | failed | abandoned`; mirrored on `window.__ASTEROIDS_RANKED__` for tests.
* **Result:** `outcome.score` and `outcome.ranks` (all-time and weekly rank) after acceptance; the game-over screen already shows one status line.
* **Personal best:** `src/ranked/localScores.ts` keeps accepted `{id, score, at}` on this device; `GET /scores/:id` returns the current rank for each id.
* **Nickname:** `?nick=` / stored value today; add an input and let the server's 400 `invalid_nickname` message drive validation text.
* **Leaderboard screen:** `GET /leaderboard/weekly|all-time` (page with `limit`/`offset`). Render nicknames with text APIs only. Show `weekEnd` as the reset time.
* Handle `failed`/`rejected` by offering "Play again (ranked)" which goes back to the title and requests a *new* challenge, as RETRY already does.
