import { createProvider, fauxProvider, type AnyModel } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { createAI } from "agents/models/pi-ai";
import type { Env } from "../env";
import type { AvailabilityEntry } from "../routing/routing-schema";
import { routingConfig } from "../routing/config.gen";
import { teacherCredentialStore, workersAuthContext } from "./credentials";

export interface ModelsBundle {
  models: MutableModels;
  default: AnyModel;
  faux?: ReturnType<typeof fauxProvider>;
}

export interface BuildModelsOptions {
  teacherOf?: () => Promise<string | null>;
}

export function buildModels(env: Env, options: BuildModelsOptions = {}): ModelsBundle {
  if (!env.AI || env.LLM_PROVIDER === "mock") return fauxBundle(env);

  const models = builtinModels({
    credentials: teacherCredentialStore(env, options.teacherOf ?? (async () => null)),
    authContext: workersAuthContext(env),
  });
  const ai = createAI({ binding: env.AI });
  const [head, ...legs] = [...routingConfig.defaults.availability]
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => bindingModelOf(entry))
    .filter((id): id is string => id !== undefined);

  let fallbackHead: AnyModel | undefined;
  if (head) {
    const primary = ai(head, { fallback: legs }) as unknown as AnyModel;
    const wrapped = {
      ...ai.provider,
      getModels: () =>
        (ai.provider.getModels() as unknown as AnyModel[]).map((model) => (model.id === head ? primary : model)),
    };
    models.setProvider(wrapped as never);
    fallbackHead = models.getModel(ai.provider.id, head) as AnyModel | undefined;
  }
  registerDgx(env, models);
  return { models, default: fallbackHead ?? firstResolvable(models) ?? fauxBundle(env).default };
}

function registerDgx(env: Env, models: MutableModels): void {
  const def = routingConfig.providers["dgx-spark"];
  const baseUrl = env.DGX_BASE_URL;
  if (def?.kind !== "openai-completions" || !baseUrl) return;
  const modelId = def.model ?? def.models?.[0]?.id ?? "";
  if (!modelId) return;
  const provider = createProvider({
    id: "dgx-spark",
    name: "dgx-spark",
    baseUrl,
    auth: {
      apiKey: {
        name: "DGX (team-hosted, keyless)",
        resolve: async () => ({ auth: {}, source: "keyless" }),
      },
    },
    models: [
      {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: "dgx-spark",
        baseUrl,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
      } as never,
    ],
    api: { "openai-completions": openAICompletionsApi() },
  });
  models.setProvider(provider as never);
}

function bindingModelOf(entry: AvailabilityEntry): string | undefined {
  const def = routingConfig.providers[entry.provider];
  if (def?.kind !== "binding") return undefined;
  return entry.model ?? def.models?.[0]?.id;
}

function firstResolvable(models: MutableModels): AnyModel | undefined {
  for (const provider of models.getProviders()) {
    const model = models.getModels(provider.id)[0];
    if (model) return model as AnyModel;
  }
  return undefined;
}

function fauxBundle(env: Env): ModelsBundle {
  const tokensPerSecond = env.FAUX_TOKENS_PER_SECOND ? Number(env.FAUX_TOKENS_PER_SECOND) : undefined;
  const faux = fauxProvider(tokensPerSecond ? { tokensPerSecond, tokenSize: { min: 2, max: 4 } } : {});
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, default: faux.getModel() as unknown as AnyModel, faux };
}
