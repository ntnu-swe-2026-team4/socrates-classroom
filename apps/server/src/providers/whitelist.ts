import type { PoolEntry } from "@socrates/shared";

export const CLASS_POOL: PoolEntry[] = [
  { provider: "dgx-spark", model: "GLM-5.3-Flash-EXL3", concurrency: 4 },
  { provider: "opencode-go", model: "glm-5.3-flash" },
  { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  { provider: "workers-ai", model: "@cf/zai-org/glm-4.7-flash" },
];

export const DEV_POOL: PoolEntry[] = [{ provider: "zai", model: "glm-5.3-flash" }, ...CLASS_POOL];

export const MOCK_POOL: PoolEntry[] = [{ provider: "mock", model: "faux-1" }];

export function poolForMode(mode: string | undefined): PoolEntry[] {
  if (mode === "mock") return MOCK_POOL;
  if (mode === "dev") return DEV_POOL;
  return CLASS_POOL;
}
