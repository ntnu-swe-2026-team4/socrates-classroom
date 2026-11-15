import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { ADMIN_LIST_CAP, AdminDashboardSchema, type AdminDashboard } from "@socrates/shared";
import { hashPassword, issueSessionToken } from "../src/auth";
import { all, batch, run } from "../src/db/d1";
import { gatewayConfig } from "../src/gateway/config.gen";
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

async function dashboard(cookie: string): Promise<{ res: Response; body: AdminDashboard }> {
  const res = await call("/api/admin/dashboard", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return { res, body: AdminDashboardSchema.parse(await res.clone().json()) };
}

async function createClassroom(name: string): Promise<{ code: string; activityId: string }> {
  const topics = (await (await call("/api/topics", { headers: { Cookie: admin } })).json()) as Array<{ id: string }>;
  const res = await call("/api/classrooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({ name, topicId: topics[0]!.id }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; activityId: string };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("admin dashboard (GET /api/admin/dashboard)", () => {
  test("guarded like the rest of /admin, and cacheable for the admin only", async () => {
    expect((await call("/api/admin/dashboard")).status).toBe(401);
    expect((await call("/api/admin/dashboard", { headers: { Cookie: student } })).status).toBe(403);
    expect((await call("/api/admin/dashboard", { headers: { Cookie: otherTeacher } })).status).toBe(403);
    const { res } = await dashboard(admin);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
  });

  test("stuckAfterMs is derived from the report retry budget", async () => {
    const { alarmAttempts, alarmTimeoutMs } = gatewayConfig.report;
    const { body } = await dashboard(admin);
    expect(body.stuckAfterMs).toBe(alarmAttempts * alarmTimeoutMs + 5 * 60_000);
  });

  test("counts move with real data: a new classroom and a guest who joins it", async () => {
    const before = (await dashboard(admin)).body;
    const created = await createClassroom("計數班");
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "計數生", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const after = (await dashboard(admin)).body;

    expect(after.counts.classrooms).toBe(before.counts.classrooms + 1);
    expect(after.counts.activeActivities).toBe(before.counts.activeActivities + 1);
    expect(after.counts.memberships).toBe(before.counts.memberships + 1);
    expect(after.counts.byRole.student).toBe((before.counts.byRole.student ?? 0) + 1);
    expect(after.recentClassrooms.items[0]).toMatchObject({ name: "計數班", members: 1, state: "active" });

    const sum = (rows: AdminDashboard["hourly"], key: "classrooms" | "joins") =>
      rows.reduce((total, row) => total + row[key], 0);
    expect(sum(after.hourly, "classrooms")).toBe(sum(before.hourly, "classrooms") + 1);
    expect(sum(after.hourly, "joins")).toBe(sum(before.hourly, "joins") + 1);
  });

  test("rows that share a timestamp come back in a stable, insertion-based order", async () => {
    const teacherId = (await all<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'teacher' LIMIT 1"))[0]!.id;
    for (const name of ["同刻先建班", "同刻後建班"]) {
      const id = newId("c_");
      await run(
        env.DB,
        "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $teacher, $code, NULL, $at)",
        { id, name, teacher: teacherId, code: `TI${id.slice(-6).toUpperCase()}`, at: "2001-01-01T00:00:00.000Z" },
      );
    }
    const at = minutesAgo(30);
    const stuckFirst = await createClassroom("同刻卡住先");
    const stuckSecond = await createClassroom("同刻卡住後");
    for (const room of [stuckFirst, stuckSecond]) {
      await run(
        env.DB,
        "INSERT INTO reports (activity_id, status, created_at, updated_at) VALUES ($id, 'pending', $at, $at)",
        {
          id: room.activityId,
          at,
        },
      );
    }
    const finishedFirst = await createClassroom("同刻結案先");
    const finishedSecond = await createClassroom("同刻結案後");
    for (const room of [finishedFirst, finishedSecond]) {
      await run(env.DB, "UPDATE activities SET finished_at = $at WHERE id = $id", { id: room.activityId, at });
    }

    const { body } = await dashboard(admin);
    const comesFirst = (list: string[], first: string, second: string) => {
      expect(list).toContain(first);
      expect(list).toContain(second);
      return list.indexOf(first) < list.indexOf(second);
    };
    const recent = body.recentClassrooms.items.map((item) => item.name);
    const empty = body.emptyClassrooms.items.map((item) => item.name);
    expect(comesFirst(recent, "同刻後建班", "同刻先建班")).toBe(true);
    expect(comesFirst(empty, "同刻後建班", "同刻先建班")).toBe(true);
    const stuck = body.reports.stuck.items.map((item) => item.activityId);
    expect(comesFirst(stuck, stuckFirst.activityId, stuckSecond.activityId)).toBe(true);
    const finished = body.reports.finishedWithoutReport.items.map((item) => item.activityId);
    expect(comesFirst(finished, finishedFirst.activityId, finishedSecond.activityId)).toBe(true);
  });

  test("only a pending report older than the budget counts as stuck", async () => {
    const stale = await createClassroom("卡住班");
    const fresh = await createClassroom("新報告班");
    const settled = await createClassroom("已完成班");
    const partial = await createClassroom("部分完成班");
    const failed = await createClassroom("失敗班");
    const insert = (activityId: string, status: string, at: string) =>
      run(env.DB, "INSERT INTO reports (activity_id, status, created_at, updated_at) VALUES ($id, $status, $at, $at)", {
        id: activityId,
        status,
        at,
      });
    await insert(stale.activityId, "pending", minutesAgo(25));
    await insert(fresh.activityId, "pending", minutesAgo(1));
    await insert(settled.activityId, "ready", minutesAgo(25));
    await insert(partial.activityId, "partial", minutesAgo(25));
    await insert(failed.activityId, "failed", minutesAgo(25));

    const { body } = await dashboard(admin);
    const stuckIds = body.reports.stuck.items.map((item) => item.activityId);
    expect(stuckIds).toContain(stale.activityId);
    expect(stuckIds).not.toContain(fresh.activityId);
    expect(stuckIds).not.toContain(settled.activityId);
    expect(stuckIds).not.toContain(partial.activityId);
    expect(stuckIds).not.toContain(failed.activityId);
    expect(body.reports.stuck.total).toBe(stuckIds.length);
    expect(body.reports.byStatus.partial).toBeGreaterThanOrEqual(1);
    expect(body.reports.byStatus.failed).toBeGreaterThanOrEqual(1);
    expect(body.reports.byStatus.pending).toBeGreaterThanOrEqual(2);
    expect(body.reports.byStatus.ready).toBeGreaterThanOrEqual(1);
  });

  test("a long-finished activity without any report row is listed, a recent one is not", async () => {
    const old = await createClassroom("結案無報告班");
    const recent = await createClassroom("剛結案班");
    const reported = await createClassroom("結案有報告班");
    const finish = (activityId: string, at: string) =>
      run(env.DB, "UPDATE activities SET finished_at = $at WHERE id = $id", { id: activityId, at });
    await finish(old.activityId, minutesAgo(25));
    await finish(recent.activityId, minutesAgo(1));
    await finish(reported.activityId, minutesAgo(25));
    await run(
      env.DB,
      "INSERT INTO reports (activity_id, status, created_at, updated_at) VALUES ($id, 'ready', $at, $at)",
      { id: reported.activityId, at: minutesAgo(20) },
    );

    const { body } = await dashboard(admin);
    const ids = body.reports.finishedWithoutReport.items.map((item) => item.activityId);
    expect(ids).toContain(old.activityId);
    expect(ids).not.toContain(recent.activityId);
    expect(ids).not.toContain(reported.activityId);
  });

  test("a classroom nobody joined within a day is listed as empty", async () => {
    const quiet = await createClassroom("無人加入班");
    await run(
      env.DB,
      "UPDATE classrooms SET created_at = $at WHERE id = (SELECT classroom_id FROM activities WHERE id = $a)",
      {
        at: minutesAgo(25 * 60),
        a: quiet.activityId,
      },
    );
    const { body } = await dashboard(admin);
    expect(body.emptyClassrooms.items.map((item) => item.name)).toContain("無人加入班");
    expect(body.emptyClassrooms.items.map((item) => item.name)).not.toContain("計數班");
  });

  test("privacy: no student names, emails, join codes, password hashes or user ids leave the server", async () => {
    const { res } = await dashboard(admin);
    const text = await res.text();
    const codes = (await all<{ join_code: string }>(env.DB, "SELECT join_code FROM classrooms")).map(
      (row) => row.join_code,
    );
    expect(codes.length).toBeGreaterThan(0);
    const forbidden = [
      "計數生",
      "管理員測試生",
      "demo@socrates.tw",
      "other@teacher.test",
      "pbkdf2$",
      "外部老師",
      "林老師",
      ...codes,
    ];
    for (const needle of forbidden) expect(text, `response must not contain "${needle}"`).not.toContain(needle);
    expect(text).not.toMatch(/u_[0-9a-f]{32}/);
  });
});

describe("admin dashboard classroom state", () => {
  async function addClassroom(name: string, withActivity: "none" | "open" | "finished"): Promise<void> {
    const teacherId = (await all<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'teacher' LIMIT 1"))[0]!.id;
    const topicId = (await all<{ id: string }>(env.DB, "SELECT id FROM topics LIMIT 1"))[0]!.id;
    const classroomId = newId("c_");
    const activityId = withActivity === "none" ? null : newId("a_");
    await run(
      env.DB,
      "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $teacher, $code, NULL, $at)",
      {
        id: classroomId,
        name,
        teacher: teacherId,
        code: `ST${classroomId.slice(-6).toUpperCase()}`,
        at: new Date(Date.now() - 3_600_000).toISOString(),
      },
    );
    if (!activityId) return;
    await run(
      env.DB,
      "INSERT INTO activities (id, classroom_id, topic_id, created_at, finished_at) VALUES ($id, $cid, $topic, $at, $done)",
      {
        id: activityId,
        cid: classroomId,
        topic: topicId,
        at: nowIso(),
        done: withActivity === "finished" ? nowIso() : null,
      },
    );
    await run(env.DB, "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid", {
      aid: activityId,
      cid: classroomId,
    });
  }

  test("a classroom without a current activity is reported as none, not as active", async () => {
    await addClassroom("狀態無活動班", "none");
    await addClassroom("狀態進行中班", "open");
    await addClassroom("狀態已結束班", "finished");
    const { body } = await dashboard(admin);
    const stateOf = (name: string) => body.recentClassrooms.items.find((item) => item.name === name)?.state;
    expect(stateOf("狀態無活動班")).toBe("none");
    expect(stateOf("狀態進行中班")).toBe("active");
    expect(stateOf("狀態已結束班")).toBe("finished");
  });
});

describe("admin dashboard lists", () => {
  test("each list reports its exact total, and the total matches the rows when under the cap", async () => {
    const { body } = await dashboard(admin);
    const rows = await all<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM classrooms");
    expect(body.recentClassrooms.total).toBe(rows[0]!.n);
    expect(body.recentClassrooms.items).toHaveLength(Math.min(rows[0]!.n, ADMIN_LIST_CAP));
    expect(body.emptyClassrooms.total).toBe(body.emptyClassrooms.items.length);
    expect(body.reports.stuck.total).toBe(body.reports.stuck.items.length);
  });

  test("past the cap the rows are cut but the total stays exact, newest first", async () => {
    const before = (await dashboard(admin)).body.recentClassrooms.total;
    const teacherId = (await all<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'teacher' LIMIT 1"))[0]!.id;
    const extra = ADMIN_LIST_CAP + 5;
    const entries = Array.from({ length: extra }, (_, index) => ({
      sql: `INSERT INTO classrooms (id, name, teacher_id, join_code, created_at)
         VALUES ($id, $name, $teacher, $code, $at)`,
      params: {
        id: newId("c_"),
        name: `溢出班 ${index}`,
        teacher: teacherId,
        code: `OVF${String(index).padStart(4, "0")}`,
        at: new Date(Date.now() + 60_000 + index).toISOString(),
      },
    }));
    for (let start = 0; start < entries.length; start += 50) {
      await batch(env.DB, entries.slice(start, start + 50));
    }
    const { body } = await dashboard(admin);
    expect(body.recentClassrooms.total).toBe(before + extra);
    expect(body.recentClassrooms.items).toHaveLength(ADMIN_LIST_CAP);
    expect(body.recentClassrooms.items[0]!.name).toBe(`溢出班 ${extra - 1}`);
    const times = body.recentClassrooms.items.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  }, 30_000);
});
