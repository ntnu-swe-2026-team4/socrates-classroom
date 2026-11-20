import type { Ai } from "@cloudflare/workers-types";

export interface EmailAddress {
  email: string;
  name: string;
}

export interface EmailMessageBuilder {
  to?: string | EmailAddress | (string | EmailAddress)[];
  cc?: string | EmailAddress | (string | EmailAddress)[];
  bcc?: string | EmailAddress | (string | EmailAddress)[];
  from: string | EmailAddress;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendEmailBinding {
  send(message: EmailMessageBuilder): Promise<{ messageId: string }>;
}

export interface Env {
  DB: D1Database;
  Chat: DurableObjectNamespace<import("./do/chat").Chat>;
  ReportRunner: DurableObjectNamespace<import("./do/report-runner").ReportRunner>;
  AI?: Ai;
  PUBLIC_BASE_URL?: string;
  ENVIRONMENT?: string;
  AUTH_SECRET?: string;
  LLM_PROVIDER?: string;
  DGX_BASE_URL?: string;
  TTS_MODEL?: string;
  BYOK_ENC_KEY?: string;
  SEED_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FAUX_TOKENS_PER_SECOND?: string;
  SEND_EMAIL?: SendEmailBinding;
  ALERT_FROM_EMAIL?: string;
  ADMIN_ALERT_EMAIL?: string;
}
