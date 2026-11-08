import type { Ai } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  ReportRunner: DurableObjectNamespace<import("./do/report-runner").ReportRunner>;
  AI?: Ai;
  PUBLIC_BASE_URL?: string;
  COOKIE_SECURE?: string;
  AUTH_SECRET?: string;
  LLM_PROVIDER?: string;
  DGX_BASE_URL?: string;
  TTS_MODEL?: string;
  BYOK_ENC_KEY?: string;
  SEED_TOKEN?: string;
  FAUX_TOKENS_PER_SECOND?: string;
}
