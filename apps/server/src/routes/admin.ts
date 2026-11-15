import { Hono, type Context } from "hono";
import { ADMIN_LIST_CAP, OpsRangeQuerySchema, type AdminDashboard } from "@socrates/shared";
import { batch } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { fail, requireAdmin, type AppEnv } from "../http";
import { buildClassroomMetrics, buildLive, buildMetrics } from "../ops-fixture";

const STUCK_MARGIN_MS = 5 * 60_000;
const EMPTY_CLASSROOM_AFTER_MS = 24 * 60 * 60_000;
const HOURLY_WINDOW_MS = 8 * 24 * 60 * 60_000;

function rowsOf<T>(result: D1Result | undefined): T[] {
  return (result?.results ?? []) as T[];
}

const OPS_METRICS_CACHE = "private, max-age=15";

function opsRange(c: Context<AppEnv>) {
  const parsed = OpsRangeQuerySchema.safeParse({ range: c.req.query("range") });
  if (!parsed.success) fail(422, "validation");
  return parsed.data.range;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function adminRoutes() {
  return new Hono<AppEnv>()
    .use("/admin/*", async (c, next) => {
      await requireAdmin(c);
      await next();
    })
    .get("/admin/session", (c) => c.json({ admin: true as const }))
    .get("/admin/dashboard", async (c) => {
      const now = Date.now();
      const { alarmAttempts, alarmTimeoutMs } = gatewayConfig.report;
      const stuckAfterMs = alarmAttempts * alarmTimeoutMs + STUCK_MARGIN_MS;
      const stuckCutoff = new Date(now - stuckAfterMs).toISOString();
      const emptyCutoff = new Date(now - EMPTY_CLASSROOM_AFTER_MS).toISOString();
      const since = new Date(now - HOURLY_WINDOW_MS).toISOString();

      const [roles, totals, statuses, stuck, noReport, recent, empty, hourlyClassrooms, hourlyJoins] = await batch(
        c.env.DB,
        [
          { sql: "SELECT role, COUNT(*) AS n FROM users GROUP BY role" },
          {
            sql: `SELECT (SELECT COUNT(*) FROM classrooms) AS classrooms,
              (SELECT COUNT(*) FROM activities WHERE finished_at IS NULL) AS active,
              (SELECT COUNT(*) FROM activities WHERE finished_at IS NOT NULL) AS finished,
              (SELECT COUNT(*) FROM members) AS memberships,
              (SELECT COUNT(*) FROM reports WHERE status = 'pending' AND updated_at < $stuckCutoff) AS stuck,
              (SELECT COUNT(*) FROM activities a LEFT JOIN reports r ON r.activity_id = a.id
                WHERE a.finished_at IS NOT NULL AND a.finished_at < $stuckCutoff AND r.activity_id IS NULL) AS no_report,
              (SELECT COUNT(*) FROM classrooms c
                WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id)
                AND c.created_at < $emptyCutoff) AS empty`,
            params: { stuckCutoff, emptyCutoff },
          },
          { sql: "SELECT status, COUNT(*) AS n FROM reports GROUP BY status" },
          {
            sql: `SELECT activity_id, updated_at FROM reports
              WHERE status = 'pending' AND updated_at < $cutoff ORDER BY updated_at, rowid LIMIT ${ADMIN_LIST_CAP}`,
            params: { cutoff: stuckCutoff },
          },
          {
            sql: `SELECT a.id AS activity_id, a.finished_at FROM activities a
              LEFT JOIN reports r ON r.activity_id = a.id
              WHERE a.finished_at IS NOT NULL AND a.finished_at < $cutoff AND r.activity_id IS NULL
              ORDER BY a.finished_at, a.rowid LIMIT ${ADMIN_LIST_CAP}`,
            params: { cutoff: stuckCutoff },
          },
          {
            sql: `SELECT c.id, c.name, c.created_at,
              (SELECT COUNT(*) FROM members m WHERE m.classroom_id = c.id) AS members,
              CASE WHEN a.id IS NULL THEN 'none' WHEN a.finished_at IS NULL THEN 'active' ELSE 'finished' END AS state
              FROM classrooms c LEFT JOIN activities a ON a.id = c.current_activity_id
              ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${ADMIN_LIST_CAP}`,
          },
          {
            sql: `SELECT c.id, c.name, c.created_at FROM classrooms c
              WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id) AND c.created_at < $cutoff
              ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${ADMIN_LIST_CAP}`,
            params: { cutoff: emptyCutoff },
          },
          {
            sql: `SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, COUNT(*) AS n
              FROM classrooms WHERE created_at >= $since GROUP BY hour`,
            params: { since },
          },
          {
            sql: `SELECT strftime('%Y-%m-%dT%H:00:00Z', joined_at) AS hour, COUNT(*) AS n
              FROM members WHERE joined_at >= $since GROUP BY hour`,
            params: { since },
          },
        ],
      );

      const total = rowsOf<{
        classrooms: number;
        active: number;
        finished: number;
        memberships: number;
        stuck: number;
        no_report: number;
        empty: number;
      }>(totals)[0];
      const byStatus = { pending: 0, partial: 0, ready: 0, failed: 0 };
      for (const row of rowsOf<{ status: keyof typeof byStatus; n: number }>(statuses)) byStatus[row.status] = row.n;

      const hourly = new Map<string, { hour: string; classrooms: number; joins: number }>();
      for (const row of rowsOf<{ hour: string; n: number }>(hourlyClassrooms)) {
        hourly.set(row.hour, { hour: row.hour, classrooms: row.n, joins: 0 });
      }
      for (const row of rowsOf<{ hour: string; n: number }>(hourlyJoins)) {
        const entry = hourly.get(row.hour) ?? { hour: row.hour, classrooms: 0, joins: 0 };
        entry.joins = row.n;
        hourly.set(row.hour, entry);
      }

      const body: AdminDashboard = {
        generatedAt: new Date(now).toISOString(),
        stuckAfterMs,
        counts: {
          byRole: Object.fromEntries(rowsOf<{ role: string; n: number }>(roles).map((row) => [row.role, row.n])),
          classrooms: total?.classrooms ?? 0,
          activeActivities: total?.active ?? 0,
          finishedActivities: total?.finished ?? 0,
          memberships: total?.memberships ?? 0,
        },
        reports: {
          byStatus,
          stuck: {
            items: rowsOf<{ activity_id: string; updated_at: string }>(stuck).map((row) => ({
              activityId: row.activity_id,
              updatedAt: row.updated_at,
            })),
            total: total?.stuck ?? 0,
          },
          finishedWithoutReport: {
            items: rowsOf<{ activity_id: string; finished_at: string }>(noReport).map((row) => ({
              activityId: row.activity_id,
              finishedAt: row.finished_at,
            })),
            total: total?.no_report ?? 0,
          },
        },
        recentClassrooms: {
          items: rowsOf<{
            id: string;
            name: string;
            created_at: string;
            members: number;
            state: "none" | "active" | "finished";
          }>(recent).map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            members: row.members,
            state: row.state,
          })),
          total: total?.classrooms ?? 0,
        },
        emptyClassrooms: {
          items: rowsOf<{ id: string; name: string; created_at: string }>(empty).map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
          })),
          total: total?.empty ?? 0,
        },
        hourly: [...hourly.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
      };
      c.header("Cache-Control", "private, max-age=30");
      return c.json(body);
    })
    .get("/admin/live", (c) => {
      const sinceSec = c.req.query("sinceSec");
      if (sinceSec !== undefined && !/^\d+$/.test(sinceSec)) fail(422, "validation");
      c.header("Cache-Control", "no-store");
      return c.json(buildLive(nowSec()));
    })
    .get("/admin/metrics", (c) => {
      const range = opsRange(c);
      c.header("Cache-Control", OPS_METRICS_CACHE);
      return c.json(buildMetrics(range, nowSec()));
    })
    .get("/admin/classrooms/:id/metrics", (c) => {
      const range = opsRange(c);
      const metrics = buildClassroomMetrics(c.req.param("id"), range, nowSec());
      if (!metrics) fail(404, "not_found");
      c.header("Cache-Control", OPS_METRICS_CACHE);
      return c.json(metrics);
    });
}
