import type { GameConfig } from '../core/gameConfig';
import { FIXED_TICK_RATE, GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../replay/constants';
import type { ReplayEndReason, ReplayRecord } from '../replay/types';
import type { ControlScheme } from './controls';

/**
 * Browser side of the ranked-run protocol (see docs/leaderboard-backend.md). The server issues the seed, the configuration and the time
 * limit; this module only carries them to the game and carries the finished recording back. Nothing here decides what counts as a score.
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
  /** The run ends by itself after this many simulated ticks if the ship is still alive; the server verifies and scores that ending. */
  timeLimitTicks: number;
  issuedAt: string;
  expiresAt: string;
}

export interface VerifiedScore {
  id: string;
  nickname: string;
  score: number;
  /** Stored gameplay rules. Absent on older API responses; never infer an era from that absence. */
  rulesVersion?: string;
  completedAt: string;
  durationSeconds: number;
  endReason?: ReplayEndReason;
}

export interface Ranks {
  allTime: number | null;
  weekly: number | null;
}

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
const realFetch: FetchLike = (u, i) => fetch(u, i);

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

/** The API base for this page, or null when the build has none configured (ranked play and the high scores are then "unavailable"). */
export function getApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  return resolveApiBase(window.location.search, window.location.hostname, import.meta.env.VITE_LEADERBOARD_API_URL);
}

/**
 * `?ranked` is a developer / test shortcut: PLAY then asks the server for a ranked run. Players use the RANKED PLAY button; nothing
 * depends on this flag any more.
 */
export function rankedRequested(search: string): boolean {
  return new URLSearchParams(search).has('ranked');
}

/** The longest ranked run the server will ever issue (20 simulated minutes at 60 Hz). A challenge claiming more is not believed. */
export const RANKED_MAX_TICKS = 20 * 60 * FIXED_TICK_RATE;
const RANKED_MIN_TICKS = 5 * FIXED_TICK_RATE;

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

// --- starting a run ----------------------------------------------------------------------------------------------------------

/** Asks the server for a ranked challenge. Throws RankedApiError; the caller must then NOT start a ranked run. */
export async function requestChallenge(base: string, fetchFn: FetchLike = realFetch): Promise<RankedChallenge> {
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
  if (!Number.isInteger(c.timeLimitTicks) || c.timeLimitTicks < RANKED_MIN_TICKS || c.timeLimitTicks > RANKED_MAX_TICKS) {
    throw new RankedApiError('bad_challenge', 'The ranked service sent an invalid time limit');
  }
  if (!Number.isFinite(Date.parse(c.issuedAt)) || !Number.isFinite(Date.parse(c.expiresAt))) {
    throw new RankedApiError('bad_challenge', 'The ranked service sent an invalid expiry');
  }
  return c;
}

/**
 * When this challenge stops being accepted, in THIS device's clock. The server's expiry is shifted by how far the two clocks disagree
 * at the moment the challenge arrives (latency is a fraction of a second), so a wrong phone clock does not cause a false "expired".
 */
export function localExpiry(challenge: Pick<RankedChallenge, 'issuedAt' | 'expiresAt'>, receivedAtMs: number): number {
  return receivedAtMs + (Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt));
}

// --- submitting --------------------------------------------------------------------------------------------------------------

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | string;
  timeoutMs: number;
  /** Called once when the whole request body has reached the server (it is now verifying). Not every transport can tell. */
  onUploaded?: () => void;
}
export interface HttpResponse {
  status: number;
  body: unknown;
}
/** Resolves with whatever the server answered (any status); rejects only when no answer arrived (offline, timeout, aborted). */
export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/** XMLHttpRequest, not fetch, because only XHR tells the page when the upload has finished: that is the real moment "uploading" becomes "verifying". */
export const xhrTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', req.url);
    for (const [name, value] of Object.entries(req.headers)) xhr.setRequestHeader(name, value);
    xhr.timeout = req.timeoutMs;
    xhr.upload.onload = () => req.onUploaded?.();
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: the status still says what happened */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('network'));
    xhr.send(req.body as XMLHttpRequestBodyInit);
  });

/** The exact bytes of a submission. Built once per run and sent unchanged on every retry, so a lost response can never become a second score. */
export interface PreparedSubmission {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | string;
  /** The nickname inside the body (undefined: none was sent). Frozen with it. */
  nickname: string | undefined;
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

export interface PrepareOptions {
  base: string;
  challenge: RankedChallenge;
  replay: ReplayRecord;
  nickname?: string;
  controls: ControlScheme;
}

/** The replay is sent for the server to re-simulate; no score of the game's own is in the body (the replay's claim is only a cross-check). */
export async function prepareSubmission(opts: PrepareOptions): Promise<PreparedSubmission> {
  const text = JSON.stringify({
    replay: opts.replay,
    ...(opts.nickname ? { nickname: opts.nickname } : {}),
    controls: { scheme: opts.controls },
  });
  const compressed = await gzip(text);
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.challenge.token}`, 'Content-Type': 'application/json' };
  if (compressed) headers['Content-Encoding'] = 'gzip';
  return {
    url: `${opts.base}/api/v1/runs/${encodeURIComponent(opts.challenge.runId)}/submit`,
    headers,
    body: compressed ?? text,
    nickname: opts.nickname || undefined,
  };
}

/** What one request to /submit came to. Only `accepted` makes a score; only `transient` may be sent again (with the same bytes). */
export type SubmitResult =
  | { kind: 'accepted'; score: VerifiedScore; ranks: Ranks; replayed: boolean }
  /** The server replayed the run and did not accept it. Final: the run is spent. */
  | { kind: 'rejected'; reason: string }
  | { kind: 'expired' }
  /** This run was already accepted under a different submission (a different nickname). */
  | { kind: 'already_submitted' }
  /** The run is still open: fix the nickname and send again. */
  | { kind: 'invalid_nickname'; message: string }
  /** No usable answer (offline, timeout, 5xx, rate limit, still being verified). The same bytes may be sent again. */
  | { kind: 'transient'; message: string }
  /** The server refused the request itself (too large, bad credential...). Sending it again cannot help. */
  | { kind: 'refused'; message: string };

const finiteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const rankOrNull = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

function parseAccepted(data: Record<string, unknown>): SubmitResult | null {
  const s = data.score;
  const r = data.ranks;
  if (!isObject(s) || !isObject(r)) return null;
  if (typeof s.id !== 'string' || typeof s.nickname !== 'string' || !finiteNumber(s.score) || typeof s.completedAt !== 'string') return null;
  return {
    kind: 'accepted',
    replayed: data.replayed === true,
    ranks: { allTime: rankOrNull(r.allTime), weekly: rankOrNull(r.weekly) },
    score: {
      id: s.id,
      nickname: s.nickname,
      score: s.score,
      ...(typeof s.rulesVersion === 'string' ? { rulesVersion: s.rulesVersion } : {}),
      completedAt: s.completedAt,
      durationSeconds: finiteNumber(s.durationSeconds) ? s.durationSeconds : 0,
      ...(s.endReason === 'game_over' || s.endReason === 'time_limit' ? { endReason: s.endReason } : {}),
    },
  };
}

export function classifySubmitResponse(res: HttpResponse): SubmitResult {
  const data = isObject(res.body) ? res.body : null;
  const error = data && isObject(data.error) ? data.error : null;
  const code = typeof error?.code === 'string' ? error.code : '';

  if (res.status === 200 && data?.status === 'accepted') {
    return parseAccepted(data) ?? { kind: 'transient', message: 'The ranked service sent an unreadable answer' };
  }
  if (res.status === 422 || code === 'run_rejected') return { kind: 'rejected', reason: typeof error?.reason === 'string' ? error.reason : 'rejected' };
  if (res.status === 410 || code === 'run_expired') return { kind: 'expired' };
  if (code === 'run_already_submitted') return { kind: 'already_submitted' };
  if (code === 'invalid_nickname') return { kind: 'invalid_nickname', message: typeof error?.message === 'string' ? error.message : 'That nickname was not accepted' };
  if (res.status === 429) return { kind: 'transient', message: 'Too many submissions right now; try again in a little while' };
  if (res.status >= 500 || code === 'run_in_progress' || code === 'run_busy') return { kind: 'transient', message: 'The ranked service is busy' };
  return { kind: 'refused', message: `The score was not accepted (${code || res.status})` };
}

export interface SendOptions {
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
  /** Pauses before each automatic repeat after a `transient` answer. Short and finite: the player's Retry button takes over after that. */
  retryDelaysMs?: readonly number[];
  onUploaded?: () => void;
  /** Called with the answer of each attempt that is about to be repeated. */
  onRetrying?: (attempt: number) => void;
  timeoutMs?: number;
}

/**
 * Sends a prepared submission: one request, plus a bounded number of automatic repeats (identical bytes) after a transient failure.
 * Definitive answers (accepted, rejected, expired...) end it at once. Never loops: the last transient result is returned.
 */
export async function sendSubmission(prepared: PreparedSubmission, opts: SendOptions = {}): Promise<SubmitResult> {
  const transport = opts.transport ?? xhrTransport;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = opts.retryDelaysMs ?? [1500, 4000];

  let last: SubmitResult = { kind: 'transient', message: 'The ranked service could not be reached' };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      opts.onRetrying?.(attempt);
      await sleep(delays[attempt - 1]!);
    }
    try {
      const res = await transport({ url: prepared.url, headers: prepared.headers, body: prepared.body, timeoutMs: opts.timeoutMs ?? 30_000, onUploaded: opts.onUploaded });
      last = classifySubmitResponse(res);
    } catch {
      last = { kind: 'transient', message: 'The ranked service could not be reached' };
    }
    if (last.kind !== 'transient') return last;
  }
  return last;
}

// --- reading the boards ------------------------------------------------------------------------------------------------------

export type BoardScope = 'weekly' | 'all-time';

export interface BoardEntry {
  id: string;
  rank: number;
  nickname: string;
  score: number;
  rulesVersion?: string;
  completedAt: string;
  durationSeconds: number;
}

export interface BoardPage {
  scope: BoardScope;
  limit: number;
  offset: number;
  total: number;
  /** Weekly only, straight from the server: the week these entries belong to (so the screen never computes its own). */
  timeZone?: string;
  weekStart?: string;
  weekEnd?: string;
  entries: BoardEntry[];
}

async function getJson(base: string, path: string, fetchFn: FetchLike): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await withTimeout(fetchFn, `${base}/api/v1${path}`, { method: 'GET' }, 10_000);
  } catch {
    throw new RankedApiError('network', 'The leaderboard could not be reached');
  }
  return { status: res.status, body: await json(res) };
}

function parseEntry(v: unknown): BoardEntry | null {
  if (!isObject(v)) return null;
  if (typeof v.id !== 'string' || typeof v.nickname !== 'string' || !finiteNumber(v.score) || !Number.isInteger(v.rank)) return null;
  return {
    id: v.id,
    rank: v.rank as number,
    nickname: v.nickname,
    score: v.score,
    ...(typeof v.rulesVersion === 'string' ? { rulesVersion: v.rulesVersion } : {}),
    completedAt: typeof v.completedAt === 'string' ? v.completedAt : '',
    durationSeconds: finiteNumber(v.durationSeconds) ? v.durationSeconds : 0,
  };
}

/** One page of a public board. The caller renders nicknames as plain text. Throws RankedApiError (network / unavailable / bad_response). */
export async function fetchLeaderboard(base: string, scope: BoardScope, paging: { limit: number; offset: number }, fetchFn: FetchLike = realFetch): Promise<BoardPage> {
  const { status, body } = await getJson(base, `/leaderboard/${scope}?limit=${paging.limit}&offset=${paging.offset}`, fetchFn);
  if (status !== 200) throw new RankedApiError('unavailable', `The leaderboard answered ${status}`);
  if (!isObject(body) || !Array.isArray(body.entries) || !Number.isInteger(body.total)) throw new RankedApiError('bad_response', 'The leaderboard sent an unreadable answer');
  const entries = body.entries.map(parseEntry);
  if (entries.some((e) => e === null)) throw new RankedApiError('bad_response', 'The leaderboard sent an unreadable answer');
  return {
    scope,
    limit: Number.isInteger(body.limit) ? (body.limit as number) : paging.limit,
    offset: Number.isInteger(body.offset) ? (body.offset as number) : paging.offset,
    total: body.total as number,
    ...(typeof body.timeZone === 'string' && { timeZone: body.timeZone }),
    ...(typeof body.weekStart === 'string' && { weekStart: body.weekStart }),
    ...(typeof body.weekEnd === 'string' && { weekEnd: body.weekEnd }),
    entries: entries as BoardEntry[],
  };
}

export interface ScoreDetail {
  score: BoardEntry;
  ranks: Ranks;
}

/** One public score with its authoritative ranks, or null when the server does not (or no longer) lists it. */
export async function fetchScoreDetail(base: string, id: string, fetchFn: FetchLike = realFetch): Promise<ScoreDetail | null> {
  const { status, body } = await getJson(base, `/scores/${encodeURIComponent(id)}`, fetchFn);
  if (status === 404) return null;
  if (status !== 200 || !isObject(body) || !isObject(body.ranks)) throw new RankedApiError('unavailable', `The leaderboard answered ${status}`);
  // `score.rank` is the all-time rank, null (0 here) when the entry is not on that board.
  const s = isObject(body.score) ? body.score : null;
  const entry = s && parseEntry({ ...s, rank: rankOrNull(s.rank) ?? 0 });
  if (!entry) throw new RankedApiError('bad_response', 'The leaderboard sent an unreadable answer');
  return { score: entry, ranks: { allTime: rankOrNull(body.ranks.allTime), weekly: rankOrNull(body.ranks.weekly) } };
}
