import { ReportAxesSchema, type ReportAxes } from "@socrates/shared";
import type { Db } from "../db/d1";
import { one, run } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { nowIso } from "../http";

const REPORT_AXES_KEY = "report_axes";

/**
 * Who sets the class report's value axes now (#159): the admin's setting (PUT /api/admin/settings), or, until an admin
 * has set it, report.axes in providers.config.yaml.
 */
export async function reportAxesOf(db: Db): Promise<ReportAxes> {
  const row = await one<{ value: string }>(db, "SELECT value FROM settings WHERE key = $key", { key: REPORT_AXES_KEY });
  const parsed = ReportAxesSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : gatewayConfig.report.axes;
}

export async function setReportAxes(db: Db, value: ReportAxes): Promise<void> {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES ($key, $value, $at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { key: REPORT_AXES_KEY, value, at: nowIso() },
  );
}
