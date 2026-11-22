import { ReportAxesPolicySchema, type ReportAxes, type ReportAxesPolicy } from "@socrates/shared";
import { one, run, type Db } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { fail, nowIso } from "../http";

const REPORT_AXES_KEY = "report_axes";
export const activeReportAxesPolicy = "ai";

export async function reportAxesPolicyOf(db: Db): Promise<ReportAxesPolicy> {
  const row = await one<{ value: string }>(db, "SELECT value FROM settings WHERE key = $key", {
    key: REPORT_AXES_KEY,
  });
  const parsed = ReportAxesPolicySchema.safeParse(row?.value);
  return parsed.success ? parsed.data : gatewayConfig.report.axes;
}

export async function setReportAxesPolicy(db: Db, value: ReportAxesPolicy): Promise<void> {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES ($key, $value, $at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { key: REPORT_AXES_KEY, value, at: nowIso() },
  );
}

export function reportAxesFor(requested?: ReportAxes): ReportAxes {
  if (requested !== undefined && requested !== activeReportAxesPolicy) fail(422, "report_axes_not_allowed");
  return activeReportAxesPolicy;
}
