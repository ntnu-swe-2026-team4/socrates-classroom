import { fauxProvider } from "@earendil-works/pi-ai";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import type { AnyModel } from "@earendil-works/pi-ai";
import { createAI } from "agents/models/pi-ai";
import type { Env } from "../env";
import type { AvailabilityEntry } from "../routing/routing-schema";
import { routingConfig } from "../routing/config.gen";

export interface ModelsBundle {
  models: MutableModels;
  default: AnyModel;
  faux?: ReturnType<typeof fauxProvider>;
}

export function buildModels(env: Env): ModelsBundle {
  const models = createModels();
  if (!env.AI || env.LLM_PROVIDER === "mock") {
    const tokensPerSecond = env.FAUX_TOKENS_PER_SECOND ? Number(env.FAUX_TOKENS_PER_SECOND) : undefined;
    const faux = fauxProvider(tokensPerSecond ? { tokensPerSecond, tokenSize: { min: 2, max: 4 } } : {});
    models.setProvider(faux.provider);
    return { models, default: faux.getModel() as AnyModel, faux };
  }
  const ai = createAI({ binding: env.AI });

  const chain = [...routingConfig.defaults.availability]
    .sort((a, b) => a.priority - b.priority)
    .map((entry: AvailabilityEntry) => bindingModelOf(entry))
    .filter((id): id is string => id !== undefined);
  const [head, ...legs] = chain;
  if (!head) {
    const tokensPerSecond = env.FAUX_TOKENS_PER_SECOND ? Number(env.FAUX_TOKENS_PER_SECOND) : undefined;
    const faux = fauxProvider(tokensPerSecond ? { tokensPerSecond, tokenSize: { min: 2, max: 4 } } : {});
    models.setProvider(faux.provider);
    return { models, default: faux.getModel() as AnyModel, faux };
  }
  const primary = ai(head, { fallback: legs }) as unknown as AnyModel;

  const wrapped = {
    ...ai.provider,
    getModels: () =>
      (ai.provider.getModels() as unknown as AnyModel[]).map((model) => (model.id === head ? primary : model)),
  };
  models.setProvider(wrapped as never);
  return { models, default: primary };
}

function bindingModelOf(entry: AvailabilityEntry): string | undefined {
  const def = routingConfig.providers[entry.provider];
  if (def?.kind !== "binding") return undefined;
  return entry.model ?? def.models?.[0]?.id;
}
