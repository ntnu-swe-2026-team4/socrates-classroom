#!/usr/bin/env node
/**
 * 對本機 `cf dev`（預設 http://localhost:8787）灌示範資料。
 * 需要 SEED_TOKEN（cloudflare.config.ts vars / .dev.vars 設定值一致）。
 *
 *   SEED_TOKEN=dev-token node scripts/seed.mjs
 */
const BASE = process.env.SEED_BASE ?? "http://localhost:8787";
const TOKEN = process.env.SEED_TOKEN ?? "";

if (!TOKEN) {
  console.error("請設定 SEED_TOKEN（需與 Worker 的 SEED_TOKEN var 一致）");
  process.exit(1);
}

const res = await fetch(`${BASE}/api/dev/seed`, {
  method: "POST",
  headers: { "x-seed-token": TOKEN },
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`seed 失敗：HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body.seeded ? "示範資料已建立。" : "資料庫已有使用者，跳過示範資料。");
