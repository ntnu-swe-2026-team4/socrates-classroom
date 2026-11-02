#!/usr/bin/env node
/**
 * 對本機 dev server（pnpm dev，預設 http://localhost:5173）灌示範資料。
 * SEED_TOKEN 讀取順序：環境變數 → apps/web/.env.local → apps/web/.env（與 Worker 的 var 同源）。
 */
import { readFileSync } from "node:fs";

const BASE = process.env.SEED_BASE ?? "http://localhost:5173";

function localEnvToken() {
  for (const name of ["../../web/.env.local", "../../web/.env"]) {
    try {
      const text = readFileSync(new URL(name, import.meta.url), "utf8");
      const line = text.split("\n").find((l) => /^SEED_TOKEN=/.test(l));
      const value = line
        ?.slice("SEED_TOKEN=".length)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (value) return value;
    } catch {}
  }
  return "";
}

const TOKEN = process.env.SEED_TOKEN || localEnvToken();
if (!TOKEN) {
  console.error("找不到 SEED_TOKEN：設環境變數，或在 apps/web/.env.local 設定（dev server 需重啟才會載入）");
  process.exit(1);
}

let res;
try {
  res = await fetch(`${BASE}/api/dev/seed`, {
    method: "POST",
    headers: { "x-seed-token": TOKEN },
  });
} catch {
  console.error(`連不上 ${BASE}——dev server 未啟動（pnpm dev）`);
  process.exit(1);
}
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`seed 失敗：HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body.seeded ? "示範資料已建立。" : "資料庫已有使用者，跳過示範資料。");
