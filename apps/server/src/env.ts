import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  PiAgent: DurableObjectNamespace<import("./do/pi-agent").PiAgent>;
  ActivityEvents: DurableObjectNamespace<import("./do/events").ActivityEvents>;
  Coordinator: DurableObjectNamespace<import("./do/coordinator").Coordinator>;
  ReportJob: DurableObjectNamespace<import("./do/report-job").ReportJob>;
  AI?: Ai;
  PUBLIC_BASE_URL?: string;
  COOKIE_SECURE?: string;
  AUTH_SECRET?: string;
  LLM_PROVIDER?: string;
  DGX_BASE_URL?: string;
  OPENCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  BYOK_ENC_KEY?: string;
  TTS_MODEL?: string;
}
