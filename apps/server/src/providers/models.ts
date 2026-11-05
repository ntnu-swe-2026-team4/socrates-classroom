import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  type AnyModel,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { Env } from "../env";
import { availableProviders, isMockMode, resolveBaseUrl, type ProviderId } from "./catalog";

export interface ModelsBundle {
  models: MutableModels;
  byId: Map<ProviderId, AnyModel>;
  faux?: ReturnType<typeof fauxProvider>;
}

function modelOf(
  providerId: ProviderId,
  modelId: string,
  baseUrl: string,
  cost?: { input: number; output: number },
): AnyModel {
  const compat =
    providerId === "dgx-spark"
      ? { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" as const }
      : {};
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: providerId,
    baseUrl,
    input: ["text"],
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cacheRead: cost?.input ?? 0,
      cacheWrite: cost?.output ?? 0,
    },
    compat,
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
    const provider: Provider = createProvider({
      id: descriptor.id,
      name: descriptor.id,
      baseUrl,
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
      models: [modelOf(descriptor.id, descriptor.model, baseUrl, descriptor.costPerToken)],
      api: { "openai-completions": openAICompletionsApi() },
    } as never);
    models.setProvider(provider);
    const list = provider.getModels();
    if (list[0]) byId.set(descriptor.id, list[0] as AnyModel);
  }

  return { models, byId, faux };
}

export function fauxTurn(handle: NonNullable<ModelsBundle["faux"]>, text: string): void {
  handle.setResponses([fauxAssistantMessage([fauxText(text)])]);
}
