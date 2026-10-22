import type { GameConfig } from '../../src/core/gameConfig';
import { FIXED_TICK_RATE, GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../../src/replay/constants';
import type { D1Like } from './d1';

/**
 * The only gameplay configuration a ranked run may use: the classic one-player game. The server issues it with every
 * challenge and compares it to the replay header; the browser never gets to choose any part of it.
 */
export const RANKED_CONFIG: Readonly<GameConfig> = Object.freeze({
  playerCount: 1,
  livesMode: 'independent',
  friendlyFire: false,
  speed: Object.freeze([1, 1]) as unknown as readonly [number, number],
});

export const RANKED_RULES_VERSION = GAMEPLAY_RULES_VERSION;
export const RANKED_SCHEMA_VERSION = REPLAY_SCHEMA_VERSION;
export const RANKED_TICK_RATE = FIXED_TICK_RATE;

/** Bindings and variables the Worker receives (see wrangler.toml). Everything except `DB` is optional so local runs need no setup. */
export interface Env {
  DB: D1Like;
  /** Comma-separated browser origins allowed to call the API, e.g. `https://djblackett.github.io`. Empty: no browser origin is allowed. */
  ALLOWED_ORIGINS?: string;
  /** Bearer secret for /api/v1/admin/*. Unset (or shorter than 16 characters): the admin routes do not exist. Set with `wrangler secret put ADMIN_TOKEN`. */
  ADMIN_TOKEN?: string;
  /** Secret salt for hashing client IPs into rate-limit buckets. Set with `wrangler secret put IP_HASH_SALT`. */
  IP_HASH_SALT?: string;
  RUN_TTL_SECONDS?: string;
  /** Length of a ranked run in simulated seconds: a run still alive then ends by itself (see verify.ts). 5-1200, default 1200. Lower only for tests. */
  RANKED_TIME_LIMIT_SECONDS?: string;
  START_PER_IP_PER_HOUR?: string;
  SUBMIT_PER_IP_PER_HOUR?: string;
  START_GLOBAL_PER_HOUR?: string;
  SUBMIT_GLOBAL_PER_HOUR?: string;
}

export interface ServerSettings {
  rulesVersion: string;
  /** How long after issue a run can still be submitted. Covers a maximum-length run plus pauses and tab suspension. */
  runTtlMs: number;
  /** A run being verified is "claimed"; a claim older than this is considered abandoned (the Worker died) and can be taken over. */
  claimLeaseMs: number;
  /** A replay may not claim more simulated time than has really elapsed since the challenge was issued, plus this tolerance. */
  elapsedSlackMs: number;
  /** Request body limits. Compressed applies to Content-Encoding: gzip on the wire; body applies to the decoded JSON text. */
  maxCompressedBytes: number;
  maxBodyBytes: number;
  /**
   * Time limit in ticks for newly issued challenges. Existing runs retain their persisted limit;
   * MAX_RANKED_TICKS is the independent, fixed bound on ranked simulation work.
   */
  maxTicks: number;
  rate: {
    windowMs: number;
    startPerIp: number;
    submitPerIp: number;
    startGlobal: number;
    submitGlobal: number;
    adminFailuresPerIp: number;
  };
  page: { defaultLimit: number; maxLimit: number; maxOffset: number };
  timeZone: string;
  allowedOrigins: readonly string[];
  adminToken: string | null;
  ipHashSalt: string;
}

const MIB = 1024 * 1024;
export const MAX_TIME_LIMIT_SECONDS = 20 * 60;
export const MAX_RANKED_TICKS = MAX_TIME_LIMIT_SECONDS * RANKED_TICK_RATE;
const MIN_TIME_LIMIT_SECONDS = 5;

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function loadSettings(env: Partial<Omit<Env, 'DB'>> = {}): ServerSettings {
  return {
    rulesVersion: RANKED_RULES_VERSION,
    runTtlMs: intFromEnv(env.RUN_TTL_SECONDS, 3600, 60, 86_400) * 1000,
    claimLeaseMs: 30_000,
    elapsedSlackMs: 2_000,
    maxCompressedBytes: 1 * MIB,
    maxBodyBytes: 8 * MIB,
    // 72,000 ticks = 20 simulated minutes. The environment may only shorten it: the CPU, memory and body-size budgets in this file were
    // sized for this value.
    maxTicks: intFromEnv(env.RANKED_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS, MIN_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS) * RANKED_TICK_RATE,
    rate: {
      windowMs: 3_600_000,
      startPerIp: intFromEnv(env.START_PER_IP_PER_HOUR, 30, 1, 100_000),
      submitPerIp: intFromEnv(env.SUBMIT_PER_IP_PER_HOUR, 30, 1, 100_000),
      startGlobal: intFromEnv(env.START_GLOBAL_PER_HOUR, 3000, 1, 10_000_000),
      submitGlobal: intFromEnv(env.SUBMIT_GLOBAL_PER_HOUR, 1200, 1, 10_000_000),
      adminFailuresPerIp: 10,
    },
    page: { defaultLimit: 10, maxLimit: 100, maxOffset: 1000 },
    timeZone: 'America/Halifax',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 ? env.ADMIN_TOKEN : null,
    ipHashSalt: env.IP_HASH_SALT ?? 'dev-only-salt',
  };
}
