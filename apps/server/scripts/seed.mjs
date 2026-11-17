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
if (body.seeded) {
  console.log("fixture 已建立：8 個固定帳號（共用密碼 demo-demo）、2 間教室（其中一班 3 位成員）。");
  console.log("切換身分：開 http://localhost:5173/dev/accounts（dev-only，免密碼）。");
} else {
  console.log("seed 未執行。");
}
