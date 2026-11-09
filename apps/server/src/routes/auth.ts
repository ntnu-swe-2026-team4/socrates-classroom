import { Hono } from "hono";
import { LoginInputSchema, RegisterInputSchema } from "@socrates/shared";
import { batch, one } from "../db/d1";
import { DUMMY_HASH, endSession, hashPassword, startSession, verifyPassword } from "../auth";
import { enforceIpLimit, fail, langOf, newId, nowIso, parseBody, uniqueViolationColumns, type AppEnv } from "../http";

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
      await enforceIpLimit(c, "login", 30);
      const input = await parseBody(c, LoginInputSchema);
      const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = $email", {
        email: input.email,
      });
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) fail(401, "unauthorized");
      const user = { id: row.id, name: row.name, role: row.role };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, RegisterInputSchema);
      if (!input.tosAccepted) fail(422, "tos_required");
      const classroom = await one<{ id: string; current_activity_id: string | null }>(
        c.env.DB,
        "SELECT id, current_activity_id FROM classrooms WHERE join_code = $code",
        { code: input.code },
      );
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const activity = await one<{ finished_at: string | null }>(
        c.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: classroom.current_activity_id },
      );
      if (activity?.finished_at) fail(409, "activity_finished");
      const hash = await hashPassword(input.password);
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
      try {
        await batch(c.env.DB, [
          {
            sql: "INSERT INTO users (id, name, role, email, password_hash, lang, created_at) VALUES ($id, $name, 'student', $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, at, lang: langOf(c) },
          },
          {
            sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
            params: { cid: classroom.id, uid: id, name: input.name, at },
          },
        ]);
      } catch (error) {
        const pairs = uniqueViolationColumns(error);
        if (pairs.some(([table, column]) => table === "members" && column === "name")) fail(409, "name_taken");
        fail(409, "conflict");
      }
      const user = { id, name: input.name, role: "student" as const };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    });
}
