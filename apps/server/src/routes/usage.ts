import { Hono } from "hono";
import { USAGE_THRESHOLDS, UsageQuotaInputSchema, type AdminUsageAlert, type Lang, type Usage } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import type { Env } from "../env";
import { nowIso, parseBody, requireAdmin, requireMember, type AppEnv } from "../http";

export interface AlertEmail {
  to: string[];
  subject: string;
  text: string;
}

export type EmailSender = (email: AlertEmail) => Promise<void>;

interface SendEmailBinding {
  send(message: unknown): Promise<void>;
}

export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function resetsAt(month: string): string {
  const [year = 0, index = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 1)).toISOString();
}

export function emailSenderOf(env: Env): EmailSender | null {
  const binding = env.ALERT_EMAIL as SendEmailBinding | undefined;
  const from = env.ALERT_EMAIL_FROM;
  if (!binding || !from) return null;
  return async (email) => {
    const { EmailMessage } = await import("cloudflare:email");
    for (const to of email.to) {
      const raw = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(email.subject)))}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        btoa(String.fromCharCode(...new TextEncoder().encode(email.text))),
      ].join("\r\n");
      await binding.send(new EmailMessage(from, to, raw));
    }
  };
}

const EMAIL_TEXT: Record<Lang, (v: { name: string; threshold: number; tokens: number; quota: number }) => AlertEmail> =
  {
    zh: (v) => ({
      to: [],
      subject: `詰問：本月用量已達額度的 ${v.threshold}%`,
      text: `${v.name} 的自備金鑰本月已使用 ${v.tokens} tokens，達到設定額度 ${v.quota} tokens 的 ${v.threshold}%。\n可在設定頁的「用量」調整額度。`,
    }),
    en: (v) => ({
      to: [],
      subject: `Elenchus: usage has reached ${v.threshold}% of the quota this month`,
      text: `${v.name}'s own keys have used ${v.tokens} tokens this month, which is ${v.threshold}% of the ${v.quota}-token quota.\nThe quota can be changed under Usage on the settings page.`,
    }),
    es: (v) => ({
      to: [],
      subject: `Elenchus: el uso alcanzó el ${v.threshold}% de la cuota este mes`,
      text: `Las claves propias de ${v.name} han usado ${v.tokens} tokens este mes, el ${v.threshold}% de la cuota de ${v.quota} tokens.\nLa cuota se puede cambiar en Uso, en la página de ajustes.`,
    }),
  };

async function raiseAlerts(env: Env, ownerId: string, month: string): Promise<void> {
  const row = await one<{ quota: number | null; tokens: number | null }>(
    env.DB,
    `SELECT u.usage_quota_tokens AS quota,
       (SELECT tokens FROM usage_months m WHERE m.owner_id = u.id AND m.month = $month) AS tokens
     FROM users u WHERE u.id = $id`,
    { id: ownerId, month },
  );
  const quota = row?.quota ?? 0;
  const tokens = row?.tokens ?? 0;
  if (quota <= 0) return;
  for (const threshold of USAGE_THRESHOLDS) {
    if (tokens * 100 < quota * threshold) continue;
    await run(
      env.DB,
      "INSERT OR IGNORE INTO usage_alerts (owner_id, month, threshold, created_at) VALUES ($id, $month, $threshold, $at)",
      { id: ownerId, month, threshold, at: nowIso() },
    );
  }
}

export async function flushUsageAlerts(env: Env, sender = emailSenderOf(env), now = new Date()): Promise<number> {
  if (!sender) return 0;
  const month = monthOf(now);
  const pending = await all<{
    owner_id: string;
    threshold: number;
    name: string;
    email: string | null;
    lang: string | null;
    quota: number | null;
    tokens: number | null;
  }>(
    env.DB,
    `SELECT a.owner_id, a.threshold, u.name, u.email, u.lang, u.usage_quota_tokens AS quota, m.tokens
     FROM usage_alerts a JOIN users u ON u.id = a.owner_id
     LEFT JOIN usage_months m ON m.owner_id = a.owner_id AND m.month = a.month
     WHERE a.emailed_at IS NULL AND a.month = $month ORDER BY a.created_at LIMIT 50`,
    { month },
  );
  if (pending.length === 0) return 0;
  const admins = await all<{ email: string }>(
    env.DB,
    "SELECT email FROM users WHERE is_admin = 1 AND email IS NOT NULL",
  );
  let sent = 0;
  for (const alert of pending) {
    const to = alert.email ? [alert.email] : admins.map((admin) => admin.email);
    if (to.length === 0) continue;
    const lang: Lang = alert.lang === "en" || alert.lang === "es" ? alert.lang : "zh";
    const email = EMAIL_TEXT[lang]({
      name: alert.name,
      threshold: alert.threshold,
      tokens: alert.tokens ?? 0,
      quota: alert.quota ?? 0,
    });
    try {
      await sender({ ...email, to });
    } catch (error) {
      console.warn("[usage] alert email failed", error instanceof Error ? error.message : "unknown error");
      continue;
    }
    await run(
      env.DB,
      "UPDATE usage_alerts SET emailed_at = $at WHERE owner_id = $id AND month = $month AND threshold = $threshold",
      { at: nowIso(), id: alert.owner_id, month, threshold: alert.threshold },
    );
    sent += 1;
  }
  return sent;
}

export async function recordUsage(
  env: Env,
  ownerId: string,
  tokens: number,
  options: { now?: Date; sender?: EmailSender | null } = {},
): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const now = options.now ?? new Date();
  const month = monthOf(now);
  await run(
    env.DB,
    `INSERT INTO usage_months (owner_id, month, tokens, requests, updated_at) VALUES ($id, $month, $tokens, 1, $at)
     ON CONFLICT (owner_id, month) DO UPDATE SET tokens = tokens + excluded.tokens, requests = requests + 1, updated_at = excluded.updated_at`,
    { id: ownerId, month, tokens: Math.round(tokens), at: now.toISOString() },
  );
  await raiseAlerts(env, ownerId, month);
  await flushUsageAlerts(env, options.sender === undefined ? emailSenderOf(env) : options.sender, now);
}

async function usageOf(env: Env, ownerId: string, now = new Date()): Promise<Usage> {
  const month = monthOf(now);
  const row = await one<{ quota: number | null; tokens: number | null; requests: number | null }>(
    env.DB,
    `SELECT u.usage_quota_tokens AS quota, m.tokens, m.requests
     FROM users u LEFT JOIN usage_months m ON m.owner_id = u.id AND m.month = $month WHERE u.id = $id`,
    { id: ownerId, month },
  );
  const alerts = await all<{ threshold: number; created_at: string; emailed_at: string | null }>(
    env.DB,
    "SELECT threshold, created_at, emailed_at FROM usage_alerts WHERE owner_id = $id AND month = $month",
    { id: ownerId, month },
  );
  return {
    month,
    tokens: row?.tokens ?? 0,
    requests: row?.requests ?? 0,
    quota: row?.quota ?? null,
    resetsAt: resetsAt(month),
    emailReady: emailSenderOf(env) !== null,
    thresholds: USAGE_THRESHOLDS.map((threshold) => {
      const hit = alerts.find((alert) => alert.threshold === threshold);
      return { threshold, reachedAt: hit?.created_at ?? null, emailedAt: hit?.emailed_at ?? null };
    }),
  };
}

export function usageRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/usage", async (c) => {
      const user = requireMember(c);
      return c.json(await usageOf(c.env, user.id));
    })
    .put("/settings/usage/quota", async (c) => {
      const user = requireMember(c);
      const input = await parseBody(c, UsageQuotaInputSchema);
      await run(c.env.DB, "UPDATE users SET usage_quota_tokens = $quota WHERE id = $id", {
        id: user.id,
        quota: input.tokens,
      });
      const month = monthOf(new Date());
      if (input.tokens === null) {
        await run(c.env.DB, "DELETE FROM usage_alerts WHERE owner_id = $id AND month = $month AND emailed_at IS NULL", {
          id: user.id,
          month,
        });
      } else {
        await raiseAlerts(c.env, user.id, month);
        await flushUsageAlerts(c.env);
      }
      return c.json(await usageOf(c.env, user.id));
    })
    .get("/admin/usage-alerts", async (c) => {
      requireAdmin(c);
      const rows = await all<{
        owner_id: string;
        name: string;
        email: string | null;
        month: string;
        threshold: number;
        tokens: number | null;
        quota: number | null;
        created_at: string;
        emailed_at: string | null;
      }>(
        c.env.DB,
        `SELECT a.owner_id, u.name, u.email, a.month, a.threshold, m.tokens, u.usage_quota_tokens AS quota,
           a.created_at, a.emailed_at
         FROM usage_alerts a JOIN users u ON u.id = a.owner_id
         LEFT JOIN usage_months m ON m.owner_id = a.owner_id AND m.month = a.month
         ORDER BY a.created_at DESC LIMIT 50`,
      );
      return c.json(
        rows.map(
          (row): AdminUsageAlert => ({
            ownerId: row.owner_id,
            name: row.name,
            email: row.email,
            month: row.month,
            threshold: row.threshold,
            tokens: row.tokens ?? 0,
            quota: row.quota,
            createdAt: row.created_at,
            emailedAt: row.emailed_at,
          }),
        ),
      );
    });
}
