import type { Db, SqlValue } from './db';
import { ApiError } from './errors';
import { sanitizeNickname } from './nickname';

export const REPORT_REASONS = ['offensive', 'personal_info', 'other', 'suspicious_score'] as const;

export async function reportScore(db: Db, scoreId: string, reporterHash: string, reason: unknown, now: number): Promise<void> {
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new ApiError(400, 'invalid_reason', 'Choose a report reason');
  }
  // Conditional insert also handles a concurrent deletion. Reporting never changes visibility or ranking.
  const [result] = await db.batch([
    { sql: `INSERT INTO score_reports (score_id, reporter_hash, reason, created_at)
     SELECT id, ?, ?, ? FROM scores WHERE id = ? AND visibility = 'visible'
     ON CONFLICT (score_id, reporter_hash) DO UPDATE SET reason = excluded.reason
       WHERE score_reports.status = 'open' AND score_reports.reason <> excluded.reason`,
      params: [reporterHash, reason, now, scoreId] },
    // A new complaint/category invalidates an operator's stale review snapshot.
    // Identical repeats and resolved complaints do not continually disrupt review.
    { sql: 'UPDATE scores SET moderation_revision = moderation_revision + 1 WHERE id = ? AND changes() = 1', params: [scoreId] },
  ]);
  if (!result?.changes && !await db.first("SELECT id FROM scores WHERE id = ? AND visibility = 'visible'", [scoreId])) {
    throw new ApiError(404, 'score_not_found', 'No such score');
  }
}

/** Published retention for reports: deleted by the daily cleanup once older than this, open or resolved. */
export const REPORT_RETENTION_MS = 30 * 86_400_000;

/**
 * Daily retention cleanup. `unresolved` counts the deleted reports that were still open, so expiry without review is announced
 * in the moderation digest instead of passing silently. The retention period itself is unchanged.
 */
export async function pruneReports(db: Db, now: number): Promise<{ deleted: number; unresolved: number }> {
  const cutoff = now - REPORT_RETENTION_MS;
  const open = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM score_reports WHERE created_at < ? AND status = 'open'", [cutoff]);
  const deleted = (await db.run('DELETE FROM score_reports WHERE created_at < ?', [cutoff])).changes;
  return { deleted, unresolved: Math.min(open?.n ?? 0, deleted) };
}

/** Operator-only erasure: atomic, scores before their FK parent; related reports cascade. */
export async function deleteScore(db: Db, scoreId: string, now = Date.now()): Promise<boolean> {
  const score = await db.first<{ run_id: string }>('SELECT run_id FROM scores WHERE id = ?', [scoreId]);
  if (!score) return false;
  const result = await db.batch([
    auditStatement(scoreId, 'delete', 'privacy_removal', now),
    // Use the actual FK relationship, not runs.score_id (a denormalized pointer).
    { sql: `DELETE FROM scores WHERE id = ?`, params: [scoreId] },
    { sql: `DELETE FROM runs WHERE id = ? AND status = 'accepted' AND NOT EXISTS (SELECT 1 FROM scores WHERE run_id = runs.id)`, params: [score.run_id] },
  ]);
  // D1 meta.changes includes cascading FK writes; a successful erasure may
  // change many reports/audit links as well as the one primary-key score row.
  return (result[1]?.changes ?? 0) > 0;
}

// Frozen 1.2.0: max asteroid base = trunc(50 * 1.75 + 20) = 107;
// max combo = 3, max UFO = 500. Stats include non-scoring kills, so this is
// a conservative upper bound. No boss bonus in this version. Never apply it
// to an unknown era. This flags integrity anomalies, not proof of cheating.
export const SUSPICIOUS_SQL = `(s.rules_version = '1.2.0' AND
  (s.score > s.asteroids_destroyed * 321 + s.ufos_destroyed * 500
   OR s.ticks <= 0 OR s.ticks > 72000 OR ABS(s.duration_ms - ROUND(s.ticks * 1000.0 / 60)) > 1
   OR s.asteroids_destroyed < 0 OR s.ufos_destroyed < 0))`;

const CATEGORIES = ['offensive', 'personal_info', 'suspicious_score', 'other', 'appeal'] as const;
function category(value: unknown): string {
  if (typeof value !== 'string' || !(CATEGORIES as readonly string[]).includes(value)) {
    throw new ApiError(400, 'invalid_category', 'Choose a moderation category');
  }
  return value;
}

function auditStatement(id: string, action: string, reason: string, now: number, revision?: number) {
  return {
    sql: `INSERT INTO moderation_audit (score_id, action, category, created_at, revision, was_visible, had_display_name, open_reports)
      SELECT id, ?, ?, ?, moderation_revision, visibility = 'visible', display_name IS NOT NULL,
        (SELECT COUNT(*) FROM score_reports WHERE score_id = scores.id AND status = 'open')
      FROM scores WHERE id = ?${revision === undefined ? '' : ' AND moderation_revision = ?'}`,
    params: [action, reason, now, id, ...(revision === undefined ? [] : [revision])] as SqlValue[],
  };
}

/** All decisions and their audit record commit together. Revision guards stale console tabs. */
export async function moderateScore(db: Db, id: string, body: Record<string, unknown>, now: number, legacyReason?: string | null): Promise<void> {
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new ApiError(400, 'invalid_revision', 'Refresh the entry before moderating');
  }
  const reason = category(body.category);
  let update: string;
  let params: SqlValue[] = [];
  const action = body.action;
  switch (action) {
    case 'hide': update = "visibility = 'hidden', hidden_reason = ?, hidden_at = ?"; params = [legacyReason === undefined ? reason : legacyReason?.slice(0, 200) ?? null, now]; break;
    case 'restore': update = "visibility = 'visible', hidden_reason = NULL, hidden_at = NULL"; break;
    case 'rename': {
      const name = sanitizeNickname(body.name);
      if (!name.ok) throw new ApiError(400, 'invalid_nickname', name.message);
      update = 'display_name = ?'; params = [name.value]; break;
    }
    case 'restore_name': update = 'display_name = NULL'; break;
    case 'resolve': update = 'suspicion_reviewed = 1'; break;
    case 'reopen': update = 'suspicion_reviewed = 0'; break;
    default: throw new ApiError(400, 'invalid_action', 'Choose a moderation action');
  }
  const result = await db.batch([
    auditStatement(id, action, reason, now, revision),
    ...(action === 'resolve' || action === 'reopen' ? [{
      sql: `UPDATE score_reports SET status = ? WHERE score_id = ? AND EXISTS
        (SELECT 1 FROM scores WHERE id = ? AND moderation_revision = ?)`,
      params: [action === 'resolve' ? 'resolved' : 'open', id, id, revision] as SqlValue[],
    }] : []),
    { sql: `UPDATE scores SET ${update}, moderation_revision = moderation_revision + 1 WHERE id = ? AND moderation_revision = ?`, params: [...params, id, revision] },
  ]);
  if (!result[0]?.changes) {
    if (!await db.first('SELECT id FROM scores WHERE id = ?', [id])) throw new ApiError(404, 'score_not_found', 'No such score');
    throw new ApiError(409, 'stale_revision', 'This entry changed. Refresh and review it again.');
  }
}

/** Legacy visibility route retains its request/response shape; now uses the same audited writer. */
export async function setScoreVisibility(db: Db, id: string, visible: boolean, reason: string | null, now: number): Promise<boolean> {
  const row = await db.first<{ moderation_revision: number }>('SELECT moderation_revision FROM scores WHERE id = ?', [id]);
  if (!row) return false;
  await moderateScore(db, id, { action: visible ? 'restore' : 'hide', category: (CATEGORIES as readonly unknown[]).includes(reason) ? reason : 'other', revision: row.moderation_revision }, now, reason);
  return true;
}

/** The console's "Needs review" view (alias `s` = scores). The daily digest counts exactly these entries. */
export const QUEUE_SQL = `(EXISTS (SELECT 1 FROM score_reports r WHERE r.score_id = s.id AND r.status = 'open') OR (${SUSPICIOUS_SQL} AND s.suspicion_reviewed = 0))`;

export async function adminScores(db: Db, filter: string, before: number | null, id: string | null) {
  const filters: Record<string, string> = {
    queue: QUEUE_SQL,
    hidden: "s.visibility = 'hidden'", all: '1=1',
  };
  if (!Object.hasOwn(filters, filter)) throw new ApiError(400, 'invalid_filter', 'Choose queue, hidden or all');
  // rowid cursor is stable across decisions/deletions and also works with equal timestamps.
  const rows = await db.all<{ cursor: number }>(`SELECT s.rowid AS cursor, s.id, s.nickname AS originalName,
      COALESCE(s.display_name, s.nickname) AS displayName, s.display_name IS NOT NULL AS renamed,
      s.score, s.rules_version AS rulesVersion, s.completed_at AS completedAt, s.ticks, s.duration_ms AS durationMs,
      s.asteroids_destroyed AS asteroids, s.ufos_destroyed AS ufos, s.visibility, s.moderation_revision AS revision,
      ${SUSPICIOUS_SQL} AS suspicious, s.suspicion_reviewed AS suspicionReviewed,
      (SELECT COUNT(*) FROM score_reports WHERE score_id = s.id AND status = 'open') AS openReports
    FROM scores s WHERE ${id ? 's.id = ?' : filters[filter]} ${before === null ? '' : 'AND s.rowid < ?'}
    ORDER BY s.rowid DESC LIMIT 50`, [...(id ? [id] : []), ...(before === null ? [] : [before])]);
  return { entries: rows, next: rows.length === 50 ? rows.at(-1)!.cursor : null };
}

export async function adminHistory(db: Db, id: string) {
  return {
    reports: await db.all(`SELECT reason, status, COUNT(*) AS count, MIN(created_at) AS firstAt
      FROM score_reports WHERE score_id = ? GROUP BY reason, status`, [id]),
    audit: await db.all('SELECT id, action, category, created_at, revision, was_visible, had_display_name, open_reports FROM moderation_audit WHERE score_id = ? ORDER BY id DESC LIMIT 100', [id]),
  };
}

export async function adminAudit(db: Db, before: number | null) {
  const entries = await db.all<{ id: number }>(`SELECT * FROM moderation_audit
    ${before === null ? '' : 'WHERE id < ?'} ORDER BY id DESC LIMIT 100`, before === null ? [] : [before]);
  return { entries, next: entries.length === 100 ? entries.at(-1)!.id : null };
}
