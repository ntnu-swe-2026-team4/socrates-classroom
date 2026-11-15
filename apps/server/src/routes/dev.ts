import { Hono } from "hono";
import { DevLoginInputSchema, type DevAccount, type User } from "@socrates/shared";
import { all, one } from "../db/d1";
import { startSession } from "../auth";
import { fail, parseBody, type AppEnv, type Ctx } from "../http";
import { FIXTURE_ACCOUNTS, FIXTURE_PASSWORD } from "../seed";

export function isDev(env: { ENVIRONMENT?: string }): boolean {
  return env.ENVIRONMENT === "dev";
}

function requireDev(c: Ctx): void {
  if (!isDev(c.env)) fail(404, "not_found");
}

interface AccountRow {
  id: string;
  name: string;
  role: "student" | "teacher";
  email: string;
}

interface RoomRow {
  id: string;
  name: string;
  teacher_id: string;
  join_code: string;
  current_activity_id: string | null;
}

const ROOMS_SQL = `SELECT id, name, teacher_id, join_code, current_activity_id FROM classrooms c
  WHERE c.teacher_id = $uid OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid)
  ORDER BY c.created_at`;

async function loadAccount(db: D1Database, email: string): Promise<AccountRow | null> {
  return one<AccountRow>(db, "SELECT id, name, role, email FROM users WHERE email = $email", { email });
}

export function devRoutes() {
  return new Hono<AppEnv>()
    .get("/dev/accounts", async (c) => {
      requireDev(c);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      const accounts: DevAccount[] = [];
      for (const fixture of FIXTURE_ACCOUNTS) {
        const row = await loadAccount(c.env.DB, fixture.email);
        if (!row) continue;
        const rooms = await all<RoomRow>(c.env.DB, ROOMS_SQL, { uid: row.id });
        accounts.push({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          fixtureRole: fixture.fixtureRole,
          classrooms: rooms.map((room) => {
            const owner = room.teacher_id === row.id;
            return {
              id: room.id,
              name: room.name,
              role: owner ? ("teacher" as const) : ("student" as const),
              code: owner ? room.join_code : null,
              url: owner ? `${base}/join/${room.join_code}` : null,
              activityId: room.current_activity_id,
            };
          }),
        });
      }
      return c.json({ password: FIXTURE_PASSWORD, accounts });
    })
    .post("/dev/login", async (c) => {
      requireDev(c);
      const input = await parseBody(c, DevLoginInputSchema);
      if (!FIXTURE_ACCOUNTS.some((account) => account.email === input.email)) fail(404, "not_found");
      const row = await loadAccount(c.env.DB, input.email);
      if (!row) fail(404, "not_found");
      const user: User = { id: row.id, name: row.name, role: row.role };
      await startSession(c, user);
      return c.json(user);
    });
}
