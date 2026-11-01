import { loadConfig } from "../config";
import { migrate, openDb } from "../db";

const config = loadConfig();
const db = openDb(config.dbPath);
migrate(db);
console.log(`[server] migrations applied to ${config.dbPath}`);
