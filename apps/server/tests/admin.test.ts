import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { AdminUser, ClassroomSummary } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { one } from "../src/db/d1";
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

describe("admin account management (no-mode, #210)", () => {
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

  test("admin lists every account with admin flag and disabled state, no capability column", async () => {
    const res = await call("/api/admin/users", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const users = (await res.json()) as AdminUser[];
    const byId = new Map(users.map((user) => [user.id, user]));
    expect(byId.get("u_fx_admin")).toMatchObject({ isAdmin: true, disabled: false });
    expect(byId.get("u_fx_lin")).toMatchObject({ isAdmin: false, disabled: false });
    expect(byId.get("u_fx_student_a")).toMatchObject({ isAdmin: false, disabled: false });
    for (const user of users) expect("canManageClasses" in user).toBe(false);
  });

  test("any logged-in account can create classrooms without a grant (#210)", async () => {
    const student = await login("student-c@socrates.tw");
    const me = await call("/api/me", { headers: { Cookie: student } });
    expect("canManageClasses" in ((await me.json()) as Record<string, unknown>)).toBe(false);

    const created = await call("/api/classrooms", jsonInit({ name: "學生自建班" }, student));
    expect(created.status).toBe(201);

    const topics = await call("/api/topics", { headers: { Cookie: student } });
    expect(topics.status).toBe(200);

    const legacyGrant = await patchUser(admin, "u_fx_student_c", { canManageClasses: true });
    expect(legacyGrant.status).toBe(422);
    expect(((await legacyGrant.json()) as { code: string }).code).toBe("validation");
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

  test("admin creates an account with a password; duplicate email conflicts", async () => {
    const email = `made-${Date.now()}@socrates.tw`;
    const created = await call(
      "/api/admin/users",
      jsonInit({ name: "供應帳號", email, password: "teacher-pass-1" }, admin),
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as AdminUser;
    expect("canManageClasses" in payload).toBe(false);
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

describe("who decides the report axes (#159): the backend locks one or lets the teacher choose, after deploy", () => {
  const putSettings = (cookie: string | undefined, body: unknown) =>
    call("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  const configNow = async () => ((await (await call("/api/config")).json()) as { reportAxes: string }).reportAxes;

  test("only an admin reads or changes it", async () => {
    expect((await call("/api/admin/settings")).status).toBe(401);
    expect((await call("/api/admin/settings", { method: "PUT" })).status).toBe(401);
    const teacher = await login("demo@socrates.tw");
    expect((await call("/api/admin/settings", { headers: { Cookie: teacher } })).status).toBe(403);
    expect((await putSettings(teacher, { reportAxes: "ai" })).status).toBe(403);
    const invalid = await putSettings(admin, { reportAxes: "nobody" });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { code: string }).code).toBe("validation");
    const read = await call("/api/admin/settings", { headers: { Cookie: admin } });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ reportAxes: "both" });
  });

  test("stages teacher policy until teacher reports are supported", async () => {
    const teacher = await login("demo@socrates.tw");
    const room = await call("/api/classrooms", jsonInit({ name: "決定權班" }, teacher));
    expect(room.status).toBe(201);
    const { classroomId } = (await room.json()) as { classroomId: string };
    const bare = await call(
      `/api/classrooms/${classroomId}/topics`,
      jsonInit({ title: "沒軸的題", statement: "要不要軸？", prompts: [] }, teacher),
    );
    expect(bare.status).toBe(201);
    const bareTopicId = ((await bare.json()) as { id: string }).id;
    const withAxes = await call(
      `/api/classrooms/${classroomId}/topics`,
      jsonInit(
        {
          title: "有軸的題",
          statement: "要有軸嗎？",
          prompts: [],
          axes: [{ name: "軸一", left: "左", right: "右" }],
        },
        teacher,
      ),
    );
    expect(withAxes.status).toBe(201);
    const withAxesTopicId = ((await withAxes.json()) as { id: string }).id;
    const start = (topicId: string, reportAxes?: string) =>
      call(
        `/api/classrooms/${classroomId}/activities`,
        jsonInit({ topicId, mode: "test", ...(reportAxes ? { reportAxes } : {}) }, teacher),
      );
    const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;
    const storedAxesOf = async (res: Response) => {
      const { activityId } = (await res.json()) as { activityId: string };
      const row = await one<{ report_axes: string | null }>(
        env.DB,
        "SELECT report_axes FROM activities WHERE id = $id",
        { id: activityId },
      );
      return row?.report_axes ?? null;
    };
    try {
      expect(await configNow()).toBe("ai");
      const staged = await putSettings(admin, { reportAxes: "teacher" });
      expect(staged.status).toBe(200);
      expect(await staged.json()).toEqual({ reportAxes: "teacher" });
      const read = await call("/api/admin/settings", { headers: { Cookie: admin } });
      expect(await read.json()).toEqual({ reportAxes: "teacher" });
      expect(await configNow()).toBe("ai");

      const omitted = await start(bareTopicId);
      expect(omitted.status).toBe(201);
      expect(await storedAxesOf(omitted)).toBe("ai");

      const explicitAi = await start(bareTopicId, "ai");
      expect(explicitAi.status).toBe(201);
      expect(await storedAxesOf(explicitAi)).toBe("ai");

      const refusedTeacher = await start(withAxesTopicId, "teacher");
      expect(refusedTeacher.status).toBe(422);
      expect(await codeOf(refusedTeacher)).toBe("report_axes_not_allowed");
    } finally {
      await putSettings(admin, { reportAxes: "both" });
    }
  });
});
