import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  type AnyModel,
  type ClassifierApi,
  type ClassifierModel,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { Env } from "../env";
import { availableProviders, isMockMode, resolveBaseUrl, type ProviderId } from "./catalog";
import { buildClefClassifier } from "./clef";

export interface ModelsBundle {
  models: MutableModels;
  byId: Map<ProviderId, AnyModel>;
  faux?: ReturnType<typeof fauxProvider>;
  clef?: { provider: Provider; model: ClassifierModel<ClassifierApi> };
}

function dgxModel(modelId: string, baseUrl: string): AnyModel {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "dgx-spark",
    baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
  } as AnyModel;
}

export function buildModels(env: Env, sessionKey = "socrates"): ModelsBundle {
  const providers = availableProviders(env);
  const models = isMockMode(env) ? createModels({}) : createModels();
  const byId = new Map<ProviderId, AnyModel>();
  let faux: ReturnType<typeof fauxProvider> | undefined;

  for (const descriptor of providers) {
    if (descriptor.id === "mock") {
      faux = fauxProvider();
      models.setProvider(faux.provider);
      byId.set("mock", faux.models[0] as AnyModel);
      continue;
    }
    const baseUrl = resolveBaseUrl(env, descriptor);
    const apiKey = (descriptor.apiKeyEnv ? (env[descriptor.apiKeyEnv] as string | undefined) : undefined) ?? "none";

    const builtin =
      descriptor.id === "dgx-spark"
        ? undefined
        : (getBuiltinModel(descriptor.id as "opencode-go", descriptor.model as never) as AnyModel | undefined);

    const model: AnyModel = builtin ?? dgxModel(descriptor.model, baseUrl);
    const provider = createProvider({
      id: descriptor.id,
      name: descriptor.id,
      baseUrl: model.baseUrl || baseUrl,
      headers: {
        ...(descriptor.userAgent ? { "User-Agent": descriptor.userAgent } : {}),
        ...(descriptor.sessionHeader ? { [descriptor.sessionHeader]: sessionKey } : {}),
      },
      auth: {
        apiKey: {
          name: `${descriptor.id} key`,
          resolve: async () => ({ auth: { apiKey }, source: descriptor.id }),
        },
      },
      models: [model],
      api: { "openai-completions": openAICompletionsApi() },
    } as never);
    models.setProvider(provider);
    const list = provider.getModels();
    if (list[0]) byId.set(descriptor.id, list[0] as AnyModel);
  }

  let clef: ModelsBundle["clef"];
  if (env.AI) {
    clef = buildClefClassifier(env);
    models.setProvider(clef.provider);
  }

  return { models, byId, faux, clef };
}

export function fauxTurn(handle: NonNullable<ModelsBundle["faux"]>, text: string, delayMs = 0): void {
  if (delayMs === 0) {
    handle.setResponses([fauxAssistantMessage([fauxText(text)])]);
    return;
  }
  handle.setResponses([
    async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fauxAssistantMessage([fauxText(text)]);
    },
  ]);
}
