import { loadSettings, type Env } from './config';
import { d1Db } from './d1';
import { handleRequest } from './router';
import { runScheduled } from './scheduled';

/** Cloudflare Worker entry: wires the D1 binding and environment variables into the portable service. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, { db: d1Db(env.DB), settings: loadSettings(env), now: Date.now });
  },

  /**
   * Daily cron (wrangler.toml): drops abandoned runs, old rejected runs, stale rate-limit counters and expired reports, then sends
   * the moderation digest if it is configured and something needs review (see scheduled.ts / digest.ts).
   */
  async scheduled(event: { scheduledTime?: number } | undefined, env: Env): Promise<void> {
    const now = Date.now();
    await runScheduled(d1Db(env.DB), env, now, event?.scheduledTime ?? now);
  },
};
