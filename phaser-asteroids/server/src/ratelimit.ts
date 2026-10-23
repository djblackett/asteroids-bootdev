import type { Db } from './db';
import { ApiError } from './errors';

/**
 * Fixed-window counters kept in the database. One atomic upsert per check, so the count is exact across Worker instances
 * (unlike Cloudflare's edge rate-limiting binding, which is approximate and per location). Used to bound request volume and,
 * more importantly, the CPU spent on replay verification; it is NOT what makes a run single-use (see runs.ts).
 */
export async function hitRateLimit(db: Db, bucket: string, limit: number, windowMs: number, now: number): Promise<void> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db.first<{ count: number }>(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
    [bucket, windowStart],
  );
  if ((row?.count ?? 0) > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    throw new ApiError(429, 'rate_limited', 'Too many requests; try again later', { retryAfterSeconds: retryAfter }, { 'Retry-After': String(retryAfter) });
  }
}

/** Deletes counters from windows that can no longer matter. */
export async function pruneRateLimits(db: Db, now: number, windowMs: number): Promise<number> {
  return (await db.run('DELETE FROM rate_limits WHERE window_start < ?', [now - 2 * windowMs])).changes;
}
