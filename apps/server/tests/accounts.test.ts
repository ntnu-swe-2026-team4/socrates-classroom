import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { TRIAL_LIMITS } from "@socrates/shared";
import { one, run } from "../src/db/d1";
import { seedDemo } from "../src/seed";
import { call, cookieOf, enableTeacher, registerAccount } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let admin: string;
let topicId: string;

function send(path: string, cookie: string | null, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function openClassroom(cookie: string, name: string) {
  const res = await send("/api/classrooms", cookie, "POST", { name });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { classroomId: string; code: string; url: string };
  const started = await send(`/api/classrooms/${created.classroomId}/activities`, cookie, "POST", { topicId });
  expect(started.status).toBe(201);
  const activity = (await started.json()) as { activityId: string };
  return { ...created, activityId: activity.activityId };
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  admin = await enableTeacher(
    cookieOf(await send("/api/auth/login", null, "POST", { email: "admin@socrates.tw", password: "demo-demo" })),
  );
  await run(env.DB, "UPDATE users SET teacher_plan = 'school' WHERE email = 'admin@socrates.tw'");
  topicId = ((await (await call("/api/topics", { headers: { Cookie: admin } })).json()) as Array<{ id: string }>)[0]!
    .id;
});

describe("teacher mode", () => {
  it("stays off until an admin approves a request, then toggles freely on the trial plan", async () => {
    const account = await registerAccount("試用老師");
    const me = (await (await call("/api/me", { headers: { Cookie: account.cookie } })).json()) as { id: string };
    expect(me).toMatchObject({ kind: "member", teacherPlan: null, teacherMode: false, isAdmin: false });

    const direct = await send("/api/me", account.cookie, "PATCH", { teacherMode: true });
    expect(direct.status).toBe(403);
    expect(await codeOf(direct)).toBe("teacher_approval_required");
    expect((await send("/api/me/teacher-request", account.cookie, "POST", {})).status).toBe(422);

    const asked = await send("/api/me/teacher-request", account.cookie, "POST", { acceptTeacherTerms: true });
    expect(await asked.json()).toMatchObject({ teacherPlan: null, teacherMode: false, teacherRequested: true });
    expect((await send("/api/admin/teacher-requests", account.cookie, "GET")).status).toBe(403);
    const queue = (await (await send("/api/admin/teacher-requests", admin, "GET")).json()) as Array<{ id: string }>;
    expect(queue.some((item) => item.id === me.id)).toBe(true);
    expect((await send(`/api/admin/teacher-requests/${me.id}/approve`, account.cookie, "POST")).status).toBe(403);
    expect((await send(`/api/admin/teacher-requests/${me.id}/approve`, admin, "POST")).status).toBe(204);
    expect((await send(`/api/admin/teacher-requests/${me.id}/approve`, admin, "POST")).status).toBe(404);

    const on = await send("/api/me", account.cookie, "PATCH", { teacherMode: true });
    expect(await on.json()).toMatchObject({ teacherPlan: "trial", teacherMode: true, teacherRequested: false });
    const off = await send("/api/me", account.cookie, "PATCH", { teacherMode: false });
    expect(await off.json()).toMatchObject({ teacherPlan: "trial", teacherMode: false });
    const blocked = await send("/api/classrooms", account.cookie, "POST", { name: "關閉時" });
    expect(await codeOf(blocked)).toBe("capability_required");
  });

  it("an admin can turn a request down, and the user may ask again", async () => {
    const account = await registerAccount("被婉拒的人");
    const me = (await (await call("/api/me", { headers: { Cookie: account.cookie } })).json()) as { id: string };
    await send("/api/me/teacher-request", account.cookie, "POST", { acceptTeacherTerms: true });
    expect((await send(`/api/admin/teacher-requests/${me.id}`, admin, "DELETE")).status).toBe(204);
    const after = (await (await call("/api/me", { headers: { Cookie: account.cookie } })).json()) as object;
    expect(after).toMatchObject({ teacherPlan: null, teacherRequested: false });
    const again = await send("/api/me/teacher-request", account.cookie, "POST", { acceptTeacherTerms: true });
    expect(await again.json()).toMatchObject({ teacherRequested: true });
  });

  it("an admin sees the overview and user list, and can grant or take back teaching access", async () => {
    const account = await registerAccount("被管理的人");
    const me = (await (await call("/api/me", { headers: { Cookie: account.cookie } })).json()) as { id: string };
    expect((await send("/api/admin/overview", account.cookie, "GET")).status).toBe(403);
    expect((await send("/api/admin/users", account.cookie, "GET")).status).toBe(403);
    const overview = (await (await send("/api/admin/overview", admin, "GET")).json()) as Record<string, number>;
    expect(overview.users).toBeGreaterThan(1);
    expect(overview.teachers).toBeGreaterThan(0);

    const found = (await (await send("/api/admin/users?q=被管理", admin, "GET")).json()) as Array<{
      id: string;
      teacherPlan: string | null;
    }>;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: me.id, teacherPlan: null });

    expect((await send(`/api/admin/users/${me.id}/teacher`, account.cookie, "PUT")).status).toBe(403);
    expect((await send(`/api/admin/users/${me.id}/teacher`, admin, "PUT")).status).toBe(204);
    const on = await send("/api/me", account.cookie, "PATCH", { teacherMode: true });
    expect(await on.json()).toMatchObject({ teacherPlan: "trial", teacherMode: true });

    expect((await send(`/api/admin/users/${me.id}/teacher`, admin, "DELETE")).status).toBe(204);
    const after = (await (await call("/api/me", { headers: { Cookie: account.cookie } })).json()) as object;
    expect(after).toMatchObject({ teacherPlan: null, teacherMode: false });
    const adminMe = (await (await call("/api/me", { headers: { Cookie: admin } })).json()) as { id: string };
    expect((await send(`/api/admin/users/${adminMe.id}/teacher`, admin, "DELETE")).status).toBe(403);
  });

  it("caps trial classrooms; school teachers are not capped", async () => {
    const trial = await enableTeacher((await registerAccount("開好開滿")).cookie);
    for (let index = 0; index < TRIAL_LIMITS.classrooms; index += 1) await openClassroom(trial, `試用班 ${index}`);
    const over = await send("/api/classrooms", trial, "POST", { name: "超過了", topicId });
    expect(over.status).toBe(403);
    expect(await codeOf(over)).toBe("trial_limit");

    for (let index = 0; index <= TRIAL_LIMITS.classrooms; index += 1) await openClassroom(admin, `學校班 ${index}`);
  });
});

describe("student accounts", () => {
  it("the owner creates accounts; students sign in by username, stay in their class, and can be reset or removed", async () => {
    const room = await openClassroom(admin, "受管學生班");
    const stranger = await registerAccount("別班老師");
    expect(
      (await send(`/api/classrooms/${room.classroomId}/students`, stranger.cookie, "POST", { names: ["甲"] })).status,
    ).toBe(403);

    const created = await send(`/api/classrooms/${room.classroomId}/students`, admin, "POST", {
      names: ["王小明", "李小華"],
    });
    expect(created.status).toBe(201);
    const [ming, hua] = (await created.json()) as Array<{ id: string; username: string; password: string }>;
    expect(ming!.username).toBe(`${room.code}-01`);
    expect(hua!.username).toBe(`${room.code}-02`);
    expect(
      (await send(`/api/classrooms/${room.classroomId}/students`, admin, "POST", { names: ["王小明"] })).status,
    ).toBe(409);

    const login = await send("/api/auth/login", null, "POST", { identifier: ming!.username, password: ming!.password });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ kind: "student", classroomId: room.classroomId, guest: false });
    const student = cookieOf(login);

    const list = (await (await call("/api/classrooms", { headers: { Cookie: student } })).json()) as Array<{
      id: string;
    }>;
    expect(list.map((entry) => entry.id)).toEqual([room.classroomId]);

    const other = await openClassroom(admin, "別的班");
    const join = await send("/api/join", student, "POST", { code: other.code, tosAccepted: true });
    expect(await codeOf(join)).toBe("student_restricted");
    expect((await call("/api/solo/chats", { headers: { Cookie: student } })).status).toBe(403);
    expect((await send("/api/me", student, "PATCH", { teacherMode: true, acceptTeacherTerms: true })).status).toBe(403);
    expect((await send(`/api/classrooms/${room.classroomId}/members/${ming!.id}`, student, "DELETE")).status).toBe(403);

    const members = (await (
      await call(`/api/classrooms/${room.classroomId}/members`, { headers: { Cookie: admin } })
    ).json()) as { members: Array<{ id: string; kind: string; username?: string | null }> };
    expect(members.members.find((entry) => entry.id === ming!.id)).toMatchObject({
      kind: "student",
      username: ming!.username,
    });

    const reset = await send(`/api/classrooms/${room.classroomId}/students/${ming!.id}/password`, admin, "POST");
    const { password } = (await reset.json()) as { password: string };
    expect(password).not.toBe(ming!.password);
    expect(
      (await send("/api/auth/login", null, "POST", { identifier: ming!.username, password: ming!.password })).status,
    ).toBe(401);
    expect((await send("/api/auth/login", null, "POST", { identifier: ming!.username, password })).status).toBe(200);

    expect((await send(`/api/classrooms/${room.classroomId}/members/${ming!.id}`, admin, "DELETE")).status).toBe(204);
    expect((await call("/api/me", { headers: { Cookie: student } })).status).toBe(200);
    expect(await (await call("/api/me", { headers: { Cookie: student } })).json()).toBeNull();
  });

  it("trial classrooms stop accepting people at the seat limit", async () => {
    const trial = await enableTeacher((await registerAccount("小班老師")).cookie);
    const room = await openClassroom(trial, "小班");
    const names = Array.from({ length: TRIAL_LIMITS.membersPerClassroom + 1 }, (_, index) => `學生${index}`);
    const over = await send(`/api/classrooms/${room.classroomId}/students`, trial, "POST", { names });
    expect(over.status).toBe(403);
    expect(await codeOf(over)).toBe("trial_limit");
    await run(
      env.DB,
      "UPDATE users SET teacher_plan = 'school' WHERE id = (SELECT teacher_id FROM classrooms WHERE id = $id)",
      {
        id: room.classroomId,
      },
    );
    const batch = names.slice(0, 3);
    expect((await send(`/api/classrooms/${room.classroomId}/students`, trial, "POST", { names: batch })).status).toBe(
      201,
    );
  });
});

describe("guests", () => {
  it("an account-less guest joins through the join code without a users row", async () => {
    const room = await openClassroom(admin, "訪客班");
    const before = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM users");
    const joined = await send("/api/join", null, "POST", { code: room.code, name: "路過的人", tosAccepted: true });
    expect(joined.status).toBe(200);
    const guest = cookieOf(joined);
    const body = (await joined.json()) as { user: unknown; participantId: string; kind: string };
    expect(body).toMatchObject({ user: null, kind: "guest" });
    expect(body.participantId).toBeTruthy();
    const after = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM users");
    expect(Number(after?.n)).toBe(Number(before?.n));

    expect(await (await call("/api/me", { headers: { Cookie: guest } })).json()).toBeNull();
    expect((await call("/api/solo/chats", { headers: { Cookie: guest } })).status).toBe(401);
    expect(
      (await call(`/api/classrooms/${room.classroomId}/announcements`, { headers: { Cookie: guest } })).status,
    ).toBe(401);
    expect((await call(`/api/activities/${room.activityId}`, { headers: { Cookie: guest } })).status).toBe(200);

    const next = await send(`/api/classrooms/${room.classroomId}/activities`, admin, "POST", { topicId });
    const nextId = ((await next.json()) as { activityId: string }).activityId;
    expect((await call(`/api/activities/${nextId}`, { headers: { Cookie: guest } })).status).toBe(401);
  });

  it("a guest name stays unique inside one activity", async () => {
    const room = await openClassroom(admin, "訪客重名班");
    const first = await send("/api/join", null, "POST", { code: room.code, name: "訪客甲", tosAccepted: true });
    expect(first.status).toBe(200);
    const again = await send("/api/join", null, "POST", { code: room.code, name: "訪客甲", tosAccepted: true });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("name_taken");
  });
});

describe("admin", () => {
  it("creates schools and provisions school teachers; non-admins are refused", async () => {
    const member = await registerAccount("一般人");
    expect((await call("/api/admin/schools", { headers: { Cookie: member.cookie } })).status).toBe(403);

    const school = (await (await send("/api/admin/schools", admin, "POST", { name: "蘇格拉底高中" })).json()) as {
      id: string;
    };
    const created = await send("/api/admin/teachers", admin, "POST", {
      name: "陳老師",
      email: `chen-${Date.now()}@school.tw`,
      schoolId: school.id,
    });
    expect(created.status).toBe(201);
    const teacher = (await created.json()) as { id: string; email: string; temporaryPassword: string };
    expect(teacher.temporaryPassword).toBeTruthy();
    const login = await send("/api/auth/login", null, "POST", {
      identifier: teacher.email,
      password: teacher.temporaryPassword,
    });
    expect(await login.json()).toMatchObject({ teacherPlan: "school", teacherMode: false, schoolName: "蘇格拉底高中" });

    const email = `promote-${Date.now()}@socrates.tw`;
    const existing = await send("/api/auth/signup", null, "POST", {
      name: "升任",
      email,
      password: "promote-pass-1",
      tosAccepted: true,
    });
    const promoted = await send("/api/admin/teachers", admin, "POST", { name: "升任", email, schoolId: school.id });
    expect(await promoted.json()).toMatchObject({
      id: ((await existing.json()) as { id: string }).id,
      temporaryPassword: null,
    });

    const byEmail = await send("/api/admin/teachers", admin, "POST", {
      email: `only-mail-${Date.now()}@school.tw`,
      schoolId: school.id,
    });
    expect(byEmail.status).toBe(201);
    const named = (await byEmail.json()) as { id: string; name: string };
    expect(named.name).toMatch(/^only-mail-/);
    expect((await send(`/api/admin/teachers/${named.id}`, admin, "DELETE")).status).toBe(204);

    const schools = (await (await call("/api/admin/schools", { headers: { Cookie: admin } })).json()) as Array<{
      id: string;
      teacherCount: number;
    }>;
    expect(schools.find((entry) => entry.id === school.id)?.teacherCount).toBe(2);

    expect((await send(`/api/admin/teachers/${teacher.id}`, admin, "DELETE")).status).toBe(204);
    const downgraded = await send("/api/auth/login", null, "POST", {
      identifier: teacher.email,
      password: teacher.temporaryPassword,
    });
    expect(await downgraded.json()).toMatchObject({ teacherPlan: "trial", schoolName: null });
  });
});
