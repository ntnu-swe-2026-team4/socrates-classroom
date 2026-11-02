import { fail } from "../http";

const locks = new Set<string>();
const rates = new Map<string, number[]>();
const RATE_WINDOW = 60_000;
const RATE_MAX = 20;

export function checkRate(userId: string): void {
  const now = Date.now();
  if (rates.size > 500) {
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
