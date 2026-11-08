#!/usr/bin/env node
/**
 * Seeds demo data into the local dev server (pnpm dev, http://localhost:5173
 * by default). SEED_TOKEN resolution: env var, then apps/web/.env.local,
 * then apps/web/.env (same source as the Worker's vars).
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
