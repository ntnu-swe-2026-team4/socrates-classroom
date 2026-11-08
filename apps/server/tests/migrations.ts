import migration001 from "../migrations/001_init.sql";
import migration002 from "../migrations/002_teacher_keys.sql";
import migration003 from "../migrations/003_drop_dead_tables.sql";
import migration004 from "../migrations/004_teacher_key_model.sql";
import { run } from "../src/db/d1";

const MIGRATIONS = [migration001, migration002, migration003, migration004];

export async function applyMigrations(db: Parameters<typeof run>[0]): Promise<void> {
  for (const migration of MIGRATIONS) {
    for (const statement of migration.split(";")) {
      const sql = statement.trim();
      if (sql) await run(db, sql);
    }
  }
}
