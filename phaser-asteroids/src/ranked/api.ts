import type { GameConfig } from '../core/gameConfig';
import { FIXED_TICK_RATE, GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../replay/constants';
import type { ReplayRecord } from '../replay/types';
import type { ControlScheme } from './controls';

/**
 * Browser side of the ranked-run protocol (see docs/leaderboard-backend.md). The server issues the seed and the configuration;
 * this module only carries them to the game and carries the finished recording back. Nothing here decides what counts as a score.
 */

export interface RankedChallenge {
  runId: string;
  /** Secret that authorises submitting this run. Kept in memory only. */
  token: string;
  seed: number;
  rulesVersion: string;
  schemaVersion: number;
  tickRate: number;
  config: GameConfig;
  issuedAt: string;
  expiresAt: string;
}

export interface VerifiedScore {
  id: string;
  nickname: string;
  score: number;
  completedAt: string;
  durationSeconds: number;
}

export type SubmitOutcome =
  | { kind: 'accepted'; score: VerifiedScore; ranks: { allTime: number | null; weekly: number | null }; replayed: boolean }
  | { kind: 'rejected'; reason: string; message: string }
  | { kind: 'failed'; message: string };

export class RankedApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RankedApiError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** `wrangler dev` default. */
const LOCAL_API = 'http://127.0.0.1:8787';

/**
 * Where the leaderboard API lives. Production builds bake it in as VITE_LEADERBOARD_API_URL. On a loopback host (local development,
 * the browser tests) `?api=<url>` may point at a local backend, and with nothing configured the local `wrangler dev` address is used.
 * Anywhere else a query parameter is ignored: a crafted link cannot redirect a player's run to another server. Null: ranked play is
 * not available in this build.
 */
export function resolveApiBase(search: string, hostname: string, configured?: string): string | null {
  const clean = (u: string) => u.replace(/\/+$/, '');
  const valid = (u: string | null | undefined): string | null => {
    if (!u) return null;
    try {
      const url = new URL(u);
      return url.protocol === 'http:' || url.protocol === 'https:' ? clean(url.origin + url.pathname) : null;
    } catch {
      return null;
    }
  };
  if (LOOPBACK.has(hostname)) return valid(new URLSearchParams(search).get('api')) ?? valid(configured) ?? LOCAL_API;
  return valid(configured);
}

/** Ranked play is a developer / test launch path for now: it is requested with `?ranked`. */
export function rankedRequested(search: string): boolean {
  return new URLSearchParams(search).has('ranked');
}

/** Mirrors the server's ranked limit (20 simulated minutes at 60 Hz); a longer recording would be refused, so it is not sent. */
export const RANKED_MAX_TICKS = 20 * 60 * FIXED_TICK_RATE;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function withTimeout(fetchFn: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the server for a ranked challenge. Throws RankedApiError; the caller must then NOT start a ranked run. */
export async function requestChallenge(base: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<RankedChallenge> {
  let res: Response;
  try {
    res = await withTimeout(fetchFn, `${base}/api/v1/runs`, { method: 'POST' }, 10_000);
  } catch {
    throw new RankedApiError('network', 'The ranked service could not be reached');
  }
  const body = await json(res);
  if (res.status === 429) throw new RankedApiError('rate_limited', 'Too many ranked runs started; try again later');
  if (res.status !== 201 || !isObject(body)) throw new RankedApiError('unavailable', `The ranked service refused the request (${res.status})`);

  const c = body as unknown as RankedChallenge;
  if (typeof c.runId !== 'string' || typeof c.token !== 'string' || !Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff) {
    throw new RankedApiError('bad_challenge', 'The ranked service sent an invalid challenge');
  }
  if (c.rulesVersion !== GAMEPLAY_RULES_VERSION || c.schemaVersion !== REPLAY_SCHEMA_VERSION || c.tickRate !== FIXED_TICK_RATE) {
    throw new RankedApiError('update_required', 'This version of the game does not match the ranked service; reload to update');
  }
  if (!isObject(c.config) || c.config.playerCount !== 1) throw new RankedApiError('bad_challenge', 'The ranked service sent an unsupported configuration');
  return c;
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export interface SubmitOptions {
  base: string;
  challenge: RankedChallenge;
  replay: ReplayRecord;
  nickname?: string;
  controls: ControlScheme;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Waits between attempts after a network error or a retryable server answer. The server treats a repeated identical body as idempotent. */
  retryDelaysMs?: readonly number[];
}

/**
 * Sends the finished recording. The server's answer is the only thing that makes a run count; whatever the game itself computed is
 * not sent as a score (the replay carries its own claim only so the server can cross-check it). Network errors, 5xx, 429 and
 * "still verifying" are retried with the identical body, which the server answers idempotently; definitive refusals are not.
 */
export async function submitRankedRun(opts: SubmitOptions): Promise<SubmitOutcome> {
  const { base, challenge } = opts;
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = opts.retryDelaysMs ?? [1000, 3000, 8000];

  const text = JSON.stringify({
    replay: opts.replay,
    ...(opts.nickname ? { nickname: opts.nickname } : {}),
    controls: { scheme: opts.controls },
  });
  const compressed = await gzip(text);
  const headers: Record<string, string> = { Authorization: `Bearer ${challenge.token}`, 'Content-Type': 'application/json' };
  if (compressed) headers['Content-Encoding'] = 'gzip';
  const body = (compressed ?? text) as BodyInit;
  const url = `${base}/api/v1/runs/${encodeURIComponent(challenge.runId)}/submit`;

  let lastProblem = 'The ranked service could not be reached';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]!);
    let res: Response;
    try {
      res = await withTimeout(fetchFn, url, { method: 'POST', headers, body }, 30_000);
    } catch {
      lastProblem = 'The ranked service could not be reached';
      continue;
    }
    const data = await json(res);
    const error = isObject(data) && isObject(data.error) ? data.error : null;
    const code = typeof error?.code === 'string' ? error.code : '';

    if (res.status === 200 && isObject(data) && data.status === 'accepted') {
      return { kind: 'accepted', score: data.score as VerifiedScore, ranks: data.ranks as { allTime: number | null; weekly: number | null }, replayed: data.replayed === true };
    }
    if (res.status === 422 || code === 'run_rejected') {
      const reason = typeof error?.reason === 'string' ? error.reason : 'rejected';
      return { kind: 'rejected', reason, message: 'The server could not verify this score' };
    }
    if (res.status === 410) return { kind: 'failed', message: 'This ranked run expired before it was submitted' };
    if (res.status === 429 || res.status >= 500 || code === 'run_in_progress' || code === 'run_busy') {
      lastProblem = res.status === 429 ? 'Too many submissions; try again later' : 'The ranked service is busy';
      continue;
    }
    return { kind: 'failed', message: `The score was not accepted (${code || res.status})` };
  }
  return { kind: 'failed', message: lastProblem };
}
