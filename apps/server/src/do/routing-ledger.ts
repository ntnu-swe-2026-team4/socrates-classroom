import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import {
  GatewayLedger,
  LEDGER_LEASE_TTL_MS,
  type LedgerCandidate,
  type LedgerReservation,
  type SettleKind,
} from "../gateway/ledger";
import type { LedgerKey } from "../gateway/gateway-schema";

interface Lease {
  key: LedgerKey;
  expiresAt: number;
}

/**
 * One instance per credential (`teacher:<id>`, `platform`): in-flight counters and cooldowns are
 * only meaningful inside a single shard, and the shard key is what makes them globally exact.
 * Accounting lives in memory; a lost instance is a looser limit, never a stuck one.
 */
export class RoutingLedger extends DurableObject<Env> {
  readonly #ledger = new GatewayLedger();
  readonly #leases = new Map<string, Lease>();
  #alarmAt: number | null = null;

  async reserve(candidates: LedgerCandidate[], ttlMs = LEDGER_LEASE_TTL_MS): Promise<LedgerReservation | null> {
    this.#sweep(Date.now());
    const index = candidates.findIndex((candidate) => this.#ledger.hasRoom(candidate, candidate.key));
    if (index < 0) return null;
    const candidate = candidates[index];
    const lease = crypto.randomUUID();
    this.#ledger.record(candidate.key);
    this.#ledger.begin(candidate.key);
    this.#leases.set(lease, { key: candidate.key, expiresAt: Date.now() + ttlMs });
    await this.#arm();
    return { index, lease };
  }

  async admit(candidates: LedgerCandidate[]): Promise<boolean[]> {
    this.#sweep(Date.now());
    return candidates.map((candidate) => this.#ledger.hasRoom(candidate, candidate.key));
  }

  /** Read-only: unlike reserve/admit it never sweeps, so an expired slot is visible until the alarm. */
  async status(
    key: LedgerKey,
  ): Promise<{ inFlight: number; inFlightProvider: number; cooldown: boolean; leases: number }> {
    return {
      inFlight: this.#ledger.inFlight(key),
      inFlightProvider: this.#ledger.inFlightProvider(key),
      cooldown: this.#ledger.inCooldown(key),
      leases: this.#leases.size,
    };
  }

  async release(lease: string): Promise<void> {
    const entry = this.#leases.get(lease);
    if (!entry) return;
    this.#leases.delete(lease);
    this.#ledger.end(entry.key);
  }

  async settle(lease: string, kind: SettleKind): Promise<void> {
    const entry = this.#leases.get(lease);
    if (!entry) return;
    this.#leases.delete(lease);
    this.#ledger.settle(entry.key, kind);
  }

  async alarm(): Promise<void> {
    this.#sweep(Date.now());
    this.#alarmAt = null;
    await this.#arm();
  }

  #sweep(now: number): void {
    for (const [lease, entry] of [...this.#leases]) {
      if (entry.expiresAt > now) continue;
      this.#leases.delete(lease);
      this.#ledger.end(entry.key);
    }
  }

  async #arm(): Promise<void> {
    let earliest = Number.POSITIVE_INFINITY;
    for (const { expiresAt } of this.#leases.values()) earliest = Math.min(earliest, expiresAt);
    if (!Number.isFinite(earliest)) return;
    if (this.#alarmAt !== null && this.#alarmAt <= earliest) return;
    this.#alarmAt = earliest;
    await this.ctx.storage.setAlarm(earliest);
  }
}
