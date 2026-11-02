import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/** cloudflare.config.ts 的 bindings —— 取代舊 config.ts 的 process.env。 */
export interface Env {
  // 儲存
  DB: D1Database;
  UPLOADS: R2Bucket;
  // DO
  PiAgent: DurableObjectNamespace<import("./do/pi-agent").PiAgent>;
  ActivityEvents: DurableObjectNamespace<import("./do/events").ActivityEvents>;
  // AI（Workers AI；pool 壓底）
  AI: Ai;
  // 公開 vars
  PUBLIC_BASE_URL?: string;
  COOKIE_SECURE?: string;
  CORS_ORIGINS?: string;
  /** "pool"（預設）| "dev"（Coding Plan 優先）| "mock"（離線測試） */
  LLM_PROVIDER?: string;
  /** 啟用 POST /api/dev/seed 的 token；未設定則關閉 */
  SEED_TOKEN?: string;
  // secrets
  OPENCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ZAI_API_KEY?: string;
  /** 學生 BYOK key 的 AES-GCM 加密金鑰（base64，32 bytes） */
  BYOK_ENC_KEY?: string;
}
