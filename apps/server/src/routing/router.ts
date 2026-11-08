import { createModels } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { createProvider, type Model } from "@earendil-works/pi-ai";
import type { Env } from "../env";
import type { AvailabilityEntry, LedgerKey } from "./routing-schema";
import { routingConfig } from "./config.gen";
import { RoutingLedger, type SettleKind } from "./ledger";

export type TrafficClass = "interactive" | "judgment" | "batch";

export interface RouteDecision {
  entry: AvailabilityEntry;
  model: string;
  key: LedgerKey;
  baseUrl: string | undefined;
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

  chain(trafficClass: TrafficClass, canServe?: (entry: AvailabilityEntry) => boolean): AvailabilityEntry[] {
    const availability = routingConfig.trafficClasses[trafficClass]?.availability ?? "defaults";
    const list = availability === "defaults" ? routingConfig.defaults.availability : [];
    return [...list]
      .sort((a, b) => a.priority - b.priority)
      .filter((entry) => {
        const def = routingConfig.providers[entry.provider];
        if (!def) return false;
        if (def.kind === "binding" && !this.#env.AI) return false;
        if (def.kind === "openai-completions") {
          if (!entry.model && !def.model) return false;
          if (def.baseUrlEnv && !this.#env[def.baseUrlEnv as keyof Env]) return false;
        }
        if (canServe && !canServe(entry)) return false;
        const key = this.keyOf(entry, def);
        return (
          !this.#ledger.inCooldown(key) &&
          !this.#ledger.isDead(key) &&
          this.#ledger.inFlight(key) < entry.maxConcurrency
        );
      });
  }

  pick(trafficClass: TrafficClass, canServe?: (entry: AvailabilityEntry) => boolean): RouteDecision | null {
    const entry = this.chain(trafficClass, canServe)[0];
    if (!entry) return null;
    const def = routingConfig.providers[entry.provider]!;
    const key = this.keyOf(entry, def);
    this.#ledger.record(key);
    this.#ledger.begin(key);
    return {
      entry,
      model: key.model,
      key,
      baseUrl: def.baseUrlEnv ? (this.#env[def.baseUrlEnv as keyof Env] as string | undefined) : undefined,
    };
  }

  budget(trafficClass: TrafficClass): number {
    return this.chain(trafficClass).reduce((sum, entry) => sum + entry.maxConcurrency, 0);
  }

  settle(decision: RouteDecision, kind: SettleKind): void {
    this.#ledger.settle(decision.key, kind);
  }

  fallbackModels(decision: RouteDecision, trafficClass: TrafficClass): Model<string>[] | undefined {
    const rest = this.chain(trafficClass).filter((e) => e !== decision.entry);
    if (rest.length === 0) return undefined;
    const models: Model<string>[] = [];
    for (const entry of rest) {
      const def = routingConfig.providers[entry.provider]!;
      const modelId = entry.model ?? def.model ?? "";
      if (def.kind === "binding") continue;
      const baseUrl = def.baseUrlEnv ? (this.#env[def.baseUrlEnv as keyof Env] as string | undefined) : undefined;
      if (!baseUrl) continue;
      models.push({
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: entry.provider,
        baseUrl,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
      } as unknown as Model<string>);
    }
    return models.length > 0 ? models : undefined;
  }

  modelsFor(decision: RouteDecision): ReturnType<typeof createModels> | null {
    const def = routingConfig.providers[decision.entry.provider];
    if (def?.kind !== "openai-completions" || !decision.baseUrl) return null;
    const models = createModels();
    const provider = createProvider({
      id: decision.entry.provider,
      name: decision.entry.provider,
      baseUrl: decision.baseUrl,
      auth: {
        apiKey: {
          name: `${decision.entry.provider} key`,
          resolve: async () => ({ auth: { apiKey: "none" }, source: decision.entry.provider }),
        },
      },
      models: [
        {
          id: decision.model,
          name: decision.model,
          api: "openai-completions",
          provider: decision.entry.provider,
          baseUrl: decision.baseUrl,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
        } as never,
      ],
      api: { "openai-completions": openAICompletionsApi() },
    } as never);
    models.setProvider(provider as never);
    return models;
  }

  private keyOf(entry: AvailabilityEntry, def: { model?: string }): LedgerKey {
    return { provider: entry.provider, model: entry.model ?? def.model ?? "", credential: entry.credential };
  }
}
