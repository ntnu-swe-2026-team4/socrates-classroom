import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export interface GateLimits {
  concurrency?: number;
  rpm?: number;
}

export type LeaseOutcome = "granted" | "busy" | "open";
export type SettleKind = "ok" | "rate" | "timeout" | "error";

const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 60_000;
const RPM_WINDOW_MS = 60_000;

interface Usage {
  requests: number;
  failures: number;
  lastKind: SettleKind | null;
}

export class Coordinator extends DurableObject<Env> {
  private inFlight = 0;
  private rpmHits: number[] = [];
  private failures = 0;
  private openUntil = 0;
  private usage: Usage = { requests: 0, failures: 0, lastKind: null };

  async lease(providerId: string, _threadKey: string, limits?: GateLimits): Promise<LeaseOutcome> {
    const now = Date.now();
    if (this.openUntil > now) return "open";
    const concurrency = limits?.concurrency ?? Number.POSITIVE_INFINITY;
    if (this.inFlight >= concurrency) return "busy";
    const rpm = limits?.rpm;
    if (rpm !== undefined) {
      this.rpmHits = this.rpmHits.filter((t) => now - t < RPM_WINDOW_MS);
      if (this.rpmHits.length >= rpm) return "busy";
      this.rpmHits.push(now);
    }
    this.inFlight += 1;
    this.usage.requests += 1;
    void this.ctx.storage.put(`usage:${providerId}`, this.usage);
    return "granted";
  }

  async settle(providerId: string, kind: SettleKind): Promise<void> {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.usage.lastKind = kind;
    if (kind === "ok") {
      this.failures = 0;
    } else {
      this.failures += 1;
      this.usage.failures += 1;
      if (kind === "rate") this.openUntil = Date.now() + BREAKER_OPEN_MS;
      if (this.failures >= BREAKER_THRESHOLD) this.openUntil = Date.now() + BREAKER_OPEN_MS;
    }
    void this.ctx.storage.put(`usage:${providerId}`, this.usage);
  }

  async status(): Promise<{ providerId: string; inFlight: number; failures: number; open: boolean; usage: Usage }> {
    return {
      providerId: this.ctx.id.name ?? "unknown",
      inFlight: this.inFlight,
      failures: this.failures,
      open: this.openUntil > Date.now(),
      usage: this.usage,
    };
  }
}
