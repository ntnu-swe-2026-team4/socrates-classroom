import { readFileSync } from "node:fs";
import path from "node:path";

export type Lang = "zh" | "en" | "es";
export type LlmProvider = "openrouter" | "mock";

export interface Config {
  port: number;
  dbPath: string;
  uploadDir: string;
  cookieSecure: boolean;
  corsOrigins: string[];
  openRouterKey: string;
  openRouterModel: string;
  openRouterReferer: string;
  llmProvider: LlmProvider;
  promptPath: string;
  seedDemo: boolean;
}

const serverRoot = path.resolve(import.meta.dirname, "..");

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function modelFromProvidersFile(): string {
  try {
    const file = path.resolve(serverRoot, "../llm/providers/models.json");
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      providers?: { openrouter?: { defaultModel?: string; models?: string[] } };
    };
    return json.providers?.openrouter?.defaultModel ?? json.providers?.openrouter?.models?.[0] ?? "";
  } catch {
    return "";
  }
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const rawDbPath = process.env.DATABASE_PATH ?? "./data/socrates.db";
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const forced = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const llmProvider: LlmProvider = forced === "mock" ? "mock" : "openrouter";
  return {
    port: Number(process.env.PORT ?? 8000),
    dbPath: rawDbPath === ":memory:" ? ":memory:" : path.resolve(serverRoot, rawDbPath),
    uploadDir: path.resolve(serverRoot, process.env.UPLOAD_DIR ?? "./data/uploads"),
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",").map((s) => s.trim()).filter(Boolean),
    openRouterKey: key,
    openRouterModel: process.env.OPENROUTER_MODEL?.trim() || modelFromProvidersFile() || "anthropic/claude-sonnet-5.5",
    openRouterReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() ?? "",
    llmProvider,
    promptPath: path.resolve(serverRoot, "../llm/prompts/socrates.md"),
    seedDemo: bool(process.env.SEED_DEMO, true),
    ...overrides,
  };
}
