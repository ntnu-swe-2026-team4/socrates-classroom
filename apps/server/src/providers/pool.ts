import { createAI } from "agents/models/pi-ai";
import {
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  type AnyModel,
  type Api,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Env } from "../env";
import { poolForMode } from "./whitelist";

export interface Gate {
  acquire(): Promise<boolean>;
  release(): void;
}

export function countingGate(limit: number): Gate {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire() {
      if (inFlight < limit) {
        inFlight += 1;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    release() {
      inFlight = Math.max(0, inFlight - 1);
      const next = waiters.shift();
      if (next) next();
    },
  };
}

export function rpmGate(perMinute: number): Gate {
  const hits: number[] = [];
  return {
    acquire() {
      const now = Date.now();
      while (hits.length && now - hits[0] >= 60_000) hits.shift();
      if (hits.length >= perMinute) return Promise.resolve(false);
      hits.push(now);
      return Promise.resolve(true);
    },
    release() {},
  };
}

const API_IMPLS = {
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "anthropic-messages": anthropicMessagesApi(),
  "google-generative-ai": googleGenerativeAIApi(),
} as Partial<Record<Api, unknown>>;

function staticKeyProvider(
  id: string,
  baseUrl: string,
  key: string,
  models: AnyModel[] | readonly AnyModel[],
  name?: string,
): Provider {
  return createProvider({
    id,
    name: name ?? id,
    baseUrl,
    auth: { apiKey: { name: `${id} API key`, resolve: async () => ({ auth: { apiKey: key }, source: id }) } },
    models: models as any,
    api: API_IMPLS as any,
  });
}

export interface PoolChainEntry {
  provider: string;
  model: AnyModel;
  gate?: Gate;
  key?: string;
}

const gateRegistry = new Map<string, Gate>();

function persistentGate(provider: string, factory: () => Gate): Gate {
  let gate = gateRegistry.get(provider);
  if (!gate) {
    gate = factory();
    gateRegistry.set(provider, gate);
  }
  return gate;
}

let poolCache: { key: string; pool: Pool } | undefined;

function poolKey(env: Env): string {
  const e = env as Env & { DGX_BASE_URL?: string; DGX_API_KEY?: string };
  return [env.LLM_PROVIDER, e.DGX_BASE_URL, e.DGX_API_KEY, env.OPENCODE_API_KEY, env.OPENROUTER_API_KEY, env.ZAI_API_KEY].join("\u0000");
}

export interface Pool {
  models: MutableModels;
  chain: PoolChainEntry[];
}

const degraded = new Map<string, number>();
const DEGRADE_MS = 60_000;

export function markDegraded(provider: string): void {
  degraded.set(provider, Date.now() + DEGRADE_MS);
}

export function isHealthy(provider: string): boolean {
  const until = degraded.get(provider);
  return !until || until < Date.now();
}

export function buildPool(env: Env): Pool {
  const key = poolKey(env);
  if (env.LLM_PROVIDER !== "mock" && poolCache?.key === key) return poolCache.pool;
  const mode = env.LLM_PROVIDER;
  const entries = poolForMode(mode);
  const models = mode === "mock" ? createModels({}) : createModels();
  const chain: PoolChainEntry[] = [];

  for (const entry of entries) {
    try {
      if (entry.provider === "mock") {
        const handle = fauxProvider({});
        models.setProvider(handle.provider);
        handle.setResponses([() => fauxAssistantMessage([fauxText("[neutral] 這是離線測試回覆。你想先聊聊什麼？")])]);
        const model = handle.getModel("faux-1");
        if (model) chain.push({ provider: "mock", model: model as unknown as AnyModel });
      } else if (entry.provider === "dgx-spark") {
        const base = (env as Env & { DGX_BASE_URL?: string }).DGX_BASE_URL;
        if (!base) continue;
        const provider = createProvider({
          id: "dgx-spark",
          name: "DGX Spark (self-hosted)",
          baseUrl: base,
          auth: {
            apiKey: {
              name: "DGX access",
              resolve: async () => ({
                auth: { apiKey: (env as Env & { DGX_API_KEY?: string }).DGX_API_KEY ?? "none" },
                source: "self-hosted",
              }),
            },
          },
          models: [
            {
              id: entry.model,
              provider: "dgx-spark",
              baseUrl: base,
              name: "GLM 5.3 Flash EXL3 (2x DGX Spark, 1M ctx)",
              api: "openai-completions",
              reasoning: true,
              input: ["text", "image"] as Array<"text" | "image">,
              contextWindow: 1_048_576,
              maxTokens: 16_384,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            },
          ],
          api: API_IMPLS as any,
        });
        models.setProvider(provider);
        const model = models.getModelOfType("chat", "dgx-spark", entry.model);
        if (model)
          chain.push({
            provider: "dgx-spark",
            model: model as unknown as AnyModel,
            gate: persistentGate("dgx-spark", () => countingGate(entry.concurrency ?? 4)),
          });
      } else if (entry.provider === "workers-ai") {
        const ai = createAI({ binding: env.AI });
        models.setProvider(ai.provider);
        const model = ai(entry.model);
        chain.push({ provider: "workers-ai", model: model as unknown as AnyModel, gate: persistentGate("workers-ai", () => rpmGate(50)) });
      } else {
        const key = keyFor(env, entry.provider);
        if (!key) continue;
        const builtin = firstBuiltin(entry.provider, entry.model);
        if (!builtin) continue;
        models.setProvider(staticKeyProvider(entry.provider, builtin.baseUrl, key, [builtin.model], entry.provider));
        const model = models.getModelOfType("chat", entry.provider, entry.model);
        if (model) chain.push({ provider: entry.provider, model: model as unknown as AnyModel });
      }
    } catch (error) {
      console.warn(`[pool] skip ${entry.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (mode !== "mock") poolCache = { key: poolKey(env), pool: { models, chain } };
  return { models, chain };
}

function keyFor(env: Env, provider: string): string | undefined {
  switch (provider) {
    case "opencode-go":
    case "opencode":
      return env.OPENCODE_API_KEY;
    case "openrouter":
      return env.OPENROUTER_API_KEY;
    case "zai":
      return env.ZAI_API_KEY;
    case "zai-coding-cn":
      return env.ZAI_API_KEY;
    default:
      return undefined;
  }
}

export function firstBuiltin(provider: string, modelId: string): { baseUrl: string; model: AnyModel } | undefined {
  try {
    const lookup = getBuiltinModel as unknown as (p: string, m: string) => AnyModel & { baseUrl: string };
    const model = lookup(provider, modelId);
    if (!model?.baseUrl) return undefined;
    return { baseUrl: model.baseUrl, model };
  } catch {
    return undefined;
  }
}

export async function completeText(
  env: Env,
  opts: { system: string; user: string; maxTokens?: number },
): Promise<string | null> {
  const pool = buildPool(env);
  for (const item of pool.chain) {
    if (!isHealthy(item.provider)) continue;
    if (item.gate && !(await item.gate.acquire())) continue;
    try {
      const message = await pool.models.complete(
        item.model as never,
        {
          system: opts.system,
          messages: [{ role: "user", content: opts.user, timestamp: Date.now() }],
        } as never,
        { maxTokens: opts.maxTokens ?? 700 } as never,
      );
      const text = extractText(message);
      if (text?.trim()) return text;
      markDegraded(item.provider);
    } catch (error) {
      console.warn(`[pool] ${item.provider} failed:`, error instanceof Error ? error.message : String(error));
      markDegraded(item.provider);
    } finally {
      item.gate?.release();
    }
  }
  return null;
}

function extractText(message: unknown): string | null {
  const content = (message as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return null;
  return (
    content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") || null
  );
}

export async function completeJson<T>(env: Env, system: string, user: string): Promise<T | null> {
  const text = await completeText(env, { system, user, maxTokens: 700 });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
