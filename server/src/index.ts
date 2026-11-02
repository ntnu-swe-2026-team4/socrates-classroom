import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { seedDemo } from "./seed";

const config = loadConfig();
const db = openDb(config.dbPath);
if (config.seedDemo) {
  const seeded = seedDemo(db);
  if (seeded) console.log("[server] seeded demo classroom data");
}

export const app = createApp(db, config);

console.log(`[server] listening on http://localhost:${config.port} (sqlite: ${config.dbPath})`);

export default {
  port: config.port,
  fetch: app.fetch,
  // SSE 每 15 秒送一次心跳；Bun 預設的 10 秒 idle timeout 會把長連線切掉。
  idleTimeout: 60,
  maxRequestBodySize: 64 * 1024 * 1024,
};
