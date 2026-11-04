import type { Db } from './db';
import { ApiError } from './errors';

export const REPORT_REASONS = ['offensive', 'personal_info', 'other'] as const;

export async function reportScore(db: Db, scoreId: string, reporterHash: string, reason: unknown, now: number): Promise<void> {
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw new ApiError(400, 'invalid_reason', 'Choose a report reason');
  }
  // Conditional insert also handles a concurrent deletion. Reporting never changes visibility or ranking.
  const result = await db.run(
    `INSERT INTO score_reports (score_id, reporter_hash, reason, created_at)
     SELECT id, ?, ?, ? FROM scores WHERE id = ? AND visibility = 'visible'
     ON CONFLICT (score_id, reporter_hash) DO UPDATE SET reason = excluded.reason`,
    [reporterHash, reason, now, scoreId],
  );
  if (!result.changes) throw new ApiError(404, 'score_not_found', 'No such score');
}

export async function pruneReports(db: Db, now: number): Promise<number> {
  return (await db.run('DELETE FROM score_reports WHERE created_at < ?', [now - 30 * 86_400_000])).changes;
}

/** Operator-only erasure: atomic, scores before their FK parent; related reports cascade. */
export async function deleteScore(db: Db, scoreId: string): Promise<boolean> {
  const result = await db.batch([
    { sql: `DELETE FROM scores WHERE id = ?`, params: [scoreId] },
    { sql: `DELETE FROM runs WHERE score_id = ? AND status = 'accepted'`, params: [scoreId] },
  ]);
  return result[0]?.changes === 1;
}
