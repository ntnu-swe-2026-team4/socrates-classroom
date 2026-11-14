import { Hono } from "hono";
import { LoginInputSchema, ProfileInputSchema, RegisterInputSchema, type User } from "@socrates/shared";
import { one, run } from "../db/d1";
import { DUMMY_HASH, endSession, hashPassword, loadAccount, startSession, verifyPassword } from "../auth";
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
import { assertSeats } from "../services/members";
import { enabledProviders } from "./oauth-config";

interface JoinTarget {
  id: string;
  teacher_id: string;
}

async function joinTarget(c: Ctx, code: string, name: string): Promise<JoinTarget> {
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
  if (clash) fail(409, "name_taken");
  await assertSeats(c.env.DB, classroom.id, 1);
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

async function sessionFor(c: Ctx, id: string): Promise<User> {
  const user = await loadAccount(c.env.DB, id);
  if (!user) fail(401, "unauthorized");
  await startSession(c, user);
  return user;
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/me", (c) => {
      if (c.get("sessionExpired")) fail(401, "guest_session_expired");
      return c.json(c.get("user"));
    })
    .patch("/me", async (c) => {
      const current = requireUser(c);
      if (current.preview) fail(403, "forbidden");
      const input = await parseBody(c, ProfileInputSchema);
      if (input.name !== undefined) {
        if (current.kind === "student") fail(403, "student_restricted");
        await run(c.env.DB, "UPDATE users SET name = $name WHERE id = $id", { id: current.id, name: input.name });
      }
      if (input.teacherMode !== undefined) {
        if (current.kind !== "member")
          fail(403, current.kind === "student" ? "student_restricted" : "account_required");
        if (input.teacherMode && !current.teacherPlan) {
          if (!input.acceptTeacherTerms) fail(422, "teacher_terms_required");
          await run(
            c.env.DB,
            "UPDATE users SET teacher_plan = 'trial', teacher_mode = 1, teacher_terms_at = $at WHERE id = $id",
            { id: current.id, at: nowIso() },
          );
        } else {
          await run(c.env.DB, "UPDATE users SET teacher_mode = $mode WHERE id = $id", {
            id: current.id,
            mode: input.teacherMode ? 1 : 0,
          });
        }
      }
      return c.json(await sessionFor(c, current.id));
    })
    .get("/auth/providers", (c) => c.json(enabledProviders(c.env)))
    .post("/auth/login", async (c) => {
      await enforceIpLimit(c, "login", 30);
      const input = await parseBody(c, LoginInputSchema);
      const byEmail = input.identifier.includes("@");
      const row = await one<{ id: string; password_hash: string | null }>(
        c.env.DB,
        byEmail
          ? "SELECT id, password_hash FROM users WHERE email = $identifier"
          : "SELECT id, password_hash FROM users WHERE username = $identifier",
        { identifier: input.identifier },
      );
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) fail(401, "unauthorized");
      return c.json(await sessionFor(c, row.id));
    })
    .post("/auth/register", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, RegisterInputSchema);
      if (!input.tosAccepted) fail(422, "tos_required");
      const emailTaken = await one<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE email = $email", {
        email: input.email,
      });
      if (emailTaken) fail(409, "conflict");
      const name = input.name ?? input.email.split("@")[0]!.slice(0, 80);
      const target = input.code ? await joinTarget(c, input.code, name) : null;
      const hash = await hashPassword(input.password);
      const id = newId("u_");
      try {
        await run(
          c.env.DB,
          "INSERT INTO users (id, name, is_guest, email, password_hash, lang, created_at) VALUES ($id, $name, 0, $email, $hash, $lang, $at)",
          { id, name, email: input.email, hash, lang: langOf(c), at: nowIso() },
        );
      } catch (error) {
        if (uniqueViolationColumns(error).length === 0) throw error;
        fail(409, "conflict");
      }
      if (target) await addMember(c, target, id, name);
      return c.json(await sessionFor(c, id));
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    });
}
