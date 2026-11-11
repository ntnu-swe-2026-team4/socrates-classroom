import { Hono } from "hono";
import {
  GuestInputSchema,
  LoginInputSchema,
  ProfileInputSchema,
  RegisterInputSchema,
  type User,
} from "@socrates/shared";
import { batch, one, run } from "../db/d1";
import { DUMMY_HASH, endSession, hashPassword, startSession, verifyPassword } from "../auth";
import {
  enforceIpLimit,
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireUser,
  uniqueViolationColumns,
  type AppEnv,
  type Ctx,
} from "../http";
import { enabledProviders } from "./oauth-config";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
}

const GUEST_PREFIX = { zh: "訪客", en: "Guest", es: "Invitado" } as const;

function guestName(c: Ctx): string {
  const [byte1 = 0, byte2 = 0] = crypto.getRandomValues(new Uint8Array(2));
  return `${GUEST_PREFIX[langOf(c)]} ${String(((byte1 << 8) | byte2) % 10000).padStart(4, "0")}`;
}

interface JoinTarget {
  id: string;
  teacher_id: string;
}

async function joinTarget(c: Ctx, code: string, name: string, userId: string | null): Promise<JoinTarget> {
  const classroom = await one<{ id: string; teacher_id: string; current_activity_id: string | null }>(
    c.env.DB,
    "SELECT id, teacher_id, current_activity_id FROM classrooms WHERE join_code = $code",
    { code },
  );
  if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
  const activity = await one<{ finished_at: string | null }>(
    c.env.DB,
    "SELECT finished_at FROM activities WHERE id = $id",
    { id: classroom.current_activity_id },
  );
  if (activity?.finished_at) fail(409, "activity_finished");
  const clash = await one<{ user_id: string }>(
    c.env.DB,
    "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
    { cid: classroom.id, name },
  );
  if (clash && clash.user_id !== userId) fail(409, "name_taken");
  return { id: classroom.id, teacher_id: classroom.teacher_id };
}

async function addMember(c: Ctx, target: JoinTarget, userId: string, name: string): Promise<void> {
  if (target.teacher_id === userId) return;
  const at = nowIso();
  await run(
    c.env.DB,
    "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at) ON CONFLICT (classroom_id, user_id) DO NOTHING",
    { cid: target.id, uid: userId, name, at },
  );
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/me", (c) => c.json(c.get("user")))
    .patch("/me", async (c) => {
      const current = requireUser(c);
      if (current.preview) fail(403, "forbidden");
      const input = await parseBody(c, ProfileInputSchema);
      await run(c.env.DB, "UPDATE users SET name = $name WHERE id = $id", { id: current.id, name: input.name });
      const user: User = { ...current, name: input.name };
      await startSession(c, user);
      return c.json(user);
    })
    .get("/auth/providers", (c) => c.json(enabledProviders(c.env)))
    .post("/auth/login", async (c) => {
      await enforceIpLimit(c, "login", 30);
      const input = await parseBody(c, LoginInputSchema);
      const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = $email", {
        email: input.email,
      });
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) fail(401, "unauthorized");
      const user: User = { id: row.id, name: row.name, guest: false };
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/guest", async (c) => {
      await enforceIpLimit(c, "guest", 30);
      const input = await parseBody(c, GuestInputSchema);
      const current = c.get("user");
      if (current && !current.preview) return c.json(current);
      const user: User = { id: newId("u_"), name: input.name || guestName(c), guest: true };
      await run(
        c.env.DB,
        "INSERT INTO users (id, name, is_guest, lang, created_at) VALUES ($id, $name, 1, $lang, $at)",
        { id: user.id, name: user.name, lang: langOf(c), at: nowIso() },
      );
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, RegisterInputSchema);
      if (!input.tosAccepted) fail(422, "tos_required");
      const emailTaken = await one<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE email = $email", {
        email: input.email,
      });
      if (emailTaken) fail(409, "conflict");
      const current = c.get("user");
      const upgrade = current?.guest && !current.preview ? current : null;
      const name = input.name ?? upgrade?.name ?? input.email.split("@")[0]!.slice(0, 80);
      const target = input.code ? await joinTarget(c, input.code, name, upgrade?.id ?? null) : null;
      const hash = await hashPassword(input.password);
      const user: User = { id: upgrade?.id ?? newId("u_"), name, guest: false };
      try {
        if (upgrade) {
          await batch(c.env.DB, [
            {
              sql: "UPDATE users SET name = $name, email = $email, password_hash = $hash, is_guest = 0 WHERE id = $id",
              params: { id: user.id, name: user.name, email: input.email, hash },
            },
          ]);
        } else {
          await run(
            c.env.DB,
            "INSERT INTO users (id, name, is_guest, email, password_hash, lang, created_at) VALUES ($id, $name, 0, $email, $hash, $lang, $at)",
            { id: user.id, name: user.name, email: input.email, hash, lang: langOf(c), at: nowIso() },
          );
        }
      } catch (error) {
        if (uniqueViolationColumns(error).length === 0) throw error;
        fail(409, "conflict");
      }
      if (target) await addMember(c, target, user.id, user.name);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    });
}
