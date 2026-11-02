import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  PiAgent: DurableObjectNamespace<import("./do/pi-agent").PiAgent>;
  ActivityEvents: DurableObjectNamespace<import("./do/events").ActivityEvents>;
  AI: Ai;
  PUBLIC_BASE_URL?: string;
  COOKIE_SECURE?: string;
  CORS_ORIGINS?: string;
  LLM_PROVIDER?: string;
  SEED_TOKEN?: string;
  OPENCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ZAI_API_KEY?: string;
  BYOK_ENC_KEY?: string;
}
