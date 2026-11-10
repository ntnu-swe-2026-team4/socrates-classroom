export interface SqlEntry {
  sql: string;
  params?: Record<string, unknown>;
}

export type Db = D1Database;

export function prepare(sql: string, params?: Record<string, unknown>): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  let out = "";
  let quoted = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    if (char === "'") {
      if (quoted && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      quoted = !quoted;
      out += char;
      continue;
    }
    if (!quoted && char === "$") {
      const match = /^\$(\w+)/.exec(sql.slice(i));
      if (match) {
        const name = match[1]!;
        if (!params || !(name in params)) throw new Error(`d1: missing bind param $${name}`);
        const value = params[name];
        values.push(value === undefined ? null : value);
        out += "?";
        i += match[0].length - 1;
        continue;
      }
    }
    out += char;
  }
  return { sql: out, values };
}

export async function one<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  const q = prepare(sql, params);
  return await db
    .prepare(q.sql)
    .bind(...q.values)
    .first<T>();
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const q = prepare(sql, params);
  const { results } = await db
    .prepare(q.sql)
    .bind(...q.values)
    .all<T>();
  return results ?? [];
}

export async function run(db: D1Database, sql: string, params?: Record<string, unknown>): Promise<D1Result> {
  const q = prepare(sql, params);
  return await db
    .prepare(q.sql)
    .bind(...q.values)
    .run();
}

export async function batch(db: D1Database, entries: SqlEntry[]): Promise<D1Result[]> {
  const statements = entries.map(({ sql, params }) => {
    const q = prepare(sql, params);
    return db.prepare(q.sql).bind(...q.values);
  });
  return await db.batch(statements);
}
