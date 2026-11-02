export interface SqlEntry {
  sql: string;
  params?: Record<string, unknown>;
}

export interface Db {
  one<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  run(sql: string, params?: Record<string, unknown>): Promise<void>;
  batch(entries: SqlEntry[]): Promise<void>;
}

export function prepare(sql: string, params?: Record<string, unknown>): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const out = sql.replace(/\$(\w+)/g, (_match, name: string) => {
    if (!params || !(name in params)) throw new Error(`d1: missing bind param $${name}`);
    const value = params[name];
    values.push(value === undefined ? null : value);
    return "?";
  });
  return { sql: out, values };
}

export function d1(db: D1Database): Db {
  return {
    async one<T>(sql: string, params?: Record<string, unknown>) {
      const q = prepare(sql, params);
      return (
        ((await db
          .prepare(q.sql)
          .bind(...q.values)
          .first()) as T | null) ?? null
      );
    },
    async all<T>(sql: string, params?: Record<string, unknown>) {
      const q = prepare(sql, params);
      const res = await db
        .prepare(q.sql)
        .bind(...q.values)
        .all<T>();
      return res.results ?? [];
    },
    async run(sql: string, params?: Record<string, unknown>) {
      const q = prepare(sql, params);
      await db
        .prepare(q.sql)
        .bind(...q.values)
        .run();
    },
    async batch(entries) {
      const stmts = entries.map(({ sql, params }) => {
        const q = prepare(sql, params);
        return db.prepare(q.sql).bind(...q.values);
      });
      if (stmts.length) await db.batch(stmts);
    },
  };
}

export function one<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  return db.one<T>(sql, params);
}

export function all<T = Record<string, unknown>>(db: Db, sql: string, params?: Record<string, unknown>): Promise<T[]> {
  return db.all<T>(sql, params);
}

export function run(db: Db, sql: string, params?: Record<string, unknown>): Promise<void> {
  return db.run(sql, params);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function boolInt(value: boolean): number {
  return value ? 1 : 0;
}
