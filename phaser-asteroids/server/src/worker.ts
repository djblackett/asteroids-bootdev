import { loadSettings, type Env } from './config';
import { d1Db } from './d1';
import { pruneRateLimits } from './ratelimit';
import { handleRequest } from './router';
import { pruneStaleRuns } from './runs';

/** Cloudflare Worker entry: wires the D1 binding and environment variables into the portable service. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, { db: d1Db(env.DB), settings: loadSettings(env), now: Date.now });
  },

  /** Daily housekeeping (cron trigger in wrangler.toml): drops abandoned runs, old rejected runs and stale rate-limit counters. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const db = d1Db(env.DB);
    const settings = loadSettings(env);
    const now = Date.now();
    const runs = await pruneStaleRuns(db, now);
    const limits = await pruneRateLimits(db, now, settings.rate.windowMs);
    console.log(JSON.stringify({ evt: 'prune', ...runs, rateLimitRows: limits }));
  },
};
