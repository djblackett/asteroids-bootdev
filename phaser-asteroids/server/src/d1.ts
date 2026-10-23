import type { Db, SqlValue, Statement } from './db';

/** The slice of Cloudflare's D1 API this service uses, declared structurally so no Workers type package is needed. */
export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  batch(statements: D1PreparedLike[]): Promise<Array<{ meta: { changes?: number } }>>;
}

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  run(): Promise<{ meta: { changes?: number } }>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

export function d1Db(d1: D1Like): Db {
  const prep = (sql: string, params: SqlValue[] = []) => d1.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return (await prep(sql, params).all<T>()).results;
    },
    first<T>(sql: string, params?: SqlValue[]) {
      return prep(sql, params).first<T>();
    },
    async run(sql, params) {
      const res = await prep(sql, params).run();
      return { changes: res.meta.changes ?? 0 };
    },
    async batch(statements: Statement[]) {
      const results = await d1.batch(statements.map((s) => prep(s.sql, s.params)));
      return results.map((r) => ({ changes: r.meta.changes ?? 0 }));
    },
  };
}
