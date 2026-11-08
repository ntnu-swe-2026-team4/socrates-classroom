import type { LedgerKey } from "./routing-schema";

export type SettleKind = "ok" | "rate" | "timeout" | "error" | "auth";

interface LedgerEntry {
  requests: number;
  failures: number;
  lastKind: SettleKind | null;
  lastAt: number;
}

const COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = Number.POSITIVE_INFINITY;
const MAX_FAILURES_FOR_COOLDOWN = 5;

/**
 * Cooldown expiry is automatic (no probe); auth failures stay dead until the
 * credential itself changes, because retrying them cannot succeed.
 */
export class RoutingLedger {
  readonly #ledger = new Map<string, LedgerEntry>();
  readonly #cooldown = new Map<string, number>();

  #key(key: LedgerKey): string {
    return `${key.provider}|${key.model}|${key.credential}`;
  }

  cooldownUntil(key: LedgerKey): number {
    return this.#cooldown.get(this.#key(key)) ?? 0;
  }

  inCooldown(key: LedgerKey, now = Date.now()): boolean {
    return this.cooldownUntil(key) > now;
  }

  inFlight(key: LedgerKey): number {
    return this.#ledger.get(this.#key(key))?.requests ?? 0;
  }

  isDead(key: LedgerKey): boolean {
    return this.cooldownUntil(key) === Number.POSITIVE_INFINITY;
  }

  record(key: LedgerKey): void {
    const entry = this.#ledger.get(this.#key(key)) ?? { requests: 0, failures: 0, lastKind: null, lastAt: 0 };
    entry.requests += 1;
    entry.lastAt = Date.now();
    this.#ledger.set(this.#key(key), entry);
  }

  settle(key: LedgerKey, kind: SettleKind): void {
    const id = this.#key(key);
    const entry = this.#ledger.get(id) ?? { requests: 0, failures: 0, lastKind: null, lastAt: 0 };
    entry.lastKind = kind;
    entry.lastAt = Date.now();
    if (kind === "ok") {
      entry.failures = 0;
      this.#cooldown.delete(id);
    } else {
      entry.failures += 1;
      if (kind === "auth") this.#cooldown.set(id, Date.now() + AUTH_COOLDOWN_MS);
      else if (kind === "rate" || kind === "timeout") this.#cooldown.set(id, Date.now() + COOLDOWN_MS);
      else if (entry.failures >= MAX_FAILURES_FOR_COOLDOWN) this.#cooldown.set(id, Date.now() + COOLDOWN_MS);
    }
    this.#ledger.set(id, entry);
  }

  status(key: LedgerKey): {
    requests: number;
    failures: number;
    lastKind: SettleKind | null;
    cooldown: boolean;
    dead: boolean;
  } {
    const entry = this.#ledger.get(this.#key(key));
    return {
      requests: entry?.requests ?? 0,
      failures: entry?.failures ?? 0,
      lastKind: entry?.lastKind ?? null,
      cooldown: this.inCooldown(key),
      dead: this.isDead(key),
    };
  }
}
