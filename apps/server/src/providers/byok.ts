import {
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import { createProvider, type Api, type Model, type Provider } from "@earendil-works/pi-ai";
import { getBuiltinModel, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { Env } from "../env";

/**
 * BYOK：支援所有 pi 內建、以 API key 認證的 provider。
 * 機制：以 builtin 目錄（getBuiltinModels）+ 學生自己的 key 組出 per-request provider，
 * 註冊到獨立的 Models registry；key 是學生的，帳戶隔離，不碰班級 pool。
 * OAuth／ambient 類（github-copilot、openai-codex、bedrock、vertex、cloudflare-auth）
 * 無法用單一 API key 表達，不進 BYOK 目錄。
 */

/** pi-ai 內建、可 BYOK 的 provider（id → 顯示名稱與預設模型）。 */
export const BYOK_CATALOG: Record<string, { name: string; defaultModel: string; env?: string }> = {
  openrouter: { name: "OpenRouter", defaultModel: "z-ai/glm-5.3-flash", env: "OPENROUTER_API_KEY" },
  zai: { name: "Z.AI (GLM)", defaultModel: "glm-5.3-flash", env: "ZAI_API_KEY" },
  "zai-coding-cn": { name: "Z.AI Coding (China)", defaultModel: "glm-5.3-flash", env: "ZAI_CODING_CN_API_KEY" },
  opencode: { name: "OpenCode Zen", defaultModel: "glm-5.3-flash", env: "OPENCODE_API_KEY" },
  "opencode-go": { name: "OpenCode Go", defaultModel: "glm-5.3-flash", env: "OPENCODE_API_KEY" },
  anthropic: { name: "Anthropic", defaultModel: "claude-sonnet-4-5", env: "ANTHROPIC_API_KEY" },
  openai: { name: "OpenAI", defaultModel: "gpt-5.2", env: "OPENAI_API_KEY" },
  "openai-codex": { name: "OpenAI Codex", defaultModel: "gpt-5.3-codex", env: "OPENAI_API_KEY" },
  google: { name: "Google Gemini", defaultModel: "gemini-3-flash", env: "GEMINI_API_KEY" },
  deepseek: { name: "DeepSeek", defaultModel: "deepseek-v4", env: "DEEPSEEK_API_KEY" },
  groq: { name: "Groq", defaultModel: "llama-4-maverick", env: "GROQ_API_KEY" },
  xai: { name: "xAI", defaultModel: "grok-4", env: "XAI_API_KEY" },
  mistral: { name: "Mistral", defaultModel: "mistral-large", env: "MISTRAL_API_KEY" },
  moonshotai: { name: "Moonshot AI", defaultModel: "kimi-k3", env: "MOONSHOT_API_KEY" },
  minimax: { name: "MiniMax", defaultModel: "minimax-m3", env: "MINIMAX_API_KEY" },
  together: { name: "Together AI", defaultModel: "glm-5.3-flash", env: "TOGETHER_API_KEY" },
  fireworks: { name: "Fireworks", defaultModel: "glm-5.3-flash", env: "FIREWORKS_API_KEY" },
  "vercel-ai-gateway": { name: "Vercel AI Gateway", defaultModel: "z-ai/glm-5.3-flash", env: "AI_GATEWAY_API_KEY" },
  nvidia: { name: "NVIDIA NIM", defaultModel: "deepseek-v4", env: "NVIDIA_API_KEY" },
  baseten: { name: "Baseten", defaultModel: "glm-5.3-flash", env: "BASETEN_API_KEY" },
  huggingface: { name: "Hugging Face", defaultModel: "deepseek-v4", env: "HF_TOKEN" },
  "kimi-coding": { name: "Kimi For Coding", defaultModel: "kimi-k3", env: "KIMI_API_KEY" },
};

export function byokSupported(providerId: string): boolean {
  return providerId in BYOK_CATALOG;
}

/** 混合 API：每個 provider 目錄裡的模型各有自己的 api，全部註冊、按 model.api 路由。 */
function apiMap(): Partial<Record<Api, unknown>> {
  return {
    "openai-completions": openAICompletionsApi(),
    "openai-responses": openAIResponsesApi(),
    "anthropic-messages": anthropicMessagesApi(),
    "google-generative-ai": googleGenerativeAIApi(),
  } as Partial<Record<Api, unknown>>;
}

/** 以學生的 key + pi 內建目錄組出 per-request provider（baseUrl 取自該目錄的模型）。 */
export function byokProvider(providerId: string, apiKey: string, modelId?: string): Provider {
  const meta = BYOK_CATALOG[providerId];
  if (!meta) throw new Error(`byok_provider_unsupported:${providerId}`);
  let models: readonly Model<Api>[];
  try {
    models = (getBuiltinModels as unknown as (p: string) => readonly Model<Api>[])(providerId);
  } catch {
    throw new Error(`byok_provider_unknown:${providerId}`);
  }
  if (!models.length) throw new Error(`byok_provider_unknown:${providerId}`);
  const baseUrl = (modelId ? models.find((m) => m.id === modelId) : models[0])?.baseUrl ?? models[0].baseUrl;
  return createProvider({
    id: providerId,
    name: meta.name,
    baseUrl,
    auth: { apiKey: { name: `${meta.name} API key`, resolve: async () => ({ auth: { apiKey }, source: "BYOK" }) } },
    models,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: apiMap() as any,
  });
}

/** 學生 key 的來源優先序：請求內指定 → D1 儲存值（由呼叫端解密後傳入）。 */
export function resolveByokKey(env: Env, providerId: string, supplied?: string): string | undefined {
  return supplied ?? undefined; // D1 的加密儲存由 routes/byok 讀取後傳入
}
