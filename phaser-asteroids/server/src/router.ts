import { RANKED_SCHEMA_VERSION, RANKED_TICK_RATE } from './config';
import { constantTimeEqual, sha256Hex } from './crypto';
import { readBoundedBody } from './body';
import { ApiError } from './errors';
import { getLeaderboard, getScoreDetail, type Scope } from './leaderboard';
import { hitRateLimit } from './ratelimit';
import { createRun, setScoreVisibility, submitRun, type ServiceDeps } from './runs';

const API = '/api/v1';

/**
 * The whole HTTP surface, as a plain Web `Request` -> `Response` function with no Cloudflare types, so it runs unchanged in a
 * Worker, in Node (tests) or behind any other fetch-style host.
 *
 *   GET  /api/v1/health
 *   POST /api/v1/runs                              issue a ranked challenge
 *   POST /api/v1/runs/:id/submit                   submit the recording for that challenge (Bearer run token)
 *   GET  /api/v1/leaderboard/all-time|weekly       ?limit=&offset=
 *   GET  /api/v1/scores/:id                        one entry with its ranks
 *   POST /api/v1/admin/scores/:id/visibility       hide / unhide (Bearer ADMIN_TOKEN; absent unless configured)
 */
export async function handleRequest(request: Request, deps: ServiceDeps): Promise<Response> {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const isAdmin = url.pathname.startsWith(`${API}/admin/`);
  const cors = isAdmin ? {} : corsHeaders(origin, deps);

  try {
    if (request.method === 'OPTIONS') return preflight(cors);
    const res = await route(request, url, origin, deps);
    return withHeaders(res, cors);
  } catch (e) {
    if (e instanceof ApiError) {
      return withHeaders(
        json({ error: { code: e.code, message: e.message, ...e.extra } }, e.status, { 'Cache-Control': 'no-store', ...e.headers }),
        cors,
      );
    }
    console.error(JSON.stringify({ evt: 'unhandled', path: url.pathname, error: String(e) }));
    return withHeaders(json({ error: { code: 'internal_error', message: 'Unexpected server error' } }, 500, { 'Cache-Control': 'no-store' }), cors);
  }
}

async function route(request: Request, url: URL, origin: string | null, deps: ServiceDeps): Promise<Response> {
  const { settings } = deps;
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === `${API}/health`) {
    only(method, 'GET');
    return json({ ok: true, rulesVersion: settings.rulesVersion, schemaVersion: RANKED_SCHEMA_VERSION, maxTicks: settings.maxTicks, timeLimitSeconds: settings.maxTicks / RANKED_TICK_RATE, time: new Date(deps.now()).toISOString() });
  }

  if (path === `${API}/runs`) {
    only(method, 'POST');
    requireAllowedOrigin(origin, deps);
    const ipHash = await clientHash(request, deps);
    await hitRateLimit(deps.db, `start:ip:${ipHash}`, settings.rate.startPerIp, settings.rate.windowMs, deps.now());
    await hitRateLimit(deps.db, 'start:global', settings.rate.startGlobal, settings.rate.windowMs, deps.now());
    const run = await createRun(deps, ipHash);
    return json(run, 201, { 'Cache-Control': 'no-store' });
  }

  const submit = /^\/api\/v1\/runs\/([^/]+)\/submit$/.exec(path);
  if (submit) {
    only(method, 'POST');
    requireAllowedOrigin(origin, deps);
    const ipHash = await clientHash(request, deps);
    // Throttle before doing any work, so an abusive client cannot make us spend CPU. The global bucket is the hard ceiling on
    // how much replay verification the service will perform per hour.
    await hitRateLimit(deps.db, `submit:ip:${ipHash}`, settings.rate.submitPerIp, settings.rate.windowMs, deps.now());
    await hitRateLimit(deps.db, 'submit:global', settings.rate.submitGlobal, settings.rate.windowMs, deps.now());
    const result = await submitRun(deps, {
      runId: submit[1]!,
      token: bearer(request),
      readBody: () => readBoundedBody(request, settings),
    });
    return json(result, 200, { 'Cache-Control': 'no-store' });
  }

  const board = /^\/api\/v1\/leaderboard\/(all-time|weekly)$/.exec(path);
  if (board) {
    only(method, 'GET');
    const limit = intParam(url, 'limit', settings.page.defaultLimit, 1, settings.page.maxLimit);
    const offset = intParam(url, 'offset', 0, 0, settings.page.maxOffset);
    const page = await getLeaderboard(deps.db, settings, deps.now(), board[1] as Scope, limit, offset);
    return json(page, 200, { 'Cache-Control': 'public, max-age=5' });
  }

  const score = /^\/api\/v1\/scores\/([^/]+)$/.exec(path);
  if (score) {
    only(method, 'GET');
    const detail = await getScoreDetail(deps.db, settings, deps.now(), score[1]!);
    if (!detail) throw new ApiError(404, 'score_not_found', 'No such score');
    return json(detail, 200, { 'Cache-Control': 'public, max-age=5' });
  }

  const visibility = /^\/api\/v1\/admin\/scores\/([^/]+)\/visibility$/.exec(path);
  if (visibility && settings.adminToken) {
    only(method, 'POST');
    await requireAdmin(request, deps);
    const body = await readJsonObject(request);
    if (typeof body.visible !== 'boolean') throw new ApiError(400, 'invalid_request', '"visible" must be true or false');
    const reason = typeof body.reason === 'string' ? body.reason : null;
    const changed = await setScoreVisibility(deps.db, visibility[1]!, body.visible, reason, deps.now());
    if (!changed) throw new ApiError(404, 'score_not_found', 'No such score');
    return json({ id: visibility[1], visible: body.visible }, 200, { 'Cache-Control': 'no-store' });
  }

  throw new ApiError(404, 'not_found', 'No such route');
}

// --- helpers ---------------------------------------------------------------------------------------------------------------

function only(method: string, allowed: string): void {
  if (method !== allowed) throw new ApiError(405, 'method_not_allowed', `Use ${allowed}`, {}, { Allow: allowed });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return m ? m[1]! : null;
}

async function clientHash(request: Request, deps: ServiceDeps): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return (await sha256Hex(`${deps.settings.ipHashSalt}|${ip}`)).slice(0, 32);
}

async function requireAdmin(request: Request, deps: ServiceDeps): Promise<void> {
  const token = bearer(request);
  const expected = deps.settings.adminToken!;
  const ok = !!token && constantTimeEqual(await sha256Hex(token), await sha256Hex(expected));
  if (ok) return;
  await hitRateLimit(deps.db, `admin-fail:${await clientHash(request, deps)}`, deps.settings.rate.adminFailuresPerIp, deps.settings.rate.windowMs, deps.now());
  throw new ApiError(401, 'unauthorized', 'Admin credentials required');
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(request, { maxCompressedBytes: 4096, maxBodyBytes: 4096 });
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'invalid_json', 'Body must be a JSON object');
}

function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new ApiError(400, 'invalid_parameter', `"${name}" must be an integer from ${min} to ${max}`);
  }
  return n;
}

/**
 * Browsers always send Origin on cross-origin POSTs. One that is not on the allow-list is refused outright (a stray site cannot make a
 * visitor's browser burn rate limit or request challenges). Requests with no Origin (curl, scripts, tests) are fine: this is
 * hygiene, not authentication, since anyone can call the API directly.
 */
function requireAllowedOrigin(origin: string | null, deps: ServiceDeps): void {
  if (origin && !deps.settings.allowedOrigins.includes(origin)) {
    throw new ApiError(403, 'origin_not_allowed', 'This origin may not use the ranked API');
  }
}

function corsHeaders(origin: string | null, deps: ServiceDeps): Record<string, string> {
  if (!origin || !deps.settings.allowedOrigins.includes(origin)) return { Vary: 'Origin' };
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function preflight(cors: Record<string, string>): Response {
  if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403, headers: cors });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Encoding',
      'Access-Control-Max-Age': '600',
    },
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: res.status, headers });
}
