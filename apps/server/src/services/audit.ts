import type { SqlEntry } from "../db/d1";

export interface AdminActionEntry {
  actorId: string;
  action: string;
  target: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Batch-composable audit row: routes push it into the same `batch()` as the
 * business write, so an action and its record commit or roll back together.
 * Summaries MUST be plain JSON without key material — last4 only.
 */
export function adminActionEntry(entry: AdminActionEntry): SqlEntry {
  return {
    sql: `INSERT INTO admin_actions (actor_id, action, target, before_json, after_json)
          VALUES ($actor, $action, $target, $before, $after)`,
    params: {
      actor: entry.actorId,
      action: entry.action,
      target: entry.target,
      before: entry.before === undefined || entry.before === null ? null : JSON.stringify(entry.before),
      after: entry.after === undefined || entry.after === null ? null : JSON.stringify(entry.after),
    },
  };
}
