import type { Usage } from "@earendil-works/pi-ai";
import type { Lang } from "@socrates/shared";
import { one, run } from "../db/d1";
import type { Env } from "../env";
import type { DecidedCredential } from "../pi/credentials";
import { sendAdminQuotaAlertEmail, sendQuotaAlertEmail } from "../mail";
import { ADMIN_CREDENTIAL_PREFIX, TEACHER_CREDENTIAL_PREFIX, isAdminCredential, isTeacherCredential } from "./router";
import { claimQuotaThresholds, monthWindow } from "./quota-alerts";

export interface UsageSample {
  provider: string;
  model: string;
  usage: Usage;
}

const money = (value: number) => value.toFixed(2);

async function announce(
  env: Env,
  teacherId: string,
  provider: string,
  label: string,
  threshold: number,
  spend: number,
  quota: number,
): Promise<boolean> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) {
    console.warn("[quota]", provider, label, threshold, "crossed without an email path");
    return true;
  }
  try {
    const teacher = await one<{ name: string; email: string | null; lang: Lang }>(
      env.DB,
      "SELECT name, email, lang FROM users WHERE id = $id",
      { id: teacherId },
    );
    const recipients: Array<{ to: string; lang: Lang; teacherName: string }> = [];
    if (teacher?.email) {
      recipients.push({ to: teacher.email, lang: teacher.lang, teacherName: teacher.name });
    }
    if (env.ADMIN_ALERT_EMAIL) {
      recipients.push({ to: env.ADMIN_ALERT_EMAIL, lang: "zh", teacherName: teacher?.name ?? teacherId });
    }
    for (const recipient of recipients) {
      await sendQuotaAlertEmail(env, {
        to: recipient.to,
        lang: recipient.lang,
        teacherName: recipient.teacherName,
        provider,
        threshold,
        spend: money(spend),
        quota: money(quota),
      });
    }
    return true;
  } catch (error) {
    console.warn(
      "[quota]",
      provider,
      label,
      threshold,
      "announce failed:",
      error instanceof Error ? error.message : typeof error,
    );
    return false;
  }
}

export async function recordTeacherUsage(env: Env, teacherId: string | null, sample: UsageSample): Promise<void> {
  if (!teacherId) return;
  const key = await one<{ monthly_quota_usd: number | null }>(
    env.DB,
    "SELECT monthly_quota_usd FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid",
    { uid: teacherId, pid: sample.provider },
  );
  if (!key) return;
  await run(
    env.DB,
    `INSERT INTO teacher_key_usage (user_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed)
     VALUES ($uid, $pid, $model, $input, $output, $total, $cost, $billed)`,
    {
      uid: teacherId,
      pid: sample.provider,
      model: sample.model,
      input: sample.usage.input,
      output: sample.usage.output,
      total: sample.usage.totalTokens,
      cost: sample.usage.cost.total,
      billed: sample.usage.cost.totalFromProvider ? 1 : 0,
    },
  );
  const quota = key.monthly_quota_usd;
  if (quota === null || quota <= 0) return;
  const { start, label } = monthWindow();
  const spendRow = await one<{ spend: number }>(
    env.DB,
    `SELECT COALESCE(SUM(cost_usd), 0) AS spend
     FROM teacher_key_usage
     WHERE user_id = $uid AND provider_id = $pid AND created_at >= $start`,
    { uid: teacherId, pid: sample.provider, start },
  );
  const spend = spendRow?.spend ?? 0;
  await claimQuotaThresholds(
    env.DB,
    "teacher_quota_alerts",
    { user_id: teacherId, provider_id: sample.provider },
    spend,
    quota,
    async (threshold) => announce(env, teacherId, sample.provider, label, threshold, spend, quota),
  );
}

async function announceAdmin(
  env: Env,
  provider: string,
  threshold: number,
  spend: number,
  quota: number,
): Promise<boolean> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) {
    console.warn("[quota]", "admin", provider, threshold, "crossed without an email path");
    return true;
  }
  if (!env.ADMIN_ALERT_EMAIL) {
    console.warn("[quota]", "admin", provider, threshold, "crossed without an admin alert address");
    return true;
  }
  try {
    await sendAdminQuotaAlertEmail(env, {
      to: env.ADMIN_ALERT_EMAIL,
      provider,
      threshold,
      spend: money(spend),
      quota: money(quota),
    });
    return true;
  } catch (error) {
    console.warn(
      "[quota]",
      "admin",
      provider,
      threshold,
      "announce failed:",
      error instanceof Error ? error.message : typeof error,
    );
    return false;
  }
}

/**
 * Attribution gate for keyed legs: the router decision's credential decides
 * which pool a turn bills — teacher:<uid> → the teacher's quota, admin:<id> →
 * the platform pool. Platform binding legs record nothing here; their meter
 * shape rides on #211/#80.
 */
export async function recordKeyedUsage(
  env: Env,
  decided: DecidedCredential | null,
  sample: UsageSample,
): Promise<void> {
  if (!decided || decided.provider !== sample.provider) return;
  if (isTeacherCredential(decided.credential)) {
    await recordTeacherUsage(env, decided.credential.slice(TEACHER_CREDENTIAL_PREFIX.length), sample);
    return;
  }
  if (isAdminCredential(decided.credential)) {
    await recordAdminUsage(env, decided.credential.slice(ADMIN_CREDENTIAL_PREFIX.length), sample);
  }
}

export async function recordAdminUsage(env: Env, adminKeyId: string, sample: UsageSample): Promise<void> {
  const key = await one<{ provider_id: string; monthly_quota_usd: number | null }>(
    env.DB,
    "SELECT provider_id, monthly_quota_usd FROM admin_keys WHERE id = $id",
    { id: adminKeyId },
  );
  if (!key) return;
  await run(
    env.DB,
    `INSERT INTO admin_key_usage (admin_key_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed)
     VALUES ($id, $pid, $model, $input, $output, $total, $cost, $billed)`,
    {
      id: adminKeyId,
      pid: key.provider_id,
      model: sample.model,
      input: sample.usage.input,
      output: sample.usage.output,
      total: sample.usage.totalTokens,
      cost: sample.usage.cost.total,
      billed: sample.usage.cost.totalFromProvider ? 1 : 0,
    },
  );
  const quota = key.monthly_quota_usd;
  if (quota === null || quota <= 0) return;
  const { start } = monthWindow();
  const spendRow = await one<{ spend: number }>(
    env.DB,
    `SELECT COALESCE(SUM(cost_usd), 0) AS spend
     FROM admin_key_usage
     WHERE admin_key_id = $id AND created_at >= $start`,
    { id: adminKeyId, start },
  );
  const spend = spendRow?.spend ?? 0;
  await claimQuotaThresholds(env.DB, "admin_quota_alerts", { admin_key_id: adminKeyId }, spend, quota, (threshold) =>
    announceAdmin(env, key.provider_id, threshold, spend, quota),
  );
}
