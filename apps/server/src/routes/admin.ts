import { Hono } from "hono";
import { AdminUserCreateInputSchema, AdminUserUpdateInputSchema, type AdminUser } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { hashPassword } from "../auth";
import {
  enforceIpLimit,
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireAdmin,
  uniqueViolationColumns,
  type AppEnv,
} from "../http";

interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  can_manage_classes: number;
  is_admin: number;
  disabled_at: string | null;
  created_at: string;
  teacher_plan: "trial" | "school" | null;
  school_name: string | null;
  classrooms: number;
}

const ADMIN_USER_COLUMNS = `u.id, u.name, u.email, u.can_manage_classes, u.is_admin, u.disabled_at, u.created_at,
  u.teacher_plan, s.name AS school_name,
  (SELECT COUNT(*) FROM classrooms c WHERE c.teacher_id = u.id) AS classrooms`;

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    canManageClasses: row.can_manage_classes === 1,
    isAdmin: row.is_admin === 1,
    disabled: row.disabled_at !== null,
    teacherPlan: row.teacher_plan,
    schoolName: row.school_name,
    classrooms: Number(row.classrooms ?? 0),
    createdAt: row.created_at,
  };
}

async function loadAdminUser(db: D1Database, id: string): Promise<AdminUser | null> {
  const row = await one<AdminUserRow>(
    db,
    `SELECT ${ADMIN_USER_COLUMNS} FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $id`,
    { id },
  );
  return row ? toAdminUser(row) : null;
}

export function adminRoutes() {
  return new Hono<AppEnv>()
    .get("/admin/users", async (c) => {
      requireAdmin(c);
      const q = (c.req.query("q") ?? "").trim().slice(0, 80);
      const rows = await all<AdminUserRow>(
        c.env.DB,
        `SELECT ${ADMIN_USER_COLUMNS} FROM users u LEFT JOIN schools s ON s.id = u.school_id
         WHERE ($q = '' OR u.name LIKE $like OR u.email LIKE $like)
         ORDER BY u.is_admin DESC, u.can_manage_classes DESC, u.created_at, u.name`,
        { q, like: `%${q.replaceAll("%", "").replaceAll("_", "")}%` },
      );
      return c.json(rows.map(toAdminUser));
    })
    .post("/admin/users", async (c) => {
      requireAdmin(c);
      await enforceIpLimit(c, "admin-create-user", 30);
      const input = await parseBody(c, AdminUserCreateInputSchema);
      const id = newId("u_");
      const hash = await hashPassword(input.password);
      try {
        await run(
          c.env.DB,
          `INSERT INTO users (id, name, email, password_hash, lang, created_at, can_manage_classes, teacher_mode)
           VALUES ($id, $name, $email, $hash, $lang, $at, $can, $can)`,
          {
            id,
            name: input.name,
            email: input.email,
            hash,
            lang: langOf(c),
            at: nowIso(),
            can: input.canManageClasses ? 1 : 0,
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
    })
    .patch("/admin/users/:id", async (c) => {
      const actor = requireAdmin(c);
      const input = await parseBody(c, AdminUserUpdateInputSchema);
      const target = await one<AdminUserRow>(
        c.env.DB,
        `SELECT ${ADMIN_USER_COLUMNS} FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $id`,
        { id: c.req.param("id") },
      );
      if (!target) fail(404, "not_found");
      const disabled = input.disabled ?? target.disabled_at !== null;
      if (disabled && target.id === actor.id) fail(409, "conflict");
      const canManage = input.canManageClasses ?? target.can_manage_classes === 1;
      await run(
        c.env.DB,
        `UPDATE users SET can_manage_classes = $can, teacher_mode = CASE WHEN $can = 1 THEN teacher_mode ELSE 0 END,
           disabled_at = $disabled, session_version = session_version + $bump
         WHERE id = $id`,
        {
          id: target.id,
          can: canManage ? 1 : 0,
          disabled: disabled ? (target.disabled_at ?? nowIso()) : null,
          bump: input.disabled === undefined ? 0 : 1,
        },
      );
      const updated = await loadAdminUser(c.env.DB, target.id);
      if (!updated) fail(500, "internal_error");
      return c.json(updated);
    });
}
