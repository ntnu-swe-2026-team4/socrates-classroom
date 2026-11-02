import type { PoolEntry } from "@socrates/shared";

/**
 * 班級 pool 的白名單——唯一可路由集（見 docs/providers.md）。
 * 規則：全 ZDR 0-day 模型；Muse Spark／Iceman（會訓練）、Grok／GPT Luna／Claude Haiku
 * （30 天保留）、DeepSeek（ZDR 按月續約）一律禁入。
 */
export const CLASS_POOL: PoolEntry[] = [
  { provider: "dgx-spark", model: "GLM-5.3-Flash-EXL3", concurrency: 4 },
  { provider: "opencode-go", model: "glm-5.3-flash" },
  { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  { provider: "workers-ai", model: "@cf/zai-org/glm-4.7-flash" },
];

/** 開發路由：Coding Plan 優先（額度大、離峰五折），之後同生產鏈。 */
export const DEV_POOL: PoolEntry[] = [{ provider: "zai", model: "glm-5.3-flash" }, ...CLASS_POOL];

/** 測試／離線：pi-ai faux provider。 */
export const MOCK_POOL: PoolEntry[] = [{ provider: "mock", model: "faux-1" }];

export function poolForMode(mode: string | undefined): PoolEntry[] {
  if (mode === "mock") return MOCK_POOL;
  if (mode === "dev") return DEV_POOL;
  return CLASS_POOL;
}
