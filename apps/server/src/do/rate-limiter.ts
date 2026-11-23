import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export class RateLimiter extends DurableObject<Env> {
  #hits: number[] = [];

  allow(limit: number, windowMs: number): boolean {
    const now = Date.now();
    const hits = this.#hits.filter((at) => now - at < windowMs);
    const allowed = hits.length < limit;
    if (allowed) hits.push(now);
    this.#hits = hits;
    return allowed;
  }
}
