import { Hono } from "hono";
import { LoginInputSchema, RegisterInputSchema } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { endSession, hashPassword, startSession, verifyPassword } from "../auth";
import { fail, newId, nowIso, parseBody, type AppEnv } from "../http";

interface UserRow {
  id: string;
  name: string;
  role: "student" | "teacher";
  email: string | null;
  password_hash: string | null;
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/me", (c) => c.json(c.get("user")))
    .post("/auth/login", async (c) => {
      const input = await parseBody(c, LoginInputSchema);
      const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = $email AND role = 'teacher'", {
        email: input.email,
      });
      const ok = row ? await verifyPassword(input.password, row.password_hash) : false;
      if (!row || !ok) fail(401, "unauthorized");
      const user = { id: row.id, name: row.name, role: row.role as "teacher" };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", async (c) => {
      const input = await parseBody(c, RegisterInputSchema);
      const classroom = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
        code: input.code,
      });
      if (!classroom) fail(404, "join_code_invalid");
      const clash = await one<{ id: string }>(
        c.env.DB,
        "SELECT user_id AS id FROM members WHERE classroom_id = $cid AND name = $name",
        { cid: classroom.id, name: input.name },
      );
      if (clash) fail(409, "name_taken");
      const emailTaken = await one<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE email = $email", {
        email: input.email,
      });
      if (emailTaken) fail(409, "conflict");
      const id = newId("u_");
      const at = nowIso();
      const hash = await hashPassword(input.password);
      try {
        await run(
          c.env.DB,
          "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'student', $email, $hash, $at)",
          { id, name: input.name, email: input.email, hash, at },
        );
      } catch {
        fail(409, "conflict");
      }
      await run(
        c.env.DB,
        "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
        { cid: classroom.id, uid: id, name: input.name, at },
      );
      const user = { id, name: input.name, role: "student" as const };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    });
}

export async function teacherExists(db: D1Database): Promise<boolean> {
  const rows = await all<UserRow>(db, "SELECT id FROM users WHERE role = 'teacher' LIMIT 1");
  return rows.length > 0;
}
