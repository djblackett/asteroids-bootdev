import type { Db, SqlValue } from './db';
import type { ServerSettings } from './config';
import { rulesInScoringEra, SCORING_ERAS } from '../../src/ranked/scoringEras';
import { weekWindow, type WeekWindow } from './week';

/**
 * What the public API exposes about an entry. Deliberately small: no run id, no control metadata, no moderation fields.
 * `nickname` is plain text restricted to letters, numbers, space and `_ . ! -`; clients should still render it as text.
 */
export interface PublicScore {
  id: string;
  rank: number;
  nickname: string;
  score: number;
  rulesVersion: string;
  completedAt: string;
  durationSeconds: number;
  /** Verified by the server: the ship ran out of lives, or was still alive when the ranked time limit ended the run. */
  endReason: 'game_over' | 'time_limit';
}

export type Scope = 'all-time' | 'weekly';

interface ScoreRow {
  id: string;
  nickname: string;
  score: number;
  completed_at: number;
  duration_ms: number;
  rules_version: string;
  end_reason: 'game_over' | 'time_limit';
}

export interface LeaderboardPage {
  scope: Scope;
  rulesVersion: string;
  timeZone?: string;
  weekStart?: string;
  weekEnd?: string;
  limit: number;
  offset: number;
  total: number;
  entries: PublicScore[];
}

/**
 * Ranking: highest verified score first; ties go to whoever finished first, then to the smaller id so the order is total and
 * stable. Ranks are therefore ordinal (1, 2, 3 ...) with no shared places. Only visible, positive, supported-era scores count.
 */
const ORDER = 'score DESC, completed_at ASC, id ASC';
const ELIGIBLE = "visibility = 'visible' AND score > 0";

const toPublic = (row: ScoreRow, rank: number): PublicScore => ({
  id: row.id,
  rank,
  nickname: row.nickname,
  score: row.score,
  rulesVersion: row.rules_version,
  completedAt: new Date(row.completed_at).toISOString(),
  durationSeconds: Math.round(row.duration_ms / 10) / 100,
  endReason: row.end_reason,
});

function windowFilter(scope: Scope, window: WeekWindow | null): { sql: string; params: SqlValue[] } {
  if (scope === 'weekly' && window) return { sql: ' AND completed_at >= ? AND completed_at < ?', params: [window.startMs, window.endMs] };
  return { sql: '', params: [] };
}

function boardVersions(scope: Scope, currentRules: string): string[] {
  return scope === 'weekly' ? rulesInScoringEra(currentRules) : Object.keys(SCORING_ERAS);
}

/** Shared by page totals, page entries and rank counts so pagination and detail/submission ranks agree. */
function boardFilter(scope: Scope, currentRules: string, window: WeekWindow | null): { sql: string; params: SqlValue[] } {
  const versions = boardVersions(scope, currentRules);
  const f = windowFilter(scope, window);
  return {
    sql: `${ELIGIBLE} AND ${versions.length ? `rules_version IN (${versions.map(() => '?').join(', ')})` : '0'}${f.sql}`,
    params: [...versions, ...f.params],
  };
}

export async function getLeaderboard(
  db: Db,
  settings: ServerSettings,
  now: number,
  scope: Scope,
  limit: number,
  offset: number,
): Promise<LeaderboardPage> {
  const window = scope === 'weekly' ? weekWindow(now, settings.timeZone) : null;
  const f = boardFilter(scope, settings.rulesVersion, window);

  const rows = await db.all<ScoreRow>(
    `SELECT id, nickname, score, completed_at, duration_ms, rules_version, end_reason FROM scores
     WHERE ${f.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`,
    [...f.params, limit, offset],
  );
  const total = (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM scores WHERE ${f.sql}`, f.params))?.n ?? 0;

  return {
    scope,
    rulesVersion: settings.rulesVersion,
    ...(window && { timeZone: window.timeZone, weekStart: new Date(window.startMs).toISOString(), weekEnd: new Date(window.endMs).toISOString() }),
    limit,
    offset,
    total,
    entries: rows.map((row, i) => toPublic(row, offset + i + 1)),
  };
}

/** 1-based ordinal rank, or null for hidden, zero, unsupported-era or out-of-scope scores. */
export async function rankOf(db: Db, settings: ServerSettings, now: number, scope: Scope, row: ScoreRow & { visibility: string }): Promise<number | null> {
  if (row.visibility !== 'visible' || row.score <= 0 || !boardVersions(scope, settings.rulesVersion).includes(row.rules_version)) return null;
  const window = scope === 'weekly' ? weekWindow(now, settings.timeZone) : null;
  if (window && (row.completed_at < window.startMs || row.completed_at >= window.endMs)) return null;
  const f = boardFilter(scope, settings.rulesVersion, window);
  const better = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM scores WHERE ${f.sql}
       AND (score > ? OR (score = ? AND (completed_at < ? OR (completed_at = ? AND id < ?))))`,
    [...f.params, row.score, row.score, row.completed_at, row.completed_at, row.id],
  );
  return (better?.n ?? 0) + 1;
}

export interface ScoreDetail {
  score: Omit<PublicScore, 'rank'> & { rank: number | null };
  ranks: { allTime: number | null; weekly: number | null };
}

export async function getScoreRow(db: Db, id: string): Promise<(ScoreRow & { visibility: string }) | null> {
  return db.first(`SELECT id, nickname, score, completed_at, duration_ms, rules_version, end_reason, visibility FROM scores WHERE id = ?`, [id]);
}

/** A single entry with its all-time and current-week ranks. Hidden entries are indistinguishable from unknown ones. */
export async function getScoreDetail(db: Db, settings: ServerSettings, now: number, id: string): Promise<ScoreDetail | null> {
  const row = await getScoreRow(db, id);
  if (!row || row.visibility !== 'visible') return null;
  const [allTime, weekly] = await Promise.all([rankOf(db, settings, now, 'all-time', row), rankOf(db, settings, now, 'weekly', row)]);
  return { score: { ...toPublic(row, allTime ?? 0), rank: allTime }, ranks: { allTime, weekly } };
}
