import type { Db, SqlValue } from './db';
import type { ServerSettings } from './config';
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
  completedAt: string;
  durationSeconds: number;
}

export type Scope = 'all-time' | 'weekly';

interface ScoreRow {
  id: string;
  nickname: string;
  score: number;
  completed_at: number;
  duration_ms: number;
  rules_version: string;
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
 * stable. Ranks are therefore ordinal (1, 2, 3 ...) with no shared places. Only visible, positive, current-rules scores count.
 */
const ORDER = 'score DESC, completed_at ASC, id ASC';
const ELIGIBLE = "visibility = 'visible' AND score > 0 AND rules_version = ?";

const toPublic = (row: ScoreRow, rank: number): PublicScore => ({
  id: row.id,
  rank,
  nickname: row.nickname,
  score: row.score,
  completedAt: new Date(row.completed_at).toISOString(),
  durationSeconds: Math.round(row.duration_ms / 10) / 100,
});

function windowFilter(scope: Scope, window: WeekWindow | null): { sql: string; params: SqlValue[] } {
  if (scope === 'weekly' && window) return { sql: ' AND completed_at >= ? AND completed_at < ?', params: [window.startMs, window.endMs] };
  return { sql: '', params: [] };
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
  const f = windowFilter(scope, window);
  const base: SqlValue[] = [settings.rulesVersion, ...f.params];

  const rows = await db.all<ScoreRow>(
    `SELECT id, nickname, score, completed_at, duration_ms, rules_version FROM scores
     WHERE ${ELIGIBLE}${f.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`,
    [...base, limit, offset],
  );
  const total = (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM scores WHERE ${ELIGIBLE}${f.sql}`, base))?.n ?? 0;

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

/** 1-based ordinal rank of one score on a board, or null if it is not on that board (hidden, zero, other rules, other week). */
export async function rankOf(db: Db, settings: ServerSettings, now: number, scope: Scope, row: ScoreRow): Promise<number | null> {
  if (row.rules_version !== settings.rulesVersion || row.score <= 0) return null;
  const window = scope === 'weekly' ? weekWindow(now, settings.timeZone) : null;
  if (window && (row.completed_at < window.startMs || row.completed_at >= window.endMs)) return null;
  const f = windowFilter(scope, window);
  const better = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM scores WHERE ${ELIGIBLE}${f.sql}
       AND (score > ? OR (score = ? AND (completed_at < ? OR (completed_at = ? AND id < ?))))`,
    [settings.rulesVersion, ...f.params, row.score, row.score, row.completed_at, row.completed_at, row.id],
  );
  return (better?.n ?? 0) + 1;
}

export interface ScoreDetail {
  score: Omit<PublicScore, 'rank'> & { rank: number | null };
  ranks: { allTime: number | null; weekly: number | null };
}

export async function getScoreRow(db: Db, id: string): Promise<(ScoreRow & { visibility: string }) | null> {
  return db.first(`SELECT id, nickname, score, completed_at, duration_ms, rules_version, visibility FROM scores WHERE id = ?`, [id]);
}

/** A single entry with its all-time and current-week ranks. Hidden entries are indistinguishable from unknown ones. */
export async function getScoreDetail(db: Db, settings: ServerSettings, now: number, id: string): Promise<ScoreDetail | null> {
  const row = await getScoreRow(db, id);
  if (!row || row.visibility !== 'visible') return null;
  const [allTime, weekly] = await Promise.all([rankOf(db, settings, now, 'all-time', row), rankOf(db, settings, now, 'weekly', row)]);
  return { score: { ...toPublic(row, allTime ?? 0), rank: allTime }, ranks: { allTime, weekly } };
}
