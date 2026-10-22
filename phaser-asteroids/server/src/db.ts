/**
 * The only database surface the service code uses. Two adapters implement it: `d1.ts` (Cloudflare D1, production) and
 * `testing/sqliteDb.ts` (node:sqlite, unit tests). Both speak SQLite, so the SQL in the service is written once.
 *
 * `batch` is the atomic primitive: all statements commit or none do (D1 has no interactive transactions, only batches).
 * Everything that must be race-free is expressed either as one conditional statement or as one batch.
 */
export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params: SqlValue[];
}

export interface Db {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Rows changed by the statement. */
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Executes the statements atomically and in order; returns the rows changed by each. */
  batch(statements: Statement[]): Promise<Array<{ changes: number }>>;
}
