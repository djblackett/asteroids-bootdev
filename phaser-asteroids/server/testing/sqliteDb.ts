// Test-only adapter: runs the exact production SQL (and the exact migration files) on Node's built-in SQLite.
// Production uses Cloudflare D1 (src/d1.ts); both speak the same SQLite dialect.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db, SqlValue, Statement } from '../src/db';

const migrationsDir = path.resolve(import.meta.dirname, '..', 'migrations');

export interface SqliteDb extends Db {
  exec(sql: string): void;
  close(): void;
}

/**
 * Opens a database with the migrations applied. No `file`: a private in-memory database. A file path lets several connections
 * share one database, which is how the tests imitate several Worker instances.
 */
export function openSqliteDb(file = ':memory:'): SqliteDb {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');

  const hasSchema = raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
  if (!hasSchema) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) raw.exec(readFileSync(path.join(migrationsDir, f)).toString());
  }

  const run = (sql: string, params: SqlValue[] = []) => ({ changes: Number(raw.prepare(sql).run(...params).changes) });

  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async run(sql, params) {
      return run(sql, params);
    },
    async batch(statements: Statement[]) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) => run(s.sql, s.params));
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    exec: (sql) => raw.exec(sql),
    close: () => raw.close(),
  };
}

/** Wraps a Db so chosen statements fail, to test that failures never leave a half-accepted run behind. */
export function faultyDb(inner: Db, shouldFail: (sql: string) => boolean): Db {
  const check = (sql: string) => {
    if (shouldFail(sql)) throw new Error('simulated database failure');
  };
  return {
    all: async (sql, params) => (check(sql), inner.all(sql, params)),
    first: async (sql, params) => (check(sql), inner.first(sql, params)),
    run: async (sql, params) => (check(sql), inner.run(sql, params)),
    batch: async (statements) => (statements.forEach((s) => check(s.sql)), inner.batch(statements)),
  };
}
