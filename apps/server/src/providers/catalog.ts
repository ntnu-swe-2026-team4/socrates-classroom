import type { Env } from "../env";

export type ProviderId = "dgx-spark" | "opencode-go" | "openrouter" | "mock";

export interface ProviderDescriptor {
  id: ProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  baseUrlEnv?: keyof Env;
  apiKeyEnv?: keyof Env;
  concurrency?: number;
  rpm?: number;
  priority: number;
}

const CATALOG: ProviderDescriptor[] = [
  {
    id: "dgx-spark",
    model: "GLM-5.3-Flash-EXL3",
    baseUrlEnv: "DGX_BASE_URL",
    concurrency: 4,
    priority: 1,
  },
  {
    id: "opencode-go",
    model: "glm-5.3-flash",
    baseUrl: "https://opencode.ai/inference/go/v1",
    apiKeyEnv: "OPENCODE_API_KEY",
    concurrency: 8,
    priority: 2,
  },
  {
    id: "openrouter",
    model: "z-ai/glm-5.3-flash",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    concurrency: 16,
    priority: 3,
  },
  {
    id: "mock",
    model: "socrates-mock",
    priority: 99,
  },
];

export function isMockMode(env: Env): boolean {
  return env.LLM_PROVIDER === "mock";
}

export function availableProviders(env: Env): ProviderDescriptor[] {
  if (isMockMode(env)) return CATALOG.filter((p) => p.id === "mock");
  return CATALOG.filter((p) => {
    if (p.id === "mock") return false;
    const url = p.baseUrl ?? ((p.baseUrlEnv ? env[p.baseUrlEnv] : undefined) as string | undefined);
    if (!url) return false;
    if (p.apiKeyEnv && !env[p.apiKeyEnv]) return false;
    return true;
  });
}

export function resolveBaseUrl(env: Env, provider: ProviderDescriptor): string {
  return provider.baseUrl ?? ((provider.baseUrlEnv ? env[provider.baseUrlEnv] : undefined) as string) ?? "";
}
