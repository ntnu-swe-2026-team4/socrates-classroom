import { ReportAxesPolicySchema, type ReportAxes, type ReportAxesPolicy } from "@socrates/shared";
import type { Db } from "../db/d1";
import { one, run } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { fail, nowIso } from "../http";

const REPORT_AXES_KEY = "report_axes";

/**
 * Who decides the class report's value axes now (#159): the admin's setting (PUT /api/admin/settings), or, until an
 * admin has set it, report.axes in providers.config.yaml. teacher / ai = only that one; both = the teacher chooses.
 */
export async function reportAxesPolicyOf(db: Db): Promise<ReportAxesPolicy> {
  const row = await one<{ value: string }>(db, "SELECT value FROM settings WHERE key = $key", { key: REPORT_AXES_KEY });
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

/**
 * Who sets an activity's axes: the locked one, or the teacher's choice when the backend lets them choose (the teacher
 * setting them when they did not say). A choice the backend does not allow is refused (422 report_axes_not_allowed).
 */
export async function reportAxesFor(db: Db, requested?: ReportAxes): Promise<ReportAxes> {
  const policy = await reportAxesPolicyOf(db);
  if (policy === "both") return requested ?? "teacher";
  if (requested && requested !== policy) fail(422, "report_axes_not_allowed");
  return policy;
}
