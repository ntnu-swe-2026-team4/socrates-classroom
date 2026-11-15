import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { hashPassword, issueSessionToken } from "../src/auth";
import { run } from "../src/db/d1";
import { newId, nowIso } from "../src/http";
import { seedDemo } from "../src/seed";
import { call, cookieOf } from "./helpers";

let admin: string;
let otherTeacher: string;
let student: string;
let ghost: string;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
  await seedDemo(env.DB);
  admin = await loginAs("demo@socrates.tw", "demo-demo");

  await run(
    env.DB,
    "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'teacher', $email, $hash, $at)",
    {
      id: newId("u_"),
      name: "外部老師",
      email: "other@teacher.test",
      hash: await hashPassword("other-pass"),
      at: nowIso(),
    },
  );
  otherTeacher = await loginAs("other@teacher.test", "other-pass");

  const topics = (await (await call("/api/topics", { headers: { Cookie: admin } })).json()) as Array<{ id: string }>;
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ name: "管理員測試班", topicId: topics[0]!.id }),
    })
  ).json()) as { code: string };
  const joined = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: created.code, name: "管理員測試生", tosAccepted: true }),
  });
  expect(joined.status).toBe(200);
  student = cookieOf(joined);

  const token = await issueSessionToken({ env }, { id: "u_ghost_teacher", name: "幽靈", role: "teacher" });
  ghost = `socrates_session=${token}`;
});

describe("admin guard (GET /api/admin/session)", () => {
  test("no session → 401", async () => {
    expect((await call("/api/admin/session")).status).toBe(401);
  });

  test("student → 403", async () => {
    const res = await call("/api/admin/session", { headers: { Cookie: student } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("forbidden");
  });

  test("teacher outside ADMIN_EMAILS → 403", async () => {
    expect((await call("/api/admin/session", { headers: { Cookie: otherTeacher } })).status).toBe(403);
  });

  test("validly signed cookie for a teacher that does not exist → 403", async () => {
    expect((await call("/api/admin/session", { headers: { Cookie: ghost } })).status).toBe(403);
  });

  test("allowlisted teacher → 200", async () => {
    const res = await call("/api/admin/session", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  test("allowlist is trimmed, case-insensitive and fails closed when empty", async () => {
    const original = env.ADMIN_EMAILS;
    try {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = " Other@Teacher.TEST , demo@socrates.tw ";
      expect((await call("/api/admin/session", { headers: { Cookie: otherTeacher } })).status).toBe(200);

      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = " , ";
      expect((await call("/api/admin/session", { headers: { Cookie: admin } })).status).toBe(403);

      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = undefined;
      expect((await call("/api/admin/session", { headers: { Cookie: admin } })).status).toBe(403);
    } finally {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = original;
    }
  });

  test("a teacher whose stored role changed is refused even with a cookie that still says teacher", async () => {
    const email = "demoted@teacher.test";
    const id = newId("u_");
    await run(
      env.DB,
      "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'teacher', $email, $hash, $at)",
      { id, name: "降級老師", email, hash: await hashPassword("demoted-pass"), at: nowIso() },
    );
    const original = env.ADMIN_EMAILS;
    try {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = email;
      const cookie = await loginAs(email, "demoted-pass");
      expect((await call("/api/admin/session", { headers: { Cookie: cookie } })).status).toBe(200);
      await run(env.DB, "UPDATE users SET role = 'student' WHERE id = $id", { id });
      expect((await call("/api/admin/session", { headers: { Cookie: cookie } })).status).toBe(403);
    } finally {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = original;
    }
  });

  test("a teacher account without an email is refused, whatever the allowlist holds", async () => {
    const id = newId("u_");
    await run(
      env.DB,
      "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'teacher', NULL, $hash, $at)",
      { id, name: "無信箱老師", hash: await hashPassword("no-email-pass"), at: nowIso() },
    );
    const token = await issueSessionToken({ env }, { id, name: "無信箱老師", role: "teacher" });
    const original = env.ADMIN_EMAILS;
    try {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = "demo@socrates.tw,null,undefined,";
      expect((await call("/api/admin/session", { headers: { Cookie: `socrates_session=${token}` } })).status).toBe(403);
    } finally {
      (env as { ADMIN_EMAILS?: string }).ADMIN_EMAILS = original;
    }
  });

  test("the guard covers every /admin path, including ones that do not exist yet", async () => {
    expect((await call("/api/admin/anything", { headers: { Cookie: student } })).status).toBe(403);
    expect((await call("/api/admin/anything")).status).toBe(401);
  });
});
