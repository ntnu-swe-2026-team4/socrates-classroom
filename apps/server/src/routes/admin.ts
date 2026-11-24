import { Hono } from "hono";
import {
  AdminActionsQuerySchema,
  AdminSettingsSchema,
  AdminUserCreateInputSchema,
  AdminUserUpdateInputSchema,
  type AdminAction,
  type AdminOverview,
  type AdminSettings,
  type AdminUser,
} from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { hashPassword } from "../auth";
import { reportAxesPolicyOf, setReportAxesPolicy } from "../services/settings";
import {
  fail,
  guardAdmin,
  langOf,
  newId,
  nowIso,
  rateLimit,
  requireAdmin,
  uniqueViolationColumns,
  validateJson,
  validateQuery,
  type AppEnv,
} from "../http";

interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  is_admin: number;
  disabled_at: string | null;
  created_at: string;
}

interface AdminActionRow {
  id: number;
  actor_id: string | null;
  action: string;
  target: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

function toAdminAction(row: AdminActionRow): AdminAction {
  const parse = (raw: string | null): unknown => {
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed;
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    target: row.target,
    before: parse(row.before_json),
    after: parse(row.after_json),
    createdAt: row.created_at,
  };
}

const ADMIN_USER_COLUMNS = "id, name, email, is_admin, disabled_at, created_at";

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.is_admin === 1,
    disabled: row.disabled_at !== null,
    createdAt: row.created_at,
  };
}

async function loadAdminUser(db: D1Database, id: string): Promise<AdminUser | null> {
  const row = await one<AdminUserRow>(db, `SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = $id`, { id });
  return row ? toAdminUser(row) : null;
}

export function adminRoutes() {
  return new Hono<AppEnv>()
    .get("/admin/actions", guardAdmin(), validateQuery(AdminActionsQuerySchema), async (c) => {
      const { limit, cursor } = c.req.valid("query");
      const rows = await all<AdminActionRow>(
        c.env.DB,
        `SELECT id, actor_id, action, target, before_json, after_json, created_at
         FROM admin_actions
         WHERE ($cursor IS NULL OR id < $cursor)
         ORDER BY id DESC
         LIMIT $limit`,
        { cursor: cursor ?? null, limit: limit + 1 },
      );
      const page = rows.slice(0, limit);
      return c.json({
        items: page.map(toAdminAction),
        nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      });
    })
    .get("/admin/overview", guardAdmin(), async (c) => {
      const counts = await one<{ users: number; classrooms: number; running: number }>(
        c.env.DB,
        `SELECT (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM classrooms) AS classrooms,
                (SELECT COUNT(*) FROM activities WHERE finished_at IS NULL) AS running`,
      );
      if (!counts) fail(500, "internal_error");
      return c.json({
        users: counts.users,
        classrooms: counts.classrooms,
        runningActivities: counts.running,
      } satisfies AdminOverview);
    })
    .get("/admin/users", async (c) => {
      requireAdmin(c);
      const rows = await all<AdminUserRow>(
        c.env.DB,
        `SELECT ${ADMIN_USER_COLUMNS} FROM users ORDER BY is_admin DESC, created_at, name`,
      );
      return c.json(rows.map(toAdminUser));
    })
    .post(
      "/admin/users",
      guardAdmin(),
      rateLimit("admin-create-user", 30),
      validateJson(AdminUserCreateInputSchema),
      async (c) => {
        const input = c.req.valid("json");
        const id = newId("u_");
        const hash = await hashPassword(input.password);
        try {
          await run(
            c.env.DB,
            `INSERT INTO users (id, name, email, password_hash, lang, created_at)
           VALUES ($id, $name, $email, $hash, $lang, $at)`,
            {
              id,
              name: input.name,
              email: input.email,
              hash,
              lang: langOf(c),
              at: nowIso(),
            },
          );
        } catch (error) {
          if (uniqueViolationColumns(error).some(([table, column]) => table === "users" && column === "email")) {
            fail(409, "conflict");
          }
          throw error;
        }
        const created = await loadAdminUser(c.env.DB, id);
        if (!created) fail(500, "internal_error");
        return c.json(created, 201);
      },
    )
    .patch("/admin/users/:id", guardAdmin(), validateJson(AdminUserUpdateInputSchema), async (c) => {
      const actor = requireAdmin(c);
      const input = c.req.valid("json");
      const target = await one<AdminUserRow>(c.env.DB, `SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = $id`, {
        id: c.req.param("id"),
      });
      if (!target) fail(404, "not_found");
      const disabled = input.disabled;
      if (disabled && target.id === actor.id) fail(409, "conflict");
      await run(
        c.env.DB,
        `UPDATE users SET disabled_at = $disabled, session_version = session_version + 1 WHERE id = $id`,
        {
          id: target.id,
          disabled: disabled ? (target.disabled_at ?? nowIso()) : null,
        },
      );
      const updated = await loadAdminUser(c.env.DB, target.id);
      if (!updated) fail(500, "internal_error");
      return c.json(updated);
    })
    .get("/admin/settings", guardAdmin(), async (c) =>
      c.json({ reportAxes: await reportAxesPolicyOf(c.env.DB) } satisfies AdminSettings),
    )
    .put("/admin/settings", guardAdmin(), validateJson(AdminSettingsSchema), async (c) => {
      const input = c.req.valid("json");
      await setReportAxesPolicy(c.env.DB, input.reportAxes);
      return c.json({ reportAxes: await reportAxesPolicyOf(c.env.DB) } satisfies AdminSettings);
    });
}
