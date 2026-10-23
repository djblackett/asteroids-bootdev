import { gzipSync } from 'node:zlib';
import * as engine from '../../src/replay';
import type { ReplayRecord } from '../../src/replay';
import { loadSettings, type ServerSettings } from '../src/config';
import type { Db } from '../src/db';
import { handleRequest } from '../src/router';
import type { IssuedRun, ServiceDeps } from '../src/runs';
import { generateBotReplay, type BotOptions, type BotRun } from '../testing/bot.mjs';
import { openSqliteDb, type SqliteDb } from '../testing/sqliteDb';

export const T0 = Date.UTC(2026, 9, 22, 15, 0, 0); // Thu 2026-10-22 12:00 in Halifax (ADT)

export interface Clock {
  t: number;
  now: () => number;
  advance: (ms: number) => void;
}

export function makeClock(start = T0): Clock {
  const clock: Clock = { t: start, now: () => clock.t, advance: (ms) => void (clock.t += ms) };
  return clock;
}

const botCache = new Map<string, BotRun>();

/** Genuine game-over-terminated replay for `seed`, from the shared autonomous bot. Cached: generation costs 50-400 ms. */
export function botRun(seed: number, opts: Omit<BotOptions, 'seed'> = {}): BotRun {
  const key = `${seed}:${JSON.stringify(opts)}`;
  let run = botCache.get(key);
  if (!run) {
    run = generateBotReplay(engine, { seed, ...opts });
    botCache.set(key, run);
  }
  return structuredClone(run);
}

/** 2-minute game, score 9114 (the Phase 1 reference run). */
export const REFERENCE_SEED = 54321;

export interface Harness {
  db: SqliteDb;
  clock: Clock;
  settings: ServerSettings;
  deps: ServiceDeps;
  /** Sends a request through the real router. */
  call: (method: string, path: string, init?: CallInit) => Promise<ApiResponse>;
  /** POST /runs, optionally rewriting the server-chosen seed in the DB so a cached replay can be reused (test-only shortcut). */
  start: (opts?: { seed?: number; ip?: string }) => Promise<IssuedRun>;
  /** Submits a replay for `run` as a well-behaved client would. */
  submit: (run: IssuedRun, replay: unknown, extra?: SubmitExtra) => Promise<ApiResponse>;
  /** Advances the clock as if the replay had been played in real time, then submits. */
  playAndSubmit: (run: IssuedRun, replay: ReplayRecord, extra?: SubmitExtra) => Promise<ApiResponse>;
}

export interface CallInit {
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
  ip?: string;
  token?: string;
}

export interface SubmitExtra {
  nickname?: unknown;
  controls?: unknown;
  token?: string | null;
  gzip?: boolean;
  /** Replaces the whole serialized body. */
  rawBody?: string | Uint8Array;
  ip?: string;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: any;
}

export function makeHarness(opts: { db?: SqliteDb; clock?: Clock; settings?: Partial<ServerSettings>; dbWrap?: (db: Db) => Db } = {}): Harness {
  const db = opts.db ?? openSqliteDb();
  const clock = opts.clock ?? makeClock();
  const settings: ServerSettings = { ...loadSettings({ ADMIN_TOKEN: 'test-admin-token-1234567890', IP_HASH_SALT: 'test-salt' }), ...opts.settings };
  const deps: ServiceDeps = { db: opts.dbWrap ? opts.dbWrap(db) : db, settings, now: clock.now };

  const call: Harness['call'] = async (method, path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.ip) headers.set('cf-connecting-ip', init.ip);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    let body = init.body ?? null;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set('content-type', 'application/json');
    }
    const res = await handleRequest(new Request(`https://api.test${path}`, { method, headers, body }), deps);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, body: parsed };
  };

  const start: Harness['start'] = async ({ seed, ip } = {}) => {
    const res = await call('POST', '/api/v1/runs', { ip: ip ?? '203.0.113.7' });
    if (res.status !== 201) throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
    const run = res.body as IssuedRun;
    if (seed !== undefined) {
      await db.run('UPDATE runs SET seed = ? WHERE id = ?', [seed, run.runId]);
      run.seed = seed;
    }
    return run;
  };

  const submit: Harness['submit'] = (run, replay, extra = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    let body: BodyInit;
    if (extra.rawBody !== undefined) body = extra.rawBody as BodyInit;
    else {
      const json = JSON.stringify({ replay, nickname: extra.nickname, controls: extra.controls });
      body = json;
    }
    if (extra.gzip) {
      body = gzipSync(typeof body === 'string' ? Buffer.from(body) : (body as Uint8Array)) as unknown as BodyInit;
      headers['content-encoding'] = 'gzip';
    }
    const token = extra.token === undefined ? run.token : extra.token;
    return call('POST', `/api/v1/runs/${run.runId}/submit`, { headers, body, token: token ?? undefined, ip: extra.ip ?? '203.0.113.7' });
  };

  const playAndSubmit: Harness['playAndSubmit'] = (run, replay, extra) => {
    clock.advance((replay.totalTicks / 60) * 1000 + 1500);
    return submit(run, replay, extra);
  };

  return { db, clock, settings, deps, call, start, submit, playAndSubmit };
}

/** Inserts an accepted run + score directly (for leaderboard tests that need many rows quickly). */
export async function insertScore(
  db: Db,
  s: { id?: string; score: number; nickname?: string; completedAt: number; rules?: string; visibility?: 'visible' | 'hidden' },
): Promise<string> {
  const id = s.id ?? crypto.randomUUID();
  const runId = crypto.randomUUID();
  await db.batch([
    {
      sql: `INSERT INTO runs (id, token_hash, seed, rules_version, config_json, created_at, expires_at, status, finished_at, score_id)
            VALUES (?, 'x', 1, ?, '{}', ?, ?, 'accepted', ?, ?)`,
      params: [runId, s.rules ?? '1.0.0', s.completedAt - 60_000, s.completedAt + 3_600_000, s.completedAt, id],
    },
    {
      sql: `INSERT INTO scores (id, run_id, score, nickname, completed_at, rules_version, ticks, duration_ms, visibility)
            VALUES (?, ?, ?, ?, ?, ?, 3600, 60000, ?)`,
      params: [id, runId, s.score, s.nickname ?? 'Tester', s.completedAt, s.rules ?? '1.0.0', s.visibility ?? 'visible'],
    },
  ]);
  return id;
}

export const count = async (db: Db, table: string, where = '1=1'): Promise<number> =>
  (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))!.n;
