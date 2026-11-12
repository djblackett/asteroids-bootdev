import { loadSettings, type Env } from './config';
import type { Db } from './db';
import { runModerationDigest, type DigestOutcome, type Sender } from './digest';
import { pruneReports } from './moderation';
import { pruneRateLimits } from './ratelimit';
import { pruneStaleRuns } from './runs';

export interface ScheduledOptions {
  send?: Sender;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (entry: Record<string, unknown>) => void;
}

/**
 * The daily cron (wrangler.toml). Housekeeping first, exactly as before; then the moderation digest, which never throws. A cleanup
 * failure still fails the invocation (after the digest has had its chance), so it remains visible in the Cron Events history.
 */
export async function runScheduled(db: Db, env: Omit<Env, 'DB'>, now: number, scheduledTime: number, opts: ScheduledOptions = {}): Promise<DigestOutcome> {
  const log = opts.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const settings = loadSettings(env);
  let cleanupError: unknown = null;
  let expiredUnresolved = 0;
  try {
    const runs = await pruneStaleRuns(db, now);
    const limits = await pruneRateLimits(db, now, settings.rate.windowMs);
    const reports = await pruneReports(db, now);
    expiredUnresolved = reports.unresolved;
    log({ evt: 'prune', ...runs, rateLimitRows: limits, reportRows: reports.deleted, unresolvedReportRows: reports.unresolved });
  } catch (e) {
    cleanupError = e;
    log({ evt: 'prune_failed', error: String(e).slice(0, 200) });
  }
  const digest = await runModerationDigest({ db, env, now, scheduledTime, expiredUnresolved, send: opts.send, fetch: opts.fetch, sleep: opts.sleep });
  log({ evt: 'moderation_digest', ...digest });
  if (cleanupError) throw cleanupError;
  return digest;
}
