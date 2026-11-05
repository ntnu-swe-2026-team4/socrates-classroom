export interface SqlEntry {
  sql: string;
  params?: Record<string, unknown>;
}

export type Db = D1Database;

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

export function d1(db: D1Database): D1Database {
  return db;
}

export async function one<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  const q = prepare(sql, params);
  const row = await db
    .prepare(q.sql)
    .bind(...q.values)
    .first<T>();
  return row ?? null;
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const q = prepare(sql, params);
  const res = await db
    .prepare(q.sql)
    .bind(...q.values)
    .all<T>();
  return res.results ?? [];
}

export async function run(db: D1Database, sql: string, params?: Record<string, unknown>): Promise<void> {
  const q = prepare(sql, params);
  await db
    .prepare(q.sql)
    .bind(...q.values)
    .run();
}

export async function batch(db: D1Database, entries: SqlEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const stmts = entries.map(({ sql, params }) => {
    const q = prepare(sql, params);
    return db.prepare(q.sql).bind(...q.values);
  });
  await db.batch(stmts);
}
