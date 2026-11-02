import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type DB = Database;

const migrationsDir = path.resolve(import.meta.dirname, "../migrations");

export function openDb(filename: string): DB {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  if (filename !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set(db.query("SELECT name FROM _migrations").all().map((r: any) => r.name as string));
  for (const name of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(path.join(migrationsDir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
    })();
  }
}

/** 在一個交易內執行；失敗自動 rollback。 */
export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)();
}

/** Bun 的 SQLite 把 `$name` 視為命名參數，物件 key 必須帶 `$`。這裡兩種寫法都接受。 */
export function bind(params: Record<string, unknown> = {}): any {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key.startsWith("$") ? key : `$${key}`] = value === undefined ? null : value;
  }
  return out;
}

export function one<T = any>(db: DB, sql: string, params: Record<string, unknown> = {}): T | null {
  return (db.query(sql).get(bind(params) as any) as T | null) ?? null;
}

export function all<T = any>(db: DB, sql: string, params: Record<string, unknown> = {}): T[] {
  return db.query(sql).all(bind(params) as any) as T[];
}

export function run(db: DB, sql: string, params: Record<string, unknown> = {}): void {
  db.query(sql).run(bind(params) as any);
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
