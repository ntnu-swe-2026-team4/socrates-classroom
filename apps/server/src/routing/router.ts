import type { Env } from "../env";
import type { AvailabilityEntry, LedgerKey } from "./routing-schema";
import { routingConfig } from "./config.gen";
import { RoutingLedger, type SettleKind } from "./ledger";

export type TrafficClass = "interactive" | "judgment" | "batch";

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
    canServe?: (entry: AvailabilityEntry) => boolean,
    teacherLegs?: AvailabilityEntry[],
  ): AvailabilityEntry[] {
    const availability = routingConfig.trafficClasses[trafficClass]?.availability ?? "defaults";
    const platform = availability === "defaults" ? routingConfig.defaults.availability : [];
    return [...(teacherLegs ?? []), ...platform]
      .sort((a, b) => a.priority - b.priority)
      .filter((entry) => {
        if (canServe && !canServe(entry)) return false;
        if (isTeacherCredential(entry.credential)) {
          const key = this.keyOf(entry, {});
          return !this.#ledger.inCooldown(key) && this.#ledger.inFlight(key) < entry.maxConcurrency;
        }
        const def = routingConfig.providers[entry.provider];
        if (!def) return false;
        if (def.kind === "binding" && !this.#env.AI) return false;
        if (def.kind === "openai-completions") {
          if (!entry.model && !def.model) return false;
          if (def.baseUrlEnv && !this.#env[def.baseUrlEnv as keyof Env]) return false;
        }
        const key = this.keyOf(entry, def);
        return !this.#ledger.inCooldown(key) && this.#ledger.inFlight(key) < entry.maxConcurrency;
      });
  }

  pick(
    trafficClass: TrafficClass,
    canServe?: (entry: AvailabilityEntry) => boolean,
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

  private keyOf(entry: AvailabilityEntry, def: { model?: string }): LedgerKey {
    return { provider: entry.provider, model: entry.model ?? def.model ?? "", credential: entry.credential };
  }
}
