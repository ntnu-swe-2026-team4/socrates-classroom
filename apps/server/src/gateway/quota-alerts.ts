import { run } from "../db/d1";

const THRESHOLDS = [60, 80, 100] as const;
const CLAIM_TTL_MS = 60_000;

export function monthWindow(now = new Date()): { start: string; label: string } {
  const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), label };
}

export const QUOTA_ALERT_THRESHOLDS: readonly number[] = THRESHOLDS;

export type QuotaAlertTable = "teacher_quota_alerts" | "admin_quota_alerts";

/**
 * Claim-and-announce for the 60/80/100% quota watermarks, shared by the
 * teacher and admin credential pools. The alerts table dedupes one announce
 * per (scope, window, threshold); a claim younger than the lease is left
 * alone, an orphaned stale claim is stolen, and a failed announce re-arms the
 * threshold by deleting its claim.
 */
export async function claimQuotaThresholds(
  db: D1Database,
  table: QuotaAlertTable,
  scope: Record<string, string>,
  spend: number,
  quota: number,
  announce: (threshold: number) => Promise<boolean>,
): Promise<void> {
  const columns = Object.keys(scope);
  const columnList = columns.join(", ");
  const valueList = columns.map((column) => `$${column}`).join(", ");
  const where = columns.map((column) => `${column} = $${column}`).join(" AND ");
  const { label } = monthWindow();
  for (const threshold of THRESHOLDS) {
    if (spend * 100 < quota * threshold - 1e-9) continue;
    const claimedAt = new Date().toISOString();
    const claim = await run(
      db,
      `INSERT OR IGNORE INTO ${table} (${columnList}, window, threshold, claimed_at)
       VALUES (${valueList}, $win, $threshold, $claimed)`,
      { ...scope, win: label, threshold, claimed: claimedAt },
    );
    let owned = claim.meta.changes === 1;
    if (!owned) {
      const steal = await run(
        db,
        `UPDATE ${table} SET claimed_at = $claimed
         WHERE window = $win AND threshold = $threshold AND sent_at IS NULL AND claimed_at <= $stale AND ${where}`,
        {
          ...scope,
          win: label,
          threshold,
          claimed: claimedAt,
          stale: new Date(Date.now() - CLAIM_TTL_MS).toISOString(),
        },
      );
      owned = steal.meta.changes === 1;
    }
    if (!owned) continue;
    const delivered = await announce(threshold);
    if (!delivered) {
      await run(db, `DELETE FROM ${table} WHERE window = $win AND threshold = $threshold AND ${where}`, {
        ...scope,
        win: label,
        threshold,
      });
      continue;
    }
    await run(db, `UPDATE ${table} SET sent_at = $at WHERE window = $win AND threshold = $threshold AND ${where}`, {
      ...scope,
      win: label,
      threshold,
      at: claimedAt,
    });
  }
}
