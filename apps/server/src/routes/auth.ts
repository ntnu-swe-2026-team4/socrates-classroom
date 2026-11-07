import { Hono } from "hono";
import { GuestInputSchema, LoginInputSchema, MeUpdateInputSchema, RegisterInputSchema } from "@socrates/shared";
import { all, batch, one, run } from "../db/d1";
import { endSession, hashPassword, startSession, verifyPassword } from "../auth";
import { enforceIpLimit, fail, langOf, newId, nowIso, parseBody, requireUser, type AppEnv } from "../http";

const GUEST_PREFIX = { zh: "訪客", en: "Guest", es: "Invitado" } as const;

function guestName(lang: keyof typeof GUEST_PREFIX): string {
  const digits = crypto.getRandomValues(new Uint16Array(1))[0]! % 10000;
  return `${GUEST_PREFIX[lang]} ${String(digits).padStart(4, "0")}`;
}

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
    .patch("/me", async (c) => {
      const user = requireUser(c);
      const input = await parseBody(c, MeUpdateInputSchema);
      if (input.name !== user.name) {
        const clash = await one<{ classroom_id: string }>(
          c.env.DB,
          `SELECT m.classroom_id FROM members m
           WHERE m.name = $name AND m.user_id <> $uid
             AND m.classroom_id IN (SELECT classroom_id FROM members WHERE user_id = $uid)
           LIMIT 1`,
          { name: input.name, uid: user.id },
        );
        if (clash) fail(409, "name_taken");
        await batch(c.env.DB, [
          { sql: "UPDATE users SET name = $name WHERE id = $uid", params: { name: input.name, uid: user.id } },
          { sql: "UPDATE members SET name = $name WHERE user_id = $uid", params: { name: input.name, uid: user.id } },
        ]);
      }
      const next = { ...user, name: input.name };
      await startSession(c, next);
      return c.json(next);
    })
    .post("/auth/login", async (c) => {
      await enforceIpLimit(c, "login", 30);
      const input = await parseBody(c, LoginInputSchema);
      const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = $email", {
        email: input.email,
      });
      const ok = row ? await verifyPassword(input.password, row.password_hash) : false;
      if (!row || !ok) fail(401, "unauthorized");
      const user = { id: row.id, name: row.name, role: row.role };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, RegisterInputSchema);
      const classroom = input.code
        ? await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
            code: input.code,
          })
        : null;
      if (input.code && !classroom) fail(404, "join_code_invalid");
      if (classroom) {
        const clash = await one<{ id: string }>(
          c.env.DB,
          "SELECT user_id AS id FROM members WHERE classroom_id = $cid AND name = $name",
          { cid: classroom.id, name: input.name },
        );
        if (clash) fail(409, "name_taken");
      }
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
      if (classroom) {
        await run(
          c.env.DB,
          "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
          { cid: classroom.id, uid: id, name: input.name, at },
        );
      }
      const user = { id, name: input.name, role: "student" as const };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/guest", async (c) => {
      await enforceIpLimit(c, "guest", 30);
      const input = await parseBody(c, GuestInputSchema);
      const name = input.name || guestName(langOf(c));
      const id = newId("u_");
      await run(c.env.DB, "INSERT INTO users (id, name, role, created_at) VALUES ($id, $name, 'student', $at)", {
        id,
        name,
        at: nowIso(),
      });
      const user = { id, name, role: "student" as const };
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
