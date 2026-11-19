import type { LedgerKey } from "./gateway-schema";

export type SettleKind = "ok" | "error";

interface LedgerEntry {
  requests: number;
  failures: number;
  lastKind: SettleKind | null;
  lastAt: number;
}

const COOLDOWN_MS = 60_000;
const MAX_FAILURES_FOR_COOLDOWN = 5;

/**
 * pi surfaces no structured error status (only message strings), so the
 * ledger accounts ok/error only; cooldown comes from consecutive errors.
 */
export class GatewayLedger {
  readonly #ledger = new Map<string, LedgerEntry>();
  readonly #cooldown = new Map<string, number>();
  readonly #inFlight = new Map<string, number>();
  readonly #providerInFlight = new Map<string, number>();

  #key(key: LedgerKey): string {
    return `${key.provider}|${key.model}|${key.credential}`;
  }

  #providerKey(key: LedgerKey): string {
    return `${key.provider}|${key.credential}`;
  }

  cooldownUntil(key: LedgerKey): number {
    return this.#cooldown.get(this.#key(key)) ?? 0;
  }

  inCooldown(key: LedgerKey, now = Date.now()): boolean {
    return this.cooldownUntil(key) > now;
  }

  inFlight(key: LedgerKey): number {
    return this.#inFlight.get(this.#key(key)) ?? 0;
  }

  inFlightProvider(key: LedgerKey): number {
    return this.#providerInFlight.get(this.#providerKey(key)) ?? 0;
  }

  record(key: LedgerKey): void {
    const entry = this.#ledger.get(this.#key(key)) ?? { requests: 0, failures: 0, lastKind: null, lastAt: 0 };
    entry.requests += 1;
    entry.lastAt = Date.now();
    this.#ledger.set(this.#key(key), entry);
  }

  begin(key: LedgerKey): void {
    const id = this.#key(key);
    this.#inFlight.set(id, (this.#inFlight.get(id) ?? 0) + 1);
    const pid = this.#providerKey(key);
    this.#providerInFlight.set(pid, (this.#providerInFlight.get(pid) ?? 0) + 1);
  }

  end(key: LedgerKey): void {
    const id = this.#key(key);
    const next = Math.max(0, (this.#inFlight.get(id) ?? 0) - 1);
    if (next === 0) this.#inFlight.delete(id);
    else this.#inFlight.set(id, next);
    const pid = this.#providerKey(key);
    const pNext = Math.max(0, (this.#providerInFlight.get(pid) ?? 0) - 1);
    if (pNext === 0) this.#providerInFlight.delete(pid);
    else this.#providerInFlight.set(pid, pNext);
  }

  settle(key: LedgerKey, kind: SettleKind): void {
    const id = this.#key(key);
    this.end(key);
    const entry = this.#ledger.get(id) ?? { requests: 0, failures: 0, lastKind: null, lastAt: 0 };
    entry.lastKind = kind;
    entry.lastAt = Date.now();
    if (kind === "ok") {
      entry.failures = 0;
      this.#cooldown.delete(id);
    } else {
      entry.failures += 1;
      if (entry.failures >= MAX_FAILURES_FOR_COOLDOWN) this.#cooldown.set(id, Date.now() + COOLDOWN_MS);
    }
    this.#ledger.set(id, entry);
  }

  hasRoom(entry: { maxConcurrency: number; providerMaxConcurrency?: number | null }, key: LedgerKey): boolean {
    if (this.inCooldown(key)) return false;
    if (this.inFlight(key) >= entry.maxConcurrency) return false;
    if (entry.providerMaxConcurrency != null && this.inFlightProvider(key) >= entry.providerMaxConcurrency) {
      return false;
    }
    return true;
  }

  status(key: LedgerKey): {
    requests: number;
    failures: number;
    lastKind: SettleKind | null;
    cooldown: boolean;
  } {
    const entry = this.#ledger.get(this.#key(key));
    return {
      requests: entry?.requests ?? 0,
      failures: entry?.failures ?? 0,
      lastKind: entry?.lastKind ?? null,
      cooldown: this.inCooldown(key),
    };
  }
}
