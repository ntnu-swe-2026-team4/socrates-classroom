import type { Usage } from "@earendil-works/pi-ai";
import type { Lang } from "@socrates/shared";
import { one, run } from "../db/d1";
import type { Env } from "../env";
import { sendQuotaAlertEmail } from "../mail";

export interface UsageSample {
  provider: string;
  model: string;
  usage: Usage;
}

const THRESHOLDS = [60, 80, 100] as const;
const CLAIM_TTL_MS = 60_000;

const money = (value: number) => value.toFixed(2);

function monthWindow(now = new Date()): { start: string; label: string } {
  const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), label };
}

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
  for (const threshold of THRESHOLDS) {
    if (spend * 100 < quota * threshold - 1e-9) continue;
    const claimedAt = new Date().toISOString();
    const claim = await run(
      env.DB,
      `INSERT OR IGNORE INTO teacher_quota_alerts (user_id, provider_id, window, threshold, claimed_at)
       VALUES ($uid, $pid, $win, $threshold, $claimed)`,
      { uid: teacherId, pid: sample.provider, win: label, threshold, claimed: claimedAt },
    );
    let owned = claim.meta.changes === 1;
    if (!owned) {
      const steal = await run(
        env.DB,
        `UPDATE teacher_quota_alerts SET claimed_at = $claimed
         WHERE user_id = $uid AND provider_id = $pid AND window = $win AND threshold = $threshold
           AND sent_at IS NULL AND claimed_at <= $stale`,
        {
          uid: teacherId,
          pid: sample.provider,
          win: label,
          threshold,
          claimed: claimedAt,
          stale: new Date(Date.now() - CLAIM_TTL_MS).toISOString(),
        },
      );
      owned = steal.meta.changes === 1;
    }
    if (!owned) continue;
    const delivered = await announce(env, teacherId, sample.provider, label, threshold, spend, quota);
    if (!delivered) {
      await run(
        env.DB,
        `DELETE FROM teacher_quota_alerts
         WHERE user_id = $uid AND provider_id = $pid AND window = $win AND threshold = $threshold`,
        { uid: teacherId, pid: sample.provider, win: label, threshold },
      );
      continue;
    }
    await run(
      env.DB,
      `UPDATE teacher_quota_alerts SET sent_at = $at
       WHERE user_id = $uid AND provider_id = $pid AND window = $win AND threshold = $threshold`,
      { uid: teacherId, pid: sample.provider, win: label, threshold, at: claimedAt },
    );
  }
}
