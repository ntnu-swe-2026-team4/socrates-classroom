import type { Lang } from "@socrates/shared";
import type { EmailMessageBuilder, Env } from "./env";

export interface QuotaAlertEmail {
  to: string;
  lang: Lang;
  teacherName: string;
  provider: string;
  threshold: number;
  spend: string;
  quota: string;
}

const money = (value: string) => `$${value}`;

const SUBJECT: Record<Lang, (provider: string, threshold: number) => string> = {
  zh: (provider, threshold) => `【蘇格拉底教室】${provider} 額度已達 ${threshold}%`,
  en: (provider, threshold) => `[Socrates Classroom] ${provider} usage at ${threshold}% of the monthly quota`,
  es: (provider, threshold) => `[Aula de Sócrates] ${provider} al ${threshold}% de la cuota mensual`,
};

const BODY: Record<Lang, (alert: Omit<QuotaAlertEmail, "to" | "lang">) => string> = {
  zh: (alert) =>
    `${alert.teacherName} 老師您好：\n\n` +
    `您在蘇格拉底教室的 ${alert.provider} 帳號，本月累計用量約 ${money(alert.spend)}／額度 ${money(alert.quota)}（${alert.threshold}%）。\n` +
    `同一水位本月只會提醒一次，下個月自動重置。\n` +
    `調整額度請到設定頁的 Teacher keys。\n`,
  en: (alert) =>
    `Hello ${alert.teacherName},\n\n` +
    `Your ${alert.provider} account in Socrates Classroom has used about ${money(alert.spend)} of its ${money(alert.quota)} monthly quota (${alert.threshold}%).\n` +
    `Each threshold is announced once per month and resets next month.\n` +
    `Adjust the quota on the Teacher keys card in Settings.\n`,
  es: (alert) =>
    `Hola, ${alert.teacherName}:\n\n` +
    `Tu cuenta de ${alert.provider} en el Aula de Sócrates ha usado unos ${money(alert.spend)} de su cuota mensual de ${money(alert.quota)} (${alert.threshold}%).\n` +
    `Cada nivel se avisa una sola vez al mes y se reinicia el mes que viene.\n` +
    `Ajusta la cuota en la tarjeta Teacher keys de Ajustes.\n`,
};

export async function sendQuotaAlertEmail(env: Env, alert: QuotaAlertEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  const message: EmailMessageBuilder = {
    to: alert.to,
    from: env.ALERT_FROM_EMAIL,
    subject: SUBJECT[alert.lang](alert.provider, alert.threshold),
    text: BODY[alert.lang](alert),
  };
  await env.SEND_EMAIL.send(message);
}
