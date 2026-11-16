import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { AdminUser, ClassroomSummary } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, cookieOf } from "./helpers";

const migrations = inject("d1Migrations");

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function patchInit(body: unknown, cookie: string): RequestInit {
  return {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  };
}

async function login(email: string, password = FIXTURE_PASSWORD): Promise<string> {
  const res = await call("/api/auth/login", jsonInit({ email, password }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function patchUser(cookie: string, id: string, body: unknown): Promise<Response> {
  return call(`/api/admin/users/${id}`, patchInit(body, cookie));
}

async function classroomsOf(cookie: string): Promise<ClassroomSummary[]> {
  const res = await call("/api/classrooms", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as ClassroomSummary[];
}

let admin: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
});

describe("admin capability model (#131)", () => {
  test("admin endpoints are denied to anonymous and to non-admin sessions", async () => {
    expect((await call("/api/admin/users")).status).toBe(401);

    const student = await login("student-a@socrates.tw");
    const listed = await call("/api/admin/users", { headers: { Cookie: student } });
    expect(listed.status).toBe(403);
    expect(((await listed.json()) as { code: string }).code).toBe("forbidden");

    const created = await call(
      "/api/admin/users",
      jsonInit({ name: "越權", email: "nope@socrates.tw", password: "abcdefgh" }, student),
    );
    expect(created.status).toBe(403);
  });

  test("admin lists every account with capability flags and disabled state", async () => {
    const res = await call("/api/admin/users", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const users = (await res.json()) as AdminUser[];
    const byId = new Map(users.map((user) => [user.id, user]));
    expect(byId.get("u_fx_admin")).toMatchObject({ isAdmin: true, canManageClasses: true, disabled: false });
    expect(byId.get("u_fx_lin")).toMatchObject({ isAdmin: false, canManageClasses: true });
    expect(byId.get("u_fx_student_a")).toMatchObject({ isAdmin: false, canManageClasses: false });
  });

  test("granting manage_classes takes effect on the existing session (no re-login)", async () => {
    const student = await login("student-c@socrates.tw");
    const before = await call("/api/classrooms", jsonInit({ name: "提權前" }, student));
    expect(before.status).toBe(403);

    const promoted = await patchUser(admin, "u_fx_student_c", { canManageClasses: true });
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as AdminUser).canManageClasses).toBe(true);

    const me = await call("/api/me", { headers: { Cookie: student } });
    expect(((await me.json()) as { canManageClasses: boolean }).canManageClasses).toBe(true);

    const created = await call("/api/classrooms", jsonInit({ name: "提權後班" }, student));
    expect(created.status).toBe(201);
  });

  test("disable revokes the live session immediately, blocks login, and re-enable needs a fresh login", async () => {
    const student = await login("student-c@socrates.tw");
    expect((await call("/api/classrooms", { headers: { Cookie: student } })).status).toBe(200);

    const disabled = await patchUser(admin, "u_fx_student_c", { disabled: true });
    expect(disabled.status).toBe(200);
    expect(((await disabled.json()) as AdminUser).disabled).toBe(true);

    const afterDisable = await call("/api/classrooms", { headers: { Cookie: student } });
    expect(afterDisable.status).toBe(403);
    expect(((await afterDisable.json()) as { code: string }).code).toBe("account_disabled");
    expect(await (await call("/api/me", { headers: { Cookie: student } })).json()).toBeNull();

    const relogin = await call(
      "/api/auth/login",
      jsonInit({ email: "student-c@socrates.tw", password: FIXTURE_PASSWORD }),
    );
    expect(relogin.status).toBe(403);
    expect(((await relogin.json()) as { code: string }).code).toBe("account_disabled");

    const enabled = await patchUser(admin, "u_fx_student_c", { disabled: false });
    expect(enabled.status).toBe(200);
    expect(((await enabled.json()) as AdminUser).disabled).toBe(false);

    expect((await call("/api/classrooms", { headers: { Cookie: student } })).status).toBe(401);
    await login("student-c@socrates.tw");
  });

  test("one account can teach one classroom and be a student in another", async () => {
    const lin = await login("demo@socrates.tw");
    const chen = await login("chen@socrates.tw");

    const created = await call("/api/classrooms", jsonInit({ name: "陳老師的班" }, chen));
    expect(created.status).toBe(201);

    const joined = await call("/api/join", jsonInit({ code: "demo-eths", tosAccepted: true }, chen));
    expect(joined.status).toBe(200);

    const chenRooms = await classroomsOf(chen);
    const roles = new Set(chenRooms.map((room) => room.role));
    expect(roles.has("teacher")).toBe(true);
    expect(roles.has("student")).toBe(true);
    expect(chenRooms.find((room) => room.id === "c_fx_philosophy")?.role).toBe("student");
    expect(chenRooms.find((room) => room.id === "c_fx_ethics")?.role).toBe("student");

    const linRooms = await classroomsOf(lin);
    expect(linRooms.every((room) => room.role === "teacher")).toBe(true);
  });

  test("admin creates an account with a password and capability; duplicate email conflicts", async () => {
    const email = `made-${Date.now()}@socrates.tw`;
    const created = await call(
      "/api/admin/users",
      jsonInit({ name: "新任老師", email, password: "teacher-pass-1", canManageClasses: true }, admin),
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as AdminUser;
    expect(payload.canManageClasses).toBe(true);
    expect(payload.isAdmin).toBe(false);

    const fresh = await login(email, "teacher-pass-1");
    expect((await call("/api/topics", { headers: { Cookie: fresh } })).status).toBe(200);

    const duplicate = await call(
      "/api/admin/users",
      jsonInit({ name: "重複", email, password: "teacher-pass-1" }, admin),
    );
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe("conflict");
  });

  test("admin cannot disable itself and cannot grant is_admin through the API", async () => {
    const self = await patchUser(admin, "u_fx_admin", { disabled: true });
    expect(self.status).toBe(409);

    const escalate = await patchUser(admin, "u_fx_student_a", { isAdmin: true });
    expect(escalate.status).toBe(422);
    expect(((await escalate.json()) as { code: string }).code).toBe("validation");
  });
});
