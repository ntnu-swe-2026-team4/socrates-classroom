import type { Env } from "../env";
import { providerModelOf, type ProviderSchema, type AvailabilityEntry, type LedgerKey } from "./gateway-schema";
import { gatewayConfig } from "./config.gen";
import type { z } from "zod";
import { LEDGER_LEASE_TTL_MS, type LedgerCandidate, type SettleKind } from "./ledger";

export type TrafficClass = "interactive" | "judgment" | "batch";

export interface ResolvedLeg {
  provider: string;
  model: string;
}

export interface RouteDecision {
  entry: AvailabilityEntry;
  model: string;
  key: LedgerKey;
  lease: string | null;
}

const TEACHER_CREDENTIAL_PREFIX = "teacher:";

export function isTeacherCredential(credential: string): boolean {
  return credential.startsWith(TEACHER_CREDENTIAL_PREFIX);
}

interface Candidate {
  entry: AvailabilityEntry;
  model: string;
  key: LedgerKey;
}

const sharedByEnv = new WeakMap<Env, Router>();
const warnedShards = new Set<string>();

export function getRouter(env: Env): Router {
  let router = sharedByEnv.get(env);
  if (!router) {
    router = new Router(env);
    sharedByEnv.set(env, router);
  }
  return router;
}

export class Router {
  readonly #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  async chain(
    trafficClass: TrafficClass,
    canServe?: (entry: ResolvedLeg) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): Promise<AvailabilityEntry[]> {
    const candidates = this.#candidates(trafficClass, canServe, teacherLegs);
    const { admitted } = await this.#admit(candidates);
    return candidates.filter((_, index) => admitted[index]).map((candidate) => candidate.entry);
  }

  async pick(
    trafficClass: TrafficClass,
    canServe?: (entry: ResolvedLeg) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): Promise<RouteDecision | null> {
    for (const group of shardGroups(this.#candidates(trafficClass, canServe, teacherLegs))) {
      const reservation = await this.#reserve(group);
      if (!reservation) continue;
      const candidate = group[reservation.index];
      if (!candidate) return null;
      return { entry: candidate.entry, model: candidate.model, key: candidate.key, lease: reservation.lease };
    }
    return null;
  }

  async budget(
    trafficClass: TrafficClass,
    teacherLegs?: AvailabilityEntry[],
    canServe?: (entry: ResolvedLeg) => boolean,
  ): Promise<number> {
    const candidates = this.#candidates(trafficClass, canServe, teacherLegs);
    const { admitted, degraded } = await this.#admit(candidates);
    if (degraded) return 0;
    const sums = new Map<string, number>();
    const caps = new Map<string, number>();
    for (const [index, candidate] of candidates.entries()) {
      if (!admitted[index]) continue;
      const entry = candidate.entry;
      const id = `${entry.provider}|${entry.credential}`;
      sums.set(id, (sums.get(id) ?? 0) + entry.maxConcurrency);
      caps.set(id, entry.providerMaxConcurrency ?? caps.get(id) ?? Number.POSITIVE_INFINITY);
    }
    let total = 0;
    for (const [id, sum] of sums) total += Math.min(sum, caps.get(id) ?? Number.POSITIVE_INFINITY);
    return total;
  }

  /** Drops the reservation without a verdict — the run never reached the provider. */
  async release(decision: RouteDecision): Promise<void> {
    if (!decision.lease) return;
    const stub = this.#stub(decision.key.credential);
    if (!stub) return;
    try {
      await stub.release(decision.lease);
    } catch (error) {
      warnOnce(decision.key.credential, error);
    }
  }

  async settle(decision: RouteDecision, kind: SettleKind): Promise<void> {
    if (!decision.lease) return;
    const stub = this.#stub(decision.key.credential);
    if (!stub) return;
    try {
      await stub.settle(decision.lease, kind);
    } catch (error) {
      warnOnce(decision.key.credential, error);
    }
  }

  async withRoute<T>(decision: RouteDecision, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.name === "ConversationBusy") await this.release(decision);
      else await this.settle(decision, "error");
      throw error;
    }
  }

  #stub(shard: string) {
    const namespace = this.#env.RoutingLedger;
    if (!namespace) return null;
    return namespace.get(namespace.idFromName(shard));
  }

  /**
   * Fail-open: the ledger is a protective ceiling, not a safety boundary, so an unreachable shard
   * must never stop traffic. The first candidate of the failing shard routes unaccounted.
   */
  async #reserve(group: Candidate[]): Promise<{ index: number; lease: string | null } | null> {
    const head = group[0];
    if (!head) return null;
    const stub = this.#stub(head.key.credential);
    if (!stub) return { index: 0, lease: null };
    try {
      const reservation = await stub.reserve(group.map(ledgerCandidate), LEDGER_LEASE_TTL_MS);
      return reservation ? { index: reservation.index, lease: reservation.lease } : null;
    } catch (error) {
      warnOnce(head.key.credential, error);
      return { index: 0, lease: null };
    }
  }

  async #admit(candidates: Candidate[]): Promise<{ admitted: boolean[]; degraded: boolean }> {
    const admitted = candidates.map(() => true);
    let degraded = false;
    let offset = 0;
    for (const group of shardGroups(candidates)) {
      const head = group[0];
      if (!head) continue;
      const stub = this.#stub(head.key.credential);
      if (!stub) {
        degraded = true;
      } else {
        try {
          const verdicts = await stub.admit(group.map(ledgerCandidate));
          verdicts.forEach((value, index) => {
            admitted[offset + index] = value;
          });
        } catch (error) {
          warnOnce(head.key.credential, error);
          degraded = true;
        }
      }
      offset += group.length;
    }
    return { admitted, degraded };
  }

  #candidates(
    trafficClass: TrafficClass,
    canServe?: (entry: ResolvedLeg) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): Candidate[] {
    const availability = gatewayConfig.trafficClasses[trafficClass]?.availability ?? "defaults";
    const platform = availability === "defaults" ? gatewayConfig.defaults.availability : [];
    return [...(teacherLegs ?? []), ...platform]
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => {
        const def = gatewayConfig.providers[entry.provider];
        const model = def === undefined ? (entry.model ?? "") : (entry.model ?? providerModelOf(def));
        return { entry, def, model };
      })
      .filter((leg) => {
        if (canServe && !canServe({ provider: leg.entry.provider, model: leg.model })) return false;
        if (isTeacherCredential(leg.entry.credential)) return true;
        if (leg.def === undefined) return false;
        if (leg.def.kind === "binding" && !this.#env.AI) return false;
        if (leg.def.kind === "openai-completions") {
          if (!leg.model) return false;
          if (leg.def.baseUrlEnv && !Reflect.get(this.#env, leg.def.baseUrlEnv)) return false;
        }
        return true;
      })
      .map((leg) => ({
        entry: leg.entry,
        model: leg.model,
        key: this.#keyOf(leg.entry, leg.def),
      }));
  }

  #keyOf(entry: AvailabilityEntry, def: z.infer<typeof ProviderSchema> | undefined): LedgerKey {
    return {
      provider: entry.provider,
      model: entry.model ?? (def === undefined ? "" : providerModelOf(def)),
      credential: entry.credential,
    };
  }
}

const ledgerCandidate = (candidate: Candidate): LedgerCandidate => ({
  key: candidate.key,
  maxConcurrency: candidate.entry.maxConcurrency,
  providerMaxConcurrency: candidate.entry.providerMaxConcurrency,
});

/** Priority order survives sharding: only consecutive candidates can share a shard call. */
function shardGroups(candidates: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const last = groups.at(-1);
    if (last?.[0]?.key.credential === candidate.key.credential) last.push(candidate);
    else groups.push([candidate]);
  }
  return groups;
}

function warnOnce(shard: string, error: unknown): void {
  if (warnedShards.has(shard)) return;
  warnedShards.add(shard);
  console.warn(
    `[gateway] ledger ${shard} unavailable — routing without accounting`,
    error instanceof Error ? error.message : typeof error,
  );
}
