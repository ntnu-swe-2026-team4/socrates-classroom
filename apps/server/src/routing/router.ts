import type { Env } from "../env";
import { providerModelOf, type ProviderSchema, type AvailabilityEntry, type LedgerKey } from "./routing-schema";
import { routingConfig } from "./config.gen";
import type { z } from "zod";
import { RoutingLedger, type SettleKind } from "./ledger";

export type TrafficClass = "interactive" | "judgment" | "batch";

export interface ResolvedLeg {
  provider: string;
  model: string;
}

export interface RouteDecision {
  entry: AvailabilityEntry;
  model: string;
  key: LedgerKey;
}

const TEACHER_CREDENTIAL_PREFIX = "teacher:";

export function isTeacherCredential(credential: string): boolean {
  return credential.startsWith(TEACHER_CREDENTIAL_PREFIX);
}

const sharedByEnv = new WeakMap<Env, Router>();

export function getRouter(env: Env): Router {
  let router = sharedByEnv.get(env);
  if (!router) {
    router = new Router(env);
    sharedByEnv.set(env, router);
  }
  return router;
}

export class Router {
  readonly #ledger = new RoutingLedger();
  readonly #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  get ledger(): RoutingLedger {
    return this.#ledger;
  }

  chain(
    trafficClass: TrafficClass,
    canServe?: (entry: ResolvedLeg) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): AvailabilityEntry[] {
    const availability = routingConfig.trafficClasses[trafficClass]?.availability ?? "defaults";
    const platform = availability === "defaults" ? routingConfig.defaults.availability : [];
    return [...(teacherLegs ?? []), ...platform]
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => {
        const def = routingConfig.providers[entry.provider] ?? {};
        return { entry, def, model: entry.model ?? providerModelOf(def) };
      })
      .filter((leg) => {
        if (canServe && !canServe({ provider: leg.entry.provider, model: leg.model })) return false;
        if (isTeacherCredential(leg.entry.credential)) {
          const key = { provider: leg.entry.provider, model: leg.model, credential: leg.entry.credential };
          return !this.#ledger.inCooldown(key) && this.#ledger.inFlight(key) < leg.entry.maxConcurrency;
        }
        if (!leg.def.kind) return false;
        if (leg.def.kind === "binding" && !this.#env.AI) return false;
        if (leg.def.kind === "openai-completions") {
          if (!leg.model) return false;
          if (leg.def.baseUrlEnv && !this.#env[leg.def.baseUrlEnv as keyof Env]) return false;
        }
        const key = { provider: leg.entry.provider, model: leg.model, credential: leg.entry.credential };
        return !this.#ledger.inCooldown(key) && this.#ledger.inFlight(key) < leg.entry.maxConcurrency;
      })
      .map((leg) => leg.entry);
  }

  pick(
    trafficClass: TrafficClass,
    canServe?: (entry: ResolvedLeg) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): RouteDecision | null {
    const entry = this.chain(trafficClass, canServe, teacherLegs)[0];
    if (!entry) return null;
    const def = routingConfig.providers[entry.provider] ?? {};
    const key = this.keyOf(entry, def);
    this.#ledger.record(key);
    this.#ledger.begin(key);
    return { entry, model: key.model, key };
  }

  budget(trafficClass: TrafficClass, teacherLegs?: AvailabilityEntry[]): number {
    return this.chain(trafficClass, undefined, teacherLegs).reduce((sum, entry) => sum + entry.maxConcurrency, 0);
  }

  settle(decision: RouteDecision, kind: SettleKind): void {
    this.#ledger.settle(decision.key, kind);
  }

  async withRoute<T>(decision: RouteDecision, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.name === "ConversationBusy") this.#ledger.end(decision.key);
      else this.settle(decision, "error");
      throw error;
    }
  }

  private keyOf(entry: AvailabilityEntry, def: z.infer<typeof ProviderSchema>): LedgerKey {
    return { provider: entry.provider, model: entry.model ?? providerModelOf(def), credential: entry.credential };
  }
}
