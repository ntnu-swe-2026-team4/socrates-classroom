import { readFileSync } from "node:fs";
import path from "node:path";

export type Lang = "zh" | "en" | "es";
export type LlmProvider = "glm" | "mock";

export interface Config {
  port: number;
  dbPath: string;
  uploadDir: string;
  cookieSecure: boolean;
  corsOrigins: string[];
  glmKey: string;
  glmModel: string;
  glmBaseUrl: string;
  llmProvider: LlmProvider;
  promptPath: string;
  /** 名詞查詢的搜尋服務含 tavily（search.json 的 provider）時才需要；只放後端 */
  tavilyKey: string;
  lookupPromptPath: string;
  lookupSearchPath: string;
  seedDemo: boolean;
}

const serverRoot = path.resolve(import.meta.dirname, "..");

/** GLM Coding Plan 的 OpenAI 相容端點；一般 API 是 https://open.bigmodel.cn/api/paas/v4 */
const DEFAULT_GLM_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_GLM_MODEL = "glm-4.6";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

/** `llm/providers/models.json` 的 `providers.glm`：LLM 組改檔案就能換端點與模型。 */
function glmFromProvidersFile(): { baseUrl: string; defaultModel: string } {
  try {
    const file = path.resolve(serverRoot, "../llm/providers/models.json");
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      providers?: { glm?: { baseUrl?: string; defaultModel?: string; models?: string[] } };
    };
    const glm = json.providers?.glm;
    return {
      baseUrl: glm?.baseUrl ?? "",
      defaultModel: glm?.defaultModel ?? glm?.models?.[0] ?? "",
    };
  } catch {
    return { baseUrl: "", defaultModel: "" };
  }
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const rawDbPath = process.env.DATABASE_PATH ?? "./data/socrates.db";
  const glmFile = glmFromProvidersFile();
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const llmProvider: LlmProvider = forced === "mock" ? "mock" : "glm";
  return {
    port: Number(process.env.PORT ?? 8000),
    dbPath: rawDbPath === ":memory:" ? ":memory:" : path.resolve(serverRoot, rawDbPath),
    uploadDir: path.resolve(serverRoot, process.env.UPLOAD_DIR ?? "./data/uploads"),
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",").map((s) => s.trim()).filter(Boolean),
    glmKey: process.env.GLM_API_KEY?.trim() ?? "",
    glmModel: process.env.GLM_MODEL?.trim() || glmFile.defaultModel || DEFAULT_GLM_MODEL,
    glmBaseUrl: (process.env.GLM_BASE_URL?.trim() || glmFile.baseUrl || DEFAULT_GLM_BASE_URL)
      .replace(/\/+$/, ""),
    llmProvider,
    promptPath: path.resolve(serverRoot, "../llm/prompts/socrates.md"),
    tavilyKey: process.env.TAVILY_API_KEY?.trim() ?? "",
    lookupPromptPath: path.resolve(serverRoot, "../llm/prompts/lookup.md"),
    lookupSearchPath: path.resolve(serverRoot, "../llm/lookup/search.json"),
    seedDemo: bool(process.env.SEED_DEMO, true),
    ...overrides,
  };
}
