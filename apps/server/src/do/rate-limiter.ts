import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

const MAX_KEYED_ENTRIES = 1024;

interface KeyedBucket {
  hits: number[];
  windowMs: number;
}

export class RateLimiter extends DurableObject<Env> {
  #hits: number[] = [];
  #keyed = new Map<string, KeyedBucket>();

  allow(limit: number, windowMs: number): boolean {
    const now = Date.now();
    const hits = this.#hits.filter((at) => now - at < windowMs);
    const allowed = hits.length < limit;
    if (allowed) hits.push(now);
    this.#hits = hits;
    return allowed;
  }

  check(key: string, limit: number, windowMs: number): boolean {
    return this.#pruneKey(key, windowMs, Date.now()).length < limit;
  }

  record(key: string, windowMs: number): void {
    const now = Date.now();
    const hits = this.#pruneKey(key, windowMs, now);
    hits.push(now);
    this.#storeKey(key, hits, windowMs, now);
  }

  allowKey(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const hits = this.#pruneKey(key, windowMs, now);
    if (hits.length >= limit) return false;
    hits.push(now);
    this.#storeKey(key, hits, windowMs, now);
    return true;
  }

  clear(key: string): void {
    this.#keyed.delete(key);
  }

  #pruneKey(key: string, windowMs: number, now: number): number[] {
    const entry = this.#keyed.get(key);
    if (!entry) return [];
    const hits = entry.hits.filter((at) => now - at < windowMs);
    if (hits.length === 0) {
      this.#keyed.delete(key);
      return [];
    }
    entry.hits = hits;
    entry.windowMs = windowMs;
    return hits;
  }

  #storeKey(key: string, hits: number[], windowMs: number, now: number): void {
    this.#keyed.delete(key);
    this.#keyed.set(key, { hits, windowMs });
    if (this.#keyed.size <= MAX_KEYED_ENTRIES) return;
    for (const [entryKey, entry] of this.#keyed) {
      const fresh = entry.hits.filter((at) => now - at < entry.windowMs);
      if (fresh.length === 0) {
        this.#keyed.delete(entryKey);
      } else {
        entry.hits = fresh;
      }
    }
    while (this.#keyed.size > MAX_KEYED_ENTRIES) {
      const oldest = this.#keyed.keys().next().value;
      if (oldest === undefined) break;
      this.#keyed.delete(oldest);
    }
  }
}
