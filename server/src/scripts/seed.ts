import { loadConfig } from "../config";
import { openDb } from "../db";
import { seedDemo } from "../seed";

const config = loadConfig();
const db = openDb(config.dbPath);
const seeded = seedDemo(db);
console.log(seeded ? "[server] demo data created" : "[server] database already has users; skipped");
