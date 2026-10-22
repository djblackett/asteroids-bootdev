import type { GameConfig } from '../../src/core/gameConfig';
import { RANKED_CONFIG, RANKED_SCHEMA_VERSION, RANKED_TICK_RATE, type ServerSettings } from './config';
import { constantTimeEqual, randomId, randomSeed, randomToken, sha256Hex } from './crypto';
import type { Db } from './db';
import { ApiError } from './errors';
import { getScoreRow, rankOf, type PublicScore } from './leaderboard';
import { sanitizeNickname } from './nickname';
import { verifyRankedReplay, type IssuedRunFacts, type RankedVerdict } from './verify';

/**
 * Ranked run lifecycle (see migrations/0001_init.sql for the table):
 *
 *   issued --claim--> verifying --finalize--> accepted   (terminal; exactly one scores row)
 *                          |   \-finalize--> rejected    (terminal; the replay failed verification)
 *                          \--release--> issued          (only when the claimant hit an internal error, so the player may retry)
 *
 * Every arrow is ONE conditional statement (or one batch) whose WHERE clause names the state it expects, so under any number of
 * simultaneous requests, on any number of Worker instances, the database lets exactly one of them make each move.
 */

export interface ServiceDeps {
  db: Db;
  settings: ServerSettings;
  now: () => number;
  /** Replaceable in tests only; production always uses verifyRankedReplay. */
  verify?: (replay: unknown, run: IssuedRunFacts, now: number, settings: ServerSettings) => RankedVerdict;
}

export interface IssuedRun {
  runId: string;
  /** Secret that authorises submitting this run. Shown once; only its hash is stored. */
  token: string;
  seed: number;
  rulesVersion: string;
  schemaVersion: number;
  tickRate: number;
  config: GameConfig;
  issuedAt: string;
  expiresAt: string;
}

interface RunRow {
  id: string;
  token_hash: string;
  seed: number;
  rules_version: string;
  config_json: string;
  created_at: number;
  expires_at: number;
  status: 'issued' | 'verifying' | 'accepted' | 'rejected';
  claim_token: string | null;
  claimed_at: number | null;
  replay_hash: string | null;
  finished_at: number | null;
  score_id: string | null;
  reject_reason: string | null;
  reject_detail: string | null;
}

export interface AcceptedSubmission {
  status: 'accepted';
  /** True when this response repeats an earlier acceptance of the identical body (a retry after a lost response). */
  replayed: boolean;
  score: Omit<PublicScore, 'rank'>;
  ranks: { allTime: number | null; weekly: number | null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Control categories the client may report. Informational and untrusted: never used to rank or to accept. */
export const REPORTED_CONTROLS = ['keyboard', 'gamepad', 'touch-classic', 'touch-point', 'touch-assisted', 'mixed', 'unknown'] as const;

export function sanitizeControls(input: unknown): string {
  const scheme = input && typeof input === 'object' ? (input as { scheme?: unknown }).scheme : input;
  return typeof scheme === 'string' && (REPORTED_CONTROLS as readonly string[]).includes(scheme) ? scheme : 'unknown';
}

// --- issuing ---------------------------------------------------------------------------------------------------------------

export async function createRun(deps: ServiceDeps, issuerHash: string | null): Promise<IssuedRun> {
  const { db, settings } = deps;
  const now = deps.now();
  const run: IssuedRun = {
    runId: randomId(),
    token: randomToken(),
    seed: randomSeed(),
    rulesVersion: settings.rulesVersion,
    schemaVersion: RANKED_SCHEMA_VERSION,
    tickRate: RANKED_TICK_RATE,
    config: { ...RANKED_CONFIG, speed: [...RANKED_CONFIG.speed] as [number, number] },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + settings.runTtlMs).toISOString(),
  };
  await db.run(
    `INSERT INTO runs (id, token_hash, seed, rules_version, config_json, created_at, expires_at, status, issuer_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
    [run.runId, await sha256Hex(run.token), run.seed, run.rulesVersion, JSON.stringify(run.config), now, now + settings.runTtlMs, issuerHash],
  );
  return run;
}

// --- submitting ------------------------------------------------------------------------------------------------------------

export interface SubmitInput {
  runId: string;
  /** The bearer token from the Authorization header, or null if absent. */
  token: string | null;
  /** Reads the (size-bounded) body. Called only after the run and its token have been checked. */
  readBody: () => Promise<Uint8Array>;
}

const loadRun = (db: Db, id: string) => db.first<RunRow>('SELECT * FROM runs WHERE id = ?', [id]);

export async function submitRun(deps: ServiceDeps, input: SubmitInput): Promise<AcceptedSubmission> {
  const { db, settings } = deps;

  // 1. Cheap checks that never touch the body: does the run exist, is the caller entitled to it, is it still open?
  if (!UUID.test(input.runId)) throw new ApiError(404, 'run_not_found', 'No such run');
  const run = await loadRun(db, input.runId);
  if (!run) throw new ApiError(404, 'run_not_found', 'No such run');
  if (!input.token || !constantTimeEqual(await sha256Hex(input.token), run.token_hash)) {
    throw new ApiError(401, 'invalid_token', 'Missing or invalid run token');
  }
  if (run.status === 'rejected') throw rejectedError(run);
  if (run.status === 'issued' && run.expires_at <= deps.now()) throw expiredError();

  // 2. Read and hash the body. Problems up to and including step 3 are about the transport or the envelope, not about the play
  //    itself, so they do not consume the run: the client can fix or repeat the request.
  const body = await input.readBody();
  const replayHash = await sha256Hex(body);

  if (run.status === 'accepted') return acceptedAgain(deps, run, replayHash);

  // 3. Envelope: JSON object with a replay object, an optional nickname and optional reported controls.
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new ApiError(400, 'invalid_json', 'Body is not valid UTF-8 JSON');
  }
  if (!isRecord(payload) || !isRecord(payload.replay)) {
    throw new ApiError(400, 'invalid_submission', 'Body must be a JSON object with a "replay" object');
  }
  const nickname = sanitizeNickname(payload.nickname);
  if (!nickname.ok) throw new ApiError(400, 'invalid_nickname', nickname.message);
  const controls = sanitizeControls(payload.controls);

  // 4. Claim. From here the outcome is decided by the database: exactly one concurrent request can win this UPDATE.
  const claimToken = randomId();
  const claimedAt = deps.now();
  const claim = await db.run(
    `UPDATE runs SET status = 'verifying', claim_token = ?, claimed_at = ?, replay_hash = ?
     WHERE id = ? AND expires_at > ? AND (status = 'issued' OR (status = 'verifying' AND claimed_at <= ?))`,
    [claimToken, claimedAt, replayHash, run.id, claimedAt, claimedAt - settings.claimLeaseMs],
  );
  if (claim.changes !== 1) return resolveLostClaim(deps, run.id, replayHash);

  // 5. Verify and finalize. Any request that holds the claim must leave the run accepted, rejected, or released.
  try {
    let verdict: RankedVerdict;
    try {
      const facts: IssuedRunFacts = {
        seed: run.seed,
        rulesVersion: run.rules_version,
        config: JSON.parse(run.config_json) as GameConfig,
        createdAt: run.created_at,
      };
      verdict = (deps.verify ?? verifyRankedReplay)(payload.replay, facts, claimedAt, settings);
    } catch (e) {
      // A replay that crashes the verifier cannot be scored. Treat it as a rejection (not a retryable error) so a crafted
      // payload cannot be resubmitted indefinitely; the stack trace goes to the operator's logs.
      console.error(JSON.stringify({ evt: 'verifier_threw', run: run.id, error: String(e) }));
      verdict = { ok: false, code: 'invalid_replay', detail: 'verification could not complete' };
    }

    if (!verdict.ok) {
      await db.run(
        `UPDATE runs SET status = 'rejected', claim_token = NULL, finished_at = ?, reject_reason = ?, reject_detail = ?
         WHERE id = ? AND status = 'verifying' AND claim_token = ?`,
        [deps.now(), verdict.code, verdict.detail.slice(0, 300), run.id, claimToken],
      );
      console.warn(JSON.stringify({ evt: 'run_rejected', run: run.id, reason: verdict.code }));
      throw new ApiError(422, 'replay_rejected', 'The replay did not verify', { status: 'rejected', reason: verdict.code, detail: verdict.detail.slice(0, 300) });
    }

    const result = verdict.result;
    const scoreId = randomId();
    const completedAt = deps.now();
    const row = [
      scoreId,
      run.id,
      result.calculatedScore,
      nickname.value,
      completedAt,
      run.rules_version,
      result.totalTicks,
      Math.round(result.simulatedDuration * 1000),
      result.stats.asteroidsDestroyed,
      result.stats.ufosDestroyed,
      controls,
    ];
    const [inserted, updated] = await db.batch([
      {
        sql: `INSERT INTO scores (id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms,
                                  asteroids_destroyed, ufos_destroyed, reported_controls)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM runs WHERE id = ? AND status = 'verifying' AND claim_token = ?)`,
        params: [...row, run.id, claimToken],
      },
      {
        sql: `UPDATE runs SET status = 'accepted', claim_token = NULL, finished_at = ?, score_id = ?
              WHERE id = ? AND status = 'verifying' AND claim_token = ?`,
        params: [completedAt, scoreId, run.id, claimToken],
      },
    ]);
    if (inserted?.changes !== 1 || updated?.changes !== 1) return resolveLostClaim(deps, run.id, replayHash);

    return await buildAccepted(deps, scoreId, false);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Internal failure (database unavailable, bug): give the claim back so the player can retry, and never leave a score behind.
    console.error(JSON.stringify({ evt: 'submit_failed', run: run.id, error: String(e) }));
    await db
      .run(
        `UPDATE runs SET status = 'issued', claim_token = NULL, claimed_at = NULL, replay_hash = NULL
         WHERE id = ? AND status = 'verifying' AND claim_token = ?`,
        [run.id, claimToken],
      )
      .catch(() => undefined); // if even this fails, the claim lease lets a later request take over
    throw new ApiError(503, 'service_unavailable', 'The score could not be recorded; please retry', {}, { 'Retry-After': '5' });
  }
}

/** We did not win the claim (or lost it before finalizing): report what actually happened to the run. */
async function resolveLostClaim(deps: ServiceDeps, runId: string, replayHash: string): Promise<AcceptedSubmission> {
  const current = await loadRun(deps.db, runId);
  if (!current) throw new ApiError(404, 'run_not_found', 'No such run');
  switch (current.status) {
    case 'accepted':
      return acceptedAgain(deps, current, replayHash);
    case 'rejected':
      throw rejectedError(current);
    case 'verifying':
      throw new ApiError(409, 'run_in_progress', 'This run is being verified by another request; retry shortly', {}, { 'Retry-After': '2' });
    default:
      // Back to 'issued' means expiry (otherwise our claim would have succeeded) or a release race.
      if (current.expires_at <= deps.now()) throw expiredError();
      throw new ApiError(409, 'run_busy', 'The run changed state during submission; retry', {}, { 'Retry-After': '1' });
  }
}

async function acceptedAgain(deps: ServiceDeps, run: RunRow, replayHash: string): Promise<AcceptedSubmission> {
  if (run.replay_hash !== replayHash || !run.score_id) {
    throw new ApiError(409, 'run_already_submitted', 'This run has already been submitted and accepted');
  }
  return buildAccepted(deps, run.score_id, true);
}

async function buildAccepted(deps: ServiceDeps, scoreId: string, replayed: boolean): Promise<AcceptedSubmission> {
  const { db, settings } = deps;
  const row = await getScoreRow(db, scoreId);
  if (!row) throw new Error(`accepted run references missing score ${scoreId}`);
  const now = deps.now();
  const visible = row.visibility === 'visible';
  const [allTime, weekly] = visible
    ? await Promise.all([rankOf(db, settings, now, 'all-time', row), rankOf(db, settings, now, 'weekly', row)])
    : [null, null];
  return {
    status: 'accepted',
    replayed,
    score: {
      id: row.id,
      nickname: row.nickname,
      score: row.score,
      completedAt: new Date(row.completed_at).toISOString(),
      durationSeconds: Math.round(row.duration_ms / 10) / 100,
    },
    ranks: { allTime, weekly },
  };
}

const expiredError = () => new ApiError(410, 'run_expired', 'This ranked run has expired; start a new one');
const rejectedError = (run: RunRow) =>
  new ApiError(409, 'run_rejected', 'This run was already submitted and rejected', { status: 'rejected', reason: run.reject_reason });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// --- housekeeping & moderation ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Deletes data that can no longer matter. Accepted runs are kept (their scores reference them). */
export async function pruneStaleRuns(db: Db, now: number): Promise<{ abandoned: number; rejected: number }> {
  const abandoned = await db.run(`DELETE FROM runs WHERE status IN ('issued', 'verifying') AND expires_at < ?`, [now - DAY_MS]);
  const rejected = await db.run(`DELETE FROM runs WHERE status = 'rejected' AND finished_at < ?`, [now - 30 * DAY_MS]);
  return { abandoned: abandoned.changes, rejected: rejected.changes };
}

export async function setScoreVisibility(db: Db, scoreId: string, visible: boolean, reason: string | null, now: number): Promise<boolean> {
  const res = await db.run(
    visible
      ? `UPDATE scores SET visibility = 'visible', hidden_reason = NULL, hidden_at = NULL WHERE id = ?`
      : `UPDATE scores SET visibility = 'hidden', hidden_reason = ?, hidden_at = ? WHERE id = ?`,
    visible ? [scoreId] : [reason ? reason.slice(0, 200) : null, now, scoreId],
  );
  return res.changes === 1;
}
