import { fail } from "../http";

/**
 * 每人速率限制（60 秒窗 20 次）與對話鎖。
 * 注意：Workers 上這是 per-isolate 狀態——跨 isolate 由 provider pool 的閘門與
 * pi inbox 兜底；這裡主要擋同一 isolate 內的連點與腳本。
 */

const locks = new Set<string>();
const rates = new Map<string, number[]>();
const RATE_WINDOW = 60_000;
const RATE_MAX = 20;

export function checkRate(userId: string): void {
  const now = Date.now();
  if (rates.size > 500) {
    // 偶發清掃：視窗外已無紀錄的使用者就移除，避免長時間運行無限增長
    for (const [k, hits] of rates) {
      if (!hits.length || now - hits[hits.length - 1] >= RATE_WINDOW) rates.delete(k);
    }
  }
  const hits = (rates.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) fail(429, "rate_limited");
  hits.push(now);
  rates.set(userId, hits);
}

export function acquireLock(key: string): void {
  if (locks.has(key)) fail(409, "already_streaming");
  locks.add(key);
}

export function releaseLock(key: string): void {
  locks.delete(key);
}
