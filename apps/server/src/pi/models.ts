import { createProvider, fauxProvider, type AnyModel } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { createAI } from "agents/models/pi-ai";
import type { Env } from "../env";
import type { AvailabilityEntry } from "../gateway/gateway-schema";
import { gatewayConfig } from "../gateway/config.gen";
import { keyedCredentialStore, workersAuthContext, type DecidedCredential } from "./credentials";

export interface ModelsBundle {
  models: MutableModels;
  default: AnyModel;
  faux?: ReturnType<typeof fauxProvider>;
}

export interface BuildModelsOptions {
  teacherOf?: () => Promise<string | null>;
  keyedOf?: () => DecidedCredential | null;
}

export function buildModels(env: Env, options: BuildModelsOptions = {}): ModelsBundle {
  if (env.LLM_PROVIDER === "mock") return fauxBundle(env);
  if (!env.AI) throw new Error("AI binding is not configured; set LLM_PROVIDER=mock for offline dev");

  const models = builtinModels({
    credentials: keyedCredentialStore(env, options.keyedOf ?? (() => null), options.teacherOf ?? (async () => null)),
    authContext: workersAuthContext(env),
  });
  // Routing through AI Gateway id "default" bills Workers AI inference from the prepaid
  // credits (Unified billing — the 50 rpm tier for paid models); the gateway keeps
  // logging and caching off, so platform-credential traffic stays zero-retention.
  const ai = createAI({ binding: env.AI, id: "default" });
  const [head, ...legs] = [...gatewayConfig.defaults.availability]
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => bindingModelOf(entry))
    .filter((id): id is string => id !== undefined);

  let fallbackHead: AnyModel | undefined;
  if (head) {
    const primary = ai(head, { fallback: legs });
    const wrapped = {
      ...ai.provider,
      getModels: () => ai.provider.getModels().map((model) => (model.id === head ? primary : model)),
    };
    for (const [id, def] of Object.entries(gatewayConfig.providers)) {
      if (def.kind === "binding") models.setProvider({ ...wrapped, id, name: `${wrapped.name} (${id})` });
    }
    models.setProvider(wrapped);
    const headEntry = [...gatewayConfig.defaults.availability]
      .sort((a, b) => a.priority - b.priority)
      .find((entry) => bindingModelOf(entry) === head);
    fallbackHead = headEntry ? models.getModel(headEntry.provider, head) : undefined;
  }
  registerDgx(env, models);
  return { models, default: fallbackHead ?? firstResolvable(models) ?? fauxBundle(env).default };
}

function registerDgx(env: Env, models: MutableModels): void {
  const def = gatewayConfig.providers["dgx-spark"];
  const baseUrl = env.DGX_BASE_URL;
  if (def?.kind !== "openai-completions" || !baseUrl) return;
  const model = def.models?.[0];
  if (!model) return;
  // pi's Model contract requires a real contextWindow; the as-never this replaces used to hide that.
  if (model.contextWindow === undefined || model.maxTokens === undefined) {
    throw new Error("providers.config.yaml: dgx-spark model requires contextWindow and maxTokens");
  }
  const provider = createProvider({
    id: "dgx-spark",
    name: "dgx-spark",
    baseUrl,
    auth: {
      apiKey: {
        name: "DGX (team-hosted, keyless)",
        // pi-ai refuses to send without a non-empty apiKey; the DGX server ignores the header entirely
        resolve: async () => ({ auth: { apiKey: "keyless" }, source: "keyless" }),
      },
    },
    models: [
      {
        id: model.id,
        name: model.id,
        api: "openai-completions",
        provider: "dgx-spark",
        baseUrl,
        reasoning: model.reasoning ?? false,
        input: model.input ?? ["text"],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(def.compat ? { compat: def.compat } : {}),
      },
    ],
    api: { "openai-completions": openAICompletionsApi() },
  });
  models.setProvider(provider);
}

function bindingModelOf(entry: AvailabilityEntry): string | undefined {
  const def = gatewayConfig.providers[entry.provider];
  if (def?.kind !== "binding") return undefined;
  return entry.model ?? def.models?.[0]?.id;
}

function firstResolvable(models: MutableModels): AnyModel | undefined {
  for (const provider of models.getProviders()) {
    const model = models.getModels(provider.id)[0];
    if (model) return model;
  }
  return undefined;
}

function fauxBundle(env: Env): ModelsBundle {
  const tokensPerSecond = env.FAUX_TOKENS_PER_SECOND ? Number(env.FAUX_TOKENS_PER_SECOND) : undefined;
  const faux = fauxProvider(tokensPerSecond ? { tokensPerSecond, tokenSize: { min: 2, max: 4 } } : {});
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, default: faux.getModel(), faux };
}
