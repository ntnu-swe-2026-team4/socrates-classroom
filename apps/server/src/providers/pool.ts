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

/** 計數式信號：同時在途上限（自架 = 4）。 */
export function countingGate(limit: number): Gate {
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire() {
      if (inFlight < limit) {
        inFlight += 1;
        return Promise.resolve(true);
      }
      // 佇列滿就回 false（上層換下一個 provider），不無限等
      return Promise.resolve(false);
    },
    release() {
      inFlight = Math.max(0, inFlight - 1);
      const next = waiters.shift();
      if (next) next();
    },
  };
}

/** RPM 滑動窗（Workers AI 預付 credits = 50/min）。 */
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    models: models as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: API_IMPLS as any,
  });
}

export interface PoolChainEntry {
  provider: string;
  model: AnyModel;
  gate?: Gate;
  /** 向 pi-ai 取 auth 時要用的 env key 名（僅 static-key provider 需要） */
  key?: string;
}

export interface Pool {
  models: MutableModels;
  chain: PoolChainEntry[];
}

/** 健康標記：429/失敗的 provider 短時間內跳過（TTL 內視為降級）。 */
const degraded = new Map<string, number>();
const DEGRADE_MS = 60_000;

export function markDegraded(provider: string): void {
  degraded.set(provider, Date.now() + DEGRADE_MS);
}

export function isHealthy(provider: string): boolean {
  const until = degraded.get(provider);
  return !until || until < Date.now();
}

/** 依白名單組出 Models registry 與 fallback 鏈。環境缺 key 的段落自動跳過。 */
export function buildPool(env: Env): Pool {
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
        if (!base) continue; // 未設定 Tunnel 位址就跳過這一段
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          api: API_IMPLS as any,
        });
        models.setProvider(provider);
        const model = models.getModelOfType("chat", "dgx-spark", entry.model);
        if (model)
          chain.push({
            provider: "dgx-spark",
            model: model as unknown as AnyModel,
            gate: countingGate(entry.concurrency ?? 4),
          });
      } else if (entry.provider === "workers-ai") {
        const ai = createAI({ binding: env.AI });
        models.setProvider(ai.provider);
        const model = ai(entry.model);
        chain.push({ provider: "workers-ai", model: model as unknown as AnyModel, gate: rpmGate(50) });
      } else {
        // builtin provider（opencode-go / openrouter / zai / …）：以班級 key 建 static-key provider
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

/** 從 pi-ai builtin 目錄取（baseUrl, model）——BYOK 與班級 static-key 段共用。 */
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

/** 走完整鏈取一次非對話補全（論點草稿／整理／裁判）。全部失敗回 null，呼叫端退回規則式。 */
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
  // pi-ai AssistantMessage.content: Array<{ type: "text", text } | …>
  const content = (message as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return null;
  return (
    content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") || null
  );
}

/** 走完整鏈取一次 JSON 補全（舊 completeJson 契約：失敗回 null）。 */
export async function completeJson<T>(env: Env, system: string, user: string): Promise<T | null> {
  const text = await completeText(env, { system, user, maxTokens: 700 });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
