// D1 資料庫介面與實作。
// 現有 SQL 全用 `$named` 參數；D1 只吃位置參數——prepare() 在此統一轉換，
// 呼叫端（routes/services）的 SQL 字串原樣保留，只需把同步呼叫加上 await。

export interface SqlEntry {
  sql: string;
  params?: Record<string, unknown>;
}

export interface Db {
  one<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  run(sql: string, params?: Record<string, unknown>): Promise<void>;
  /** 原子批次（D1 batch = 單一交易）；取代舊 tx(db, fn) 的寫入段 */
  batch(entries: SqlEntry[]): Promise<void>;
}

/** `$name` 佔位符 → D1 位置參數。出現順序即綁定順序；缺參數直接丟錯。 */
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

// ---- 相容 helper：移植期讓 routes/services 用同一組函式名（多加 await 即可）----

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
