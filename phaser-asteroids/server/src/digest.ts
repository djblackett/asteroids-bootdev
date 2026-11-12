import type { Db } from './db';
import { QUEUE_SQL, REPORT_RETENTION_MS, SUSPICIOUS_SQL } from './moderation';

/**
 * Daily moderation digest: one short email to the operator, only on days when the console's "Needs review" queue is not empty
 * (or open reports reached the 30-day retention limit unreviewed). It reads the queue and never changes moderation state: nothing
 * is hidden, renamed, deleted or resolved here. Runs from the existing daily cron after cleanup (see scheduled.ts).
 *
 * Delivery: Resend's HTTPS API through plain fetch (no SDK). Disabled until every setting below is present; see
 * ../../docs/leaderboard-moderation.md#daily-moderation-digest for the operator setup.
 *
 * Duplicates: `moderation_digests` (migration 0005) holds one row per UTC day of the cron's scheduled time. A day is claimed
 * atomically, at most MAX_ATTEMPTS_PER_DAY times, and every attempt resends the stored text under the same Idempotency-Key, so
 * a cron retry, a duplicate invocation or an ambiguous timeout cannot produce a second email (Resend keeps keys for 24 hours).
 * A failure is retried by the next day's run if items remain, so an outage costs at most a few API calls per day.
 */
export interface DigestEnv {
  /** Resend API key (secret: `wrangler secret put RESEND_API_KEY --env production`). Unset: the digest is disabled. */
  RESEND_API_KEY?: string;
  /** Sender on a domain verified in Resend, e.g. `Orbital Impact <moderation@example.com>`. */
  MODERATION_DIGEST_FROM?: string;
  /** Recipient (one address). */
  MODERATION_DIGEST_TO?: string;
  /** Link to the operator console, e.g. `https://<worker origin>/admin`. */
  MODERATION_DASHBOARD_URL?: string;
  /** Override for local integration tests only: an https URL or a loopback http URL. Default RESEND_API_URL. */
  RESEND_API_URL?: string;
}

export interface DigestConfig {
  apiKey: string;
  apiUrl: string;
  from: string;
  to: string;
  dashboardUrl: string;
}

export const RESEND_API_URL = 'https://api.resend.com/emails';
/** Claims per UTC day, including takeovers of an abandoned send. Each claim makes at most two HTTP requests. */
export const MAX_ATTEMPTS_PER_DAY = 3;
/** A claim this old with no recorded outcome is treated as abandoned (the Worker died mid-send) and can be retried. */
export const SEND_LEASE_MS = 10 * 60_000;
export const SEND_TIMEOUT_MS = 10_000;
export const RETRY_DELAY_MS = 2_000;
/** Digest ledger rows hold counts only; they are kept a month for troubleshooting. */
export const DIGEST_ROW_RETENTION_MS = 30 * 86_400_000;
/** Open reports this close to the retention limit are called out as expiring. */
export const EXPIRY_WARNING_MS = 7 * 86_400_000;

const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function validSender(value: string): boolean {
  const named = /^([^<>"\r\n]{1,80}) <([^<>]+)>$/.exec(value);
  return ADDRESS.test(named ? named[2]! : value);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

/** Never returns or logs a setting's value; only which names are missing or invalid. */
export function loadDigestConfig(env: DigestEnv): { ok: true; config: DigestConfig } | { ok: false; reason: string } {
  const get = (name: keyof DigestEnv) => env[name]?.trim() ?? '';
  const required = ['RESEND_API_KEY', 'MODERATION_DIGEST_FROM', 'MODERATION_DIGEST_TO', 'MODERATION_DASHBOARD_URL'] as const;
  const missing = required.filter((name) => !get(name));
  if (missing.length === required.length) return { ok: false, reason: 'not_configured' };
  if (missing.length) return { ok: false, reason: `incomplete:${missing.join(',')}` };
  const apiUrl = get('RESEND_API_URL') || RESEND_API_URL;
  const invalid = [
    ...(validSender(get('MODERATION_DIGEST_FROM')) ? [] : ['MODERATION_DIGEST_FROM']),
    ...(ADDRESS.test(get('MODERATION_DIGEST_TO')) ? [] : ['MODERATION_DIGEST_TO']),
    ...(validUrl(get('MODERATION_DASHBOARD_URL')) ? [] : ['MODERATION_DASHBOARD_URL']),
    ...(validUrl(apiUrl) ? [] : ['RESEND_API_URL']),
  ];
  if (invalid.length) return { ok: false, reason: `invalid:${invalid.join(',')}` };
  return {
    ok: true,
    config: { apiKey: get('RESEND_API_KEY'), apiUrl, from: get('MODERATION_DIGEST_FROM'), to: get('MODERATION_DIGEST_TO'), dashboardUrl: get('MODERATION_DASHBOARD_URL') },
  };
}

export const REPORT_REASON_LABELS = [
  ['offensive', 'Offensive name'],
  ['personal_info', 'Personal information'],
  ['suspicious_score', 'Suspected cheating'],
  ['other', 'Other'],
] as const;

export interface QueueSummary {
  /** Entries in the console's "Needs review" view: open reports and/or an unreviewed integrity flag. */
  entries: number;
  reportedEntries: number;
  openReports: Record<string, number>;
  /** Entries with an unreviewed integrity flag. */
  flaggedEntries: number;
  /** Open reports that reach the retention limit within EXPIRY_WARNING_MS. */
  expiringSoon: number;
}

export async function queueSummary(db: Db, now: number): Promise<QueueSummary> {
  const row = await db.first<{ entries: number; reportedEntries: number; flaggedEntries: number; expiringSoon: number }>(
    `SELECT (SELECT COUNT(*) FROM scores s WHERE ${QUEUE_SQL}) AS entries,
      (SELECT COUNT(DISTINCT score_id) FROM score_reports WHERE status = 'open') AS reportedEntries,
      (SELECT COUNT(*) FROM scores s WHERE ${SUSPICIOUS_SQL} AND s.suspicion_reviewed = 0) AS flaggedEntries,
      (SELECT COUNT(*) FROM score_reports WHERE status = 'open' AND created_at < ?) AS expiringSoon`,
    [now - (REPORT_RETENTION_MS - EXPIRY_WARNING_MS)],
  );
  const reasons = await db.all<{ reason: string; n: number }>("SELECT reason, COUNT(*) AS n FROM score_reports WHERE status = 'open' GROUP BY reason");
  return {
    entries: row?.entries ?? 0,
    reportedEntries: row?.reportedEntries ?? 0,
    flaggedEntries: row?.flaggedEntries ?? 0,
    expiringSoon: row?.expiringSoon ?? 0,
    openReports: Object.fromEntries(reasons.map((r) => [r.reason, r.n])),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Aggregate counts and the console link only. Returns null when nothing needs attention (no email). */
export function composeDigest(day: string, s: QueueSummary, expiredUnresolved: number, dashboardUrl: string): { subject: string; text: string } | null {
  if (s.entries === 0 && expiredUnresolved === 0) return null;
  const subject = s.entries > 0
    ? `Orbital Impact — ${plural(s.entries, 'moderation item', 'moderation items')} awaiting review`
    : `Orbital Impact — ${plural(expiredUnresolved, 'unreviewed report', 'unreviewed reports')} expired`;
  const totalReports = Object.values(s.openReports).reduce((a, b) => a + b, 0);
  const lines = [`Orbital Impact moderation digest for ${day} (UTC)`, '', `Needs review: ${plural(s.entries, 'entry', 'entries')}`];
  if (totalReports) {
    lines.push(`- Open player reports: ${totalReports} on ${plural(s.reportedEntries, 'entry', 'entries')}`);
    for (const [reason, label] of REPORT_REASON_LABELS) if (s.openReports[reason]) lines.push(`    ${label}: ${s.openReports[reason]}`);
    for (const [reason, n] of Object.entries(s.openReports)) {
      if (!REPORT_REASON_LABELS.some(([known]) => known === reason)) lines.push(`    Other (${reason.replace(/[^a-z_]/g, '').slice(0, 30)}): ${n}`);
    }
  }
  if (s.flaggedEntries) lines.push(`- Unreviewed integrity flags: ${s.flaggedEntries}`);
  if (s.expiringSoon) lines.push('', `Expiring: ${plural(s.expiringSoon, 'open report reaches', 'open reports reach')} the 30-day retention limit within 7 days and will then be deleted unreviewed.`);
  if (expiredUnresolved) lines.push('', `Expired: ${plural(expiredUnresolved, 'open report', 'open reports')} reached the 30-day limit and ${expiredUnresolved === 1 ? 'was' : 'were'} deleted without review. The entries themselves are unchanged.`);
  lines.push('', `Review: ${dashboardUrl}`, '', 'Nothing was hidden, renamed or deleted automatically. This digest is sent at most once a day while items remain open.');
  return { subject, text: lines.join('\n') + '\n' };
}

export type SendResult = { ok: true; id: string | null } | { ok: false; retryable: boolean; error: string };
export type Sender = (message: { subject: string; text: string }, idempotencyKey: string) => Promise<SendResult>;

/** Resend over fetch. Errors are reduced to a status and provider error name; response messages and secrets are never surfaced. */
export function resendSender(config: DigestConfig, fetchImpl: typeof fetch = fetch, timeoutMs = SEND_TIMEOUT_MS): Sender {
  return async (message, idempotencyKey) => {
    let res: Response;
    try {
      res = await fetchImpl(config.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'orbital-impact-moderation-digest',
        },
        body: JSON.stringify({ from: config.from, to: [config.to], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      return { ok: false, retryable: true, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
    }
    type Body = { id?: unknown; name?: unknown } | null;
    const data: Body = await res.json().then((v) => (v && typeof v === 'object' ? v as Body : null), () => null);
    if (res.ok) return { ok: true, id: typeof data?.id === 'string' ? data.id.slice(0, 100) : null };
    const name = typeof data?.name === 'string' ? data.name.replace(/[^a-z0-9_]/gi, '').slice(0, 60) : '';
    // 409 concurrent_idempotent_requests: another attempt with this key is still in flight; safe to retry. Other 4xx
    // (bad key, unverified sender, payload mismatch) need operator action, so they are not retried the same day.
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500 || name === 'concurrent_idempotent_requests';
    return { ok: false, retryable, error: `http_${res.status}${name ? `:${name}` : ''}` };
  };
}

export type DigestOutcome =
  | { status: 'disabled'; reason: string }
  | { status: 'empty' }
  | { status: 'skipped'; day: string }
  | { status: 'sent'; day: string; entries: number; attempt: number }
  | { status: 'failed'; day: string; entries: number; attempt: number; error: string; retryable: boolean }
  | { status: 'error'; error: string };

export interface DigestDeps {
  db: Db;
  env: DigestEnv;
  now: number;
  /** The cron event's scheduled time: retries of one event fall on the same day key. */
  scheduledTime: number;
  /** Open reports the cleanup that just ran deleted at the retention limit. */
  expiredUnresolved: number;
  send?: Sender;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Never throws: a digest problem must not fail the scheduled cleanup it runs after. */
export async function runModerationDigest(deps: DigestDeps): Promise<DigestOutcome> {
  try {
    return await digest(deps);
  } catch (e) {
    const key = deps.env.RESEND_API_KEY?.trim();
    const message = key ? String(e).split(key).join('[redacted]') : String(e);
    return { status: 'error', error: message.slice(0, 200) };
  }
}

async function digest({ db, env, now, scheduledTime, expiredUnresolved, ...opts }: DigestDeps): Promise<DigestOutcome> {
  const loaded = loadDigestConfig(env);
  if (!loaded.ok) return { status: 'disabled', reason: loaded.reason };
  const config = loaded.config;
  const today = day(scheduledTime);
  await db.run('DELETE FROM moderation_digests WHERE day < ?', [day(now - DIGEST_ROW_RETENTION_MS)]);

  const summary = await queueSummary(db, now);
  const message = composeDigest(today, summary, expiredUnresolved, config.dashboardUrl);
  if (!message) return { status: 'empty' };

  // Claim the day. A conflicting row is taken over only after a failure or an abandoned send, and never beyond the daily cap.
  // The stored subject/body are kept, so every attempt for a day sends an identical payload under one idempotency key.
  const claim = await db.first<{ subject: string; body: string; attempts: number }>(
    `INSERT INTO moderation_digests (day, status, attempts, claimed_at, subject, body, updated_at) VALUES (?, 'sending', 1, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET status = 'sending', attempts = moderation_digests.attempts + 1, claimed_at = excluded.claimed_at,
       updated_at = excluded.updated_at, error = NULL
     WHERE (moderation_digests.status = 'failed' OR (moderation_digests.status = 'sending' AND moderation_digests.claimed_at < ?))
       AND moderation_digests.attempts < ?
     RETURNING subject, body, attempts`,
    [today, now, message.subject, message.text, now, now - SEND_LEASE_MS, MAX_ATTEMPTS_PER_DAY],
  );
  if (!claim) return { status: 'skipped', day: today };

  const send = opts.send ?? resendSender(config, opts.fetch);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = `orbital-impact-moderation-digest-${today}`;
  const payload = { subject: claim.subject, text: claim.body };
  let result = await send(payload, key);
  if (!result.ok && result.retryable) {
    await sleep(RETRY_DELAY_MS);
    result = await send(payload, key);
  }
  if (result.ok) {
    await db.run("UPDATE moderation_digests SET status = 'sent', provider_id = ?, error = NULL, updated_at = ? WHERE day = ?", [result.id, now, today]);
    return { status: 'sent', day: today, entries: summary.entries, attempt: claim.attempts };
  }
  // A non-retryable error exhausts today's attempts; tomorrow's run tries again if items remain.
  await db.run(
    `UPDATE moderation_digests SET status = 'failed', error = ?, updated_at = ?,
       attempts = CASE WHEN ? = 1 THEN attempts ELSE MAX(attempts, ?) END WHERE day = ?`,
    [result.error, now, result.retryable ? 1 : 0, MAX_ATTEMPTS_PER_DAY, today],
  );
  return { status: 'failed', day: today, entries: summary.entries, attempt: claim.attempts, error: result.error, retryable: result.retryable };
}
