# Phaser Asteroids — Secure Online Leaderboard (Phase 2 backend, Phase 3 player experience)

> **Status:** Implemented and tested locally (Node + real workerd/D1 runtime + real Chromium). Production D1 created and both migrations applied on 2026-10-22; production secrets prepared in a local encrypted backup. **Worker deployment awaits approval.** Frontend GitHub Actions wiring is prepared but has not been published.
> Phase 3 (the ranked menu, nickname entry, High Scores, personal best, and the time-limited ending) is described in [§15](#15-the-player-facing-experience-phase-3); the 20-minute limit decision is in [§3](#timing-policy).
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

**Free plan is not viable:** replay verification costs 50–250 ms of CPU, 5–25× the 10 ms cap. D1 itself would have been fine on Free; the Worker CPU limit is the blocker. The implementation therefore targets **Workers Paid**, which the account owner has activated.

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
| Time limit | **72,000 ticks = 20 simulated minutes**, issued with the challenge as `timeLimitTicks` | Bounds CPU and memory. **Reaching it with the ship still alive is a valid, scored ending** (`endReason: "time_limit"`), not a failed submission. See below |
| Pause / tab suspension / blur | Allowed | Simulation time stands still while paused, wall time continues; both sides of the inequality stay true. Only the 60-minute window limits how long a player can sit paused |

**This does not prove a human played.** A bot can generate a replay offline and simply wait. See §12.

### The 20-minute limit is a valid ending (decision)

*Problem (found in Phase 2):* a run longer than 72,000 ticks could not be submitted, so a player's best-ever run could silently become unsubmittable.

*Investigation (numbers measured for this decision):*

| Question | Result |
| --- | --- |
| Verification cost of a full 72,000-tick run | ~0.5 s of simulation CPU in Node even with an immortal ship at difficulty level 39 (scratch measurement); the Worker's safety net is `cpu_ms = 5000` |
| Worst-case recording size, one input change on **every** tick of 20 minutes (Assisted Flight steering) | 6.9 MiB raw, **0.44 MiB gzipped** (about 15:1). Limits are 8 MiB / 1 MiB, so a full-length run fits with margin |
| How far can play realistically go? | Asteroids get 15 % faster every 30 s without bound, the shipped bot dies within 2-6 minutes on every seed tried, and no run in testing has come near 20 minutes |
| Challenge lifetime | 60 minutes: 20 minutes of play plus 40 minutes of pauses |

*Decision:* keep the measured 20-minute resource budget and make **reaching it a first-class outcome** instead of raising an arbitrary cap (any finite cap would otherwise recreate the same problem one minute later):

* The server issues `timeLimitTicks` with every challenge and stores it with the run (`runs.time_limit_ticks`). It is verified against that stored value, so changing the configuration never strands a run that is already in flight.
* The game stops the run at exactly that tick (authoritative simulation ticks, not wall time) and shows a result page: **TIME LIMIT REACHED**.
* The replay's `totalTicks` must equal the limit exactly. A natural game over before it always wins. A replay that stops early without game over is still `not_game_over`; one that runs past it is `too_long`; a game-over replay padded to reach the limit is `invalid_replay`.
* The server simulates exactly that many ticks and scores the simulation **at that tick**. A ship never has to be "killed". Nothing in the body can choose or move the limit, and the recording's own claim (`claimedResult.endReason`) is only cross-checked.
* The ending is stored (`scores.end_reason`, `game_over` or `time_limit`) and returned as `endReason`.
* The limit is told to players before they start (the Ranked Play page) and counted down in the HUD during the last minute.
* Versioning: `claimedResult.endReason` is optional and recordings made before it existed still verify; `verifyReplay` only honours a time limit when a caller passes `timeLimitTicks`. `RANKED_TIME_LIMIT_SECONDS` can only **shorten** the limit (5-1200 s); the CPU, memory and body-size budgets were sized for 1200 s and cannot be raised by configuration.

*Not covered by a test at full length:* no automated run can stay alive for 72,000 ticks, so the exact-limit rules are tested at a reduced limit (480-1500 ticks, in real Chromium and in the unit tests); the rules are the same code path at every length, and the full-length CPU and body-size figures above are measurements, not a test.

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
| Ticks | 72,000 (the issued time limit) | `too_long`; a run alive at exactly the limit is accepted |
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

Migrations `server/migrations/0001_init.sql` and `0002_time_limit.sql` (applied to D1 with `wrangler d1 migrations apply`; 0002 adds `runs.time_limit_ticks` and `scores.end_reason`, see §3):

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
  "timeLimitTicks": 72000,
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
  "score": { "id": "c649cb33-…", "nickname": "Dave J", "score": 9114, "completedAt": "2026-10-22T15:03:11.204Z", "durationSeconds": 127.02, "endReason": "game_over" },
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
### `GET /health` → `{ "ok": true, "rulesVersion": "1.0.0", "schemaVersion": 1, "maxTicks": 72000, "timeLimitSeconds": 1200, "time": "…" }`
### `POST /admin/scores/:id/visibility` — body `{"visible": false, "reason": "offensive"}`, `Authorization: Bearer <ADMIN_TOKEN>`. The route does not exist (404) unless `ADMIN_TOKEN` (≥ 16 chars) is configured; never sends CORS headers; failed attempts are rate limited.

Public entries expose only `id, rank, nickname, score, completedAt, durationSeconds, endReason` (`game_over` or `time_limit`).

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
7. **In-flight runs lost on deploy** if rules change. (A run that reaches 20 simulated minutes is no longer a failure: it ends there and is scored, see §3.)
8. **Memory/CPU limits have been checked on local workerd only**, not on Cloudflare's network.
9. **Browser coverage is emulated, not physical:** keyboard and touch (Assisted Flight, Chromium touch emulation) ranked runs and gamepad *menu* navigation are driven end to end; a controller-flown ranked run and real-phone behaviour are not.
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
# open  http://localhost:5173/            then RANKED -> START RANKED RUN (the dev shortcut ?ranked=1 also still works)
```

| Command (from `phaser-asteroids/`) | What it proves | Runtime |
| --- | --- | --- |
| `npm test` | All unit tests, including server (`node:sqlite`, same SQL/migrations) and client | local, mocked clock |
| `npm run test:server` | Only the server tests: lifecycle, forgery, concurrency, limits, leaderboard, weeks, moderation, nicknames, rate limits | local, mocked clock |
| `npm run test:worker` | 32 HTTP checks against the **real Worker in workerd with a real local D1** and the real clock | local service |
| `npm run test:ranked` | The whole player journey through the real menus: **Chromium → game → Worker → D1 → leaderboard → High Scores → personal best**, plus ranked/casual play with the backend down | local service, real browser |
| `npm run test:ranked:ui` | Time-limited run on a Worker with an 8 s limit, forged-score rejection, skip, lost-response Retry, challenge expiry, paging, empty board, gamepad menu navigation, phone-sized touch + Assisted Flight run, resize/keyboard-field alignment | local services, real browser |
| `npm run bench:workerd` | CPU/latency of the verifier in workerd | local service |
| `npm run typecheck`, `cd server && npx tsc --noEmit -p tsconfig.json` | Types | — |

Nothing above is a test against production Cloudflare infrastructure.

## 14. Production setup and deployment

### Prepared on 2026-10-22; Worker deployment awaits approval

The existing Cloudflare account is `620de0810a6cf29710d9fedb3a966d6f`. Production D1 `asteroids-leaderboard` is `cf4833f7-5fc9-45ca-a767-750df108f1e9` (ENAM). These identifiers are public configuration, not credentials. The `DB` binding in `env.production` points to this database; `0001_init.sql` and `0002_time_limit.sql` are applied remotely. No Worker was deployed during preparation.

Production retains the 5,000 ms CPU cap, daily `17 7 * * *` UTC housekeeping, 20-minute ranked limit and `https://djblackett.github.io` CORS origin (origins have no repository path). Both secrets are declared required for production deployments. The API will use HTTPS on `workers.dev`; version preview URLs are disabled. GitHub Pages continues to host the game. The default D1 placeholder, local origins, `dev:lan`, `migrate:lan`, LAN proxy and `.wrangler/state-lan` remain separate from production.

Preparation validation passed: frontend and backend typechecks, frontend production build, all 127 backend unit tests, all 32 real local Worker/D1 integration checks, production deployment dry-run with both secret bindings, and the existing LAN Chromium smoke test (ranked game, accepted replay, both boards and persistence after reload). The dry-run artifacts contain neither secret and no temporary plaintext upload file remains. Production health and public URL verification must follow the approved deployment.

### Secrets and the first deployment (Windows)

`server/scripts/production-secrets.ps1` prepares two independent 256-bit random secrets and saves only Windows DPAPI-encrypted SecureStrings in git-ignored `.wrangler/production-secrets/secrets.clixml`, with access restricted to the current Windows user. `Initialize` has already been run on this machine; it refuses to overwrite existing secrets. The backup is tied to this Windows user/machine; keep a password-manager copy of the admin token before replacing the machine or Windows profile.

From `phaser-asteroids/server/`, in PowerShell:

```powershell
# Preparation only: validate the encrypted backup and compile without publishing.
./scripts/production-secrets.ps1 -Action Check
./scripts/production-secrets.ps1 -Action DryRun

# Optional: copy ADMIN_TOKEN directly into your password manager without printing it.
./scripts/production-secrets.ps1 -Action CopyAdminToken
# After saving it, clear the clipboard:
Set-Clipboard -Value ''

# ONLY after explicit production deployment approval:
./scripts/production-secrets.ps1 -Action Deploy
```

`Deploy` uses the installed Wrangler's `deploy --env production --no-autoconfig --secrets-file` to attach both secrets to the first version, so traffic never reaches a version with the development IP salt (see [Cloudflare's secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/)). Its temporary JSON file inherits the private directory's ACL and is removed in `finally`; Wrangler disk logging and metrics are disabled for this command, and secret values are redacted from console output. `DryRun` exercises this path with `--dry-run` and uploads nothing. Neither action changes `.dev.vars` or LAN settings. Do not pass secrets through `--var`, command arguments, frontend `.env` files or GitHub Actions variables.

On other platforms, use a password manager and Wrangler's `--secrets-file` with a protected, temporary JSON or dotenv file. For later secret rotation, `wrangler secret put IP_HASH_SALT --env production` and `wrangler secret put ADMIN_TOKEN --env production` prompt without putting values in shell history. **These commands create a new deployment**, so use them only after deployment is approved. Changing the IP salt resets per-IP rate-limit identities; changing the admin token invalidates the old moderation credential. Do not rotate either accidentally.

### GitHub Pages build wiring (prepared only)

`.github/workflows/deploy-gh-pages.yml` supplies `${{ vars.VITE_LEADERBOARD_API_URL }}` to the existing production build step. After the Worker is deployed and verified, set the **repository Actions variable** `VITE_LEADERBOARD_API_URL` to the returned HTTPS origin, without `/api/v1`. This is a public URL, not a secret. Use a repository variable because the build job does not run in the `github-pages` environment. `IP_HASH_SALT` and `ADMIN_TOKEN` belong only in Cloudflare Worker secrets.

Do not merge to `main`, push a production frontend change or manually run a Pages deployment as part of backend setup. Publishing the frontend is a separate release. Leaving the Actions variable unset retains the current unconfigured-ranked behavior for non-loopback visitors. The opt-in LAN config still selects its same-origin local proxy even when a production build URL exists.

### General deployment checklist

1. `cd phaser-asteroids/server && npx wrangler login` and upgrade the account to **Workers Paid** in the dashboard (US$5/month).
2. `npx wrangler d1 create asteroids-leaderboard` — paste the printed `database_id` into `[env.production]` in `wrangler.toml`.
3. Set `ALLOWED_ORIGINS` in `[env.production.vars]` (default `https://djblackett.github.io`; include a custom domain if used).
4. `npx wrangler d1 migrations apply asteroids-leaderboard --env production --remote`
5. Prepare `IP_HASH_SALT` and `ADMIN_TOKEN` securely as above. Obtain approval before any command that publishes the Worker, including `secret put`.
6. First deployment: use the helper's `Deploy` action above (or `npx wrangler deploy --env production --secrets-file <protected-file>`). Later code-only deployments preserve existing secrets. Note the `*.workers.dev` URL (or attach a custom domain).
7. Check: `curl https://<worker>/api/v1/health`.
8. Point the game at it: build the site with `VITE_LEADERBOARD_API_URL=https://<worker>` (for GitHub Pages, set it in the build workflow's environment). Until it is set, `?ranked` shows "Ranked play is not available in this build" and casual play is untouched.
9. Smoke test: open `https://…/?ranked=1`, play a short game, confirm the score on `GET /api/v1/leaderboard/all-time`.

**Monitoring:** `npx wrangler tail --env production` (look for `run_rejected`, `verifier_threw`, `submit_failed`, `unhandled`); Cloudflare dashboard → Workers → Metrics (CPU time p50/p99, errors) and D1 metrics. Confirm real-world CPU per verification stays well under the 5 s cap.

**Rollback:** `npx wrangler rollback --env production` restores the previous Worker version (also available in the dashboard). Migrations are forward-only; 0001 is additive. For data problems, D1 Time Travel: `npx wrangler d1 time-travel restore asteroids-leaderboard --env production --timestamp=<RFC3339>`. Removing `VITE_LEADERBOARD_API_URL` from the site build turns ranked play off without touching the backend.

## 15. The player-facing experience (Phase 3)

Code: `src/ranked/` (API client, submission state machine, personal best, boards model), `src/ui/menu/pages/{ranked,rankedResult,scores}.ts` (pages built from the existing menu kit), `src/ui/nicknameInput.ts` (the one DOM text field), `src/scenes/{StartScene,GameScene}.ts` (integration). Nothing here verifies or ranks anything: every number on screen after a run comes from the server's answer.

### Flow

```
TITLE  ── PLAY (casual, unchanged; Space)
       ── RANKED (R) ──► RANKED PLAY page: rules, the time limit, your best verified score
       │                    └ START RANKED RUN ─ POST /runs ─► CONNECTING… ─► play
       │                    └ (backend down / not configured) "Ranked Play is temporarily unavailable. You can still play normally."
       │                         TRY AGAIN · PLAY NORMALLY · BACK
       ── HIGH SCORES (H) ─► THIS WEEK | ALL TIME, 10 per screen, PREVIOUS / NEXT, BACK
RANKED RUN ── RANKED label beside the clock (a countdown in the last minute) ── pause/resume as normal
       └─ game over, or TIME LIMIT REACHED ─► RESULT page: score, name field, SUBMIT SCORE / SKIP
            └─ SUBMIT ─► UPLOADING… ─► SERVER IS VERIFYING… ─► SCORE VERIFIED! (weekly + all-time rank) ─► VIEW HIGH SCORES · PLAY AGAIN · MAIN MENU
```

* `?ranked=1` still works as a developer shortcut (PLAY then opens the same Ranked Play page and starts the request), but nothing needs it.
* **Ranked is one player.** With two players chosen on the title screen the button reads `RANKED / 1 PLAYER ONLY` and is disabled; the player count is never changed silently.
* **Ranked play starts only after the server issues a challenge.** A failed request leaves the player on the page with a plain message; a casual game is never started in its place unless they choose PLAY NORMALLY. The result page's PLAY AGAIN goes through the same request: a spent challenge is never reused.
* **Leaving a run in progress** needs the pause menu's existing two-press RETURN TO MENU. An abandoned run creates no score. After the result page is open, MAIN MENU / PLAY AGAIN only appear once there is nothing left to submit (accepted, rejected, expired, skipped...), so a score cannot be thrown away by one stray tap; SKIP is an explicit button.
* **Expiry during a long pause** is detected as it happens (against the device clock, shifted by the clock difference measured when the challenge arrived). The pause menu and HUD say `RANKED RUN EXPIRED`, the label changes to `UNRANKED`, and the result page says the run expired instead of attempting a submission that cannot succeed.

### Submission states (`src/ranked/submission.ts`)

| State | What the player sees | Leads to |
| --- | --- | --- |
| ready | name field, SUBMIT SCORE (Enter), SKIP; live feedback under the field | uploading, skipped |
| uploading | "UPLOADING YOUR RUN…" (or "CONNECTION TROUBLE. TRYING AGAIN (n)…") | verifying |
| verifying | "THE SERVER IS VERIFYING YOUR SCORE…" (shown when the upload has really finished: XHR `upload.onload`) | any answer |
| accepted | **SCORE VERIFIED!**, the server's score, nickname, weekly and all-time rank, new personal best | — |
| rejected | SCORE NOT VERIFIED, reason code in small print; the run is spent | — |
| network error | "Could not reach the ranked server. Your run is safe." RETRY · SKIP | uploading |
| duplicate | "Already submitted" (the run holds an accepted score under a different submission) | — |
| expired | "Ranked run expired"; nothing was sent | — |
| refused / unavailable | the server refused the request / no API configured | — |

"Verified" is shown only for a state reached from a `200 accepted`. **Retry semantics:** the request body (replay + nickname + controls) is built once and sent byte-identically on every attempt (the browser test hashes every request). The automatic attempts are bounded (the first try plus two repeats, 1.5 s and 4 s apart); after that nothing happens until the player presses RETRY. Only transport failures, 5xx, 429 and "still verifying" can be retried; a server rejection, expiry or a `run_already_submitted` never is. A response lost after the server accepted the run comes back as `replayed: true` with the original score (tested end to end). The nickname is locked after the first send (a changed name would be a different body and a 409); it reopens only if the server itself says `invalid_nickname`, which does not consume the run.

### Nickname

3-16 characters (counted as Unicode code points), must start with a letter or digit, then letters, digits, space and `_ . ! -`; blank means `Anonymous`. The rule lives in one function, `src/ranked/nickname.ts`, which the Worker re-exports, so the field's live feedback and the server cannot disagree (the server's answer remains authoritative). The last **successfully submitted** nickname is remembered in `localStorage` (`asteroids.rankedNickname`) and pre-filled; `?nick=` pre-fills on a development page and stores nothing. Nicknames are drawn as plain canvas text, never HTML.

**Mobile keyboard.** The field is a real `<input>` laid over its canvas frame: a phone opens its keyboard only for a tap that lands on an input, and you also get IME, paste and screen-reader support. It follows the canvas through resizes and rotation every frame (verified at 667×375, 844×390, 1024×768, 768×1024, 1920×1080 with the typed text kept); while it is focused and the on-screen keyboard has shrunk the visual viewport, it docks just above the keyboard so what is being typed is never hidden; in portrait the "rotate your phone" prompt covers it and the text is kept; Enter / "Done" dismisses the keyboard and submits (if valid); key presses in the field never reach the game (no steering, pausing or retrying while typing); font size is at least 16 px so iOS does not zoom. `interactive-widget=resizes-visual` is set on the viewport meta so browsers behave alike.

### Personal best (`src/ranked/localScores.ts`, `personalBest.ts`)

The 20 best **server-accepted** `{id, score, at, nickname}` entries are kept in `localStorage` (`asteroids.rankedScores`); the best across nicknames is the personal best. Only an acceptance adds to it. When a page that shows it opens, `GET /scores/:id` refreshes it (and forgets a score the server no longer lists, e.g. hidden); offline it shows the remembered figure. Clearing site data forgets it, switching device does not carry it. A score id is public and proves nothing: High Scores marks rows whose **id** matches a remembered one with `YOU` (never by nickname). There are no accounts and nothing here is an identity.

### High Scores (`src/ui/menu/pages/scores.ts`, `scoresModel.ts`)

THIS WEEK (default) / ALL TIME, ten entries per screen (`limit=10&offset=…`, never a bulk download), PREVIOUS / NEXT, `PAGE n / m`. The week caption (`WEEK OF OCT 19 - OCT 25 (ATLANTIC TIME)`) is formatted from the server's `weekStart`/`weekEnd`/`timeZone`; the browser never computes a week. Switching boards works by touch, mouse, Left/Right on the tabs (keyboard and D-pad), and a slow answer for a board the player has already left is dropped. States: loading, empty ("No ranked scores yet. Be the first!"), network error (TRY AGAIN), not configured ("High scores are not available yet"), ready.

### Offline, unconfigured and development behaviour

* **No production API configured** (`VITE_LEADERBOARD_API_URL` unset, non-loopback host): casual play is untouched; Ranked Play says "not available in this build yet"; High Scores says "not available yet"; nothing is requested.
* **Backend unreachable:** a normal game still starts instantly (the browser test turns the Worker off and checks no API call is made by plain PLAY).
* **Local development:** on a loopback host `?api=http://127.0.0.1:PORT` selects a local Worker and the default is `wrangler dev`'s `http://127.0.0.1:8787`. `?api=` is ignored on any other host.
* Intro page limitation: the Ranked Play page states the production limit (20:00); a Worker started with a shorter `RANKED_TIME_LIMIT_SECONDS` (tests only) still shows 20:00 there, while the HUD and result page use the issued value.

### Mobile and accessibility notes

Controls are at least 90 game px (≥ 44 CSS px at 667×375 and up; asserted in the browser tests for the title, High Scores and result pages), no page has overlapping or off-screen controls (asserted from the menu geometry), keyboard focus rings are the existing gold frames, the DOM field has an accessible name and a visible focus style, and a polite live region announces results ("Score verified. 24,850 points. Weekly rank 7."). Nothing animates while verifying, so reduced-motion needs no special case. Portrait phones get the existing rotate prompt (the game is landscape-only).

### Manual acceptance checklist (physical Android phone) — NOT yet performed

No real device was available to this work; the Android keyboard, `visualViewport` behaviour, fullscreen and haptics on real hardware are **untested**. Please run on a phone against a reachable Worker (for example `wrangler dev --ip 0.0.0.0` plus `npm run preview:lan`, with the phone's origin in `ALLOWED_ORIGINS`):

1. Open the game: title menu shows PLAY, RANKED, HIGH SCORES, AUDIO, CONTROLS; everything is thumb-sized.
2. HIGH SCORES: switch THIS WEEK / ALL TIME, page with NEXT, BACK.
3. RANKED → read the time limit → START RANKED RUN → game starts only after "CONNECTING…".
4. Fresh install: movement is Assisted Flight; steer, FIRE, LASER, BOOST feel normal; the RANKED label is visible and does not cover anything.
5. Fullscreen button (title/pause) still works; PAUSE → RESUME keeps the run; rotate upright and back.
6. Die (or reach the limit). Result page: tap the name field — keyboard opens, the field stays visible above it, typing works, "Done" dismisses and submits; try a 2-character name and see feedback; dismiss the keyboard by tapping elsewhere and confirm the text is still there.
7. SUBMIT: uploading → verifying → SCORE VERIFIED! with the ranks you expect. Turn on airplane mode before SUBMIT: you get "Could not reach…" and RETRY works after turning it off, without a second score.
8. VIEW HIGH SCORES: your row is marked YOU.
9. Reload the page: RANKED page shows your best verified score. Clear site data: it is gone, the board entry is not.

### Known limitations (Phase 3)

* Real-device behaviour (above) is untested; the on-screen-keyboard docking relies on `visualViewport` and is only exercised in emulation.
* A ranked run at the full 20:00 has not been played in automated tests; the time-limit rules are tested at 8 s (real Chromium + Worker) and 1500 ticks (unit), and full-length cost is a measurement (see §3).
* Gamepad-only players cannot type a nickname without a keyboard (they can SUBMIT with the remembered one, or leave it blank for `Anonymous`); there is no on-screen controller keyboard by design.
* The nickname has no word filter (moderation is after the fact, §12.4).
* Rank text uses the ranks returned at acceptance; the High Scores screen is a snapshot and may be a few seconds stale (`Cache-Control: public, max-age=5`).
* Ranked scores and bots: §12.1 is unchanged. Anyone can generate a valid replay offline for the issued seed.
