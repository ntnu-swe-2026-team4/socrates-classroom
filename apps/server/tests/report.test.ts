import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { reportAlarmPlan } from "../src/do/report-runner";
import { call, classroomWithActivity, cookieOf, participantIdOf, registerStudent, speak } from "./helpers";

let teacherCookie: string;
let classroomCode: string;
let activityId: string;
const students: Array<{ cookie: string; participantId: string }> = [];

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacherCookie = cookieOf(login);
  const created = await classroomWithActivity(teacherCookie, "報告班");
  classroomCode = created.code;
  activityId = created.activityId;

  for (const name of ["小明", "阿華", "小靜"]) {
    const account = await registerStudent(classroomCode, name);
    students.push({ cookie: account.cookie, participantId: await participantIdOf(activityId, account.cookie) });
  }

  await run(
    env.DB,
    `INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at)
     VALUES ($cid, 'u_fx_student_c', '陳志豪', $at, $at)`,
    { cid: created.classroomId, at: new Date().toISOString() },
  );

  await speak(`${activityId}:${students[0]!.participantId}`, students[0]!.cookie, "我覺得契約應該被遵守");
  await speak(`${activityId}:${students[1]!.participantId}`, students[1]!.cookie, "幫我寫一個 python 排序");

  const finish = await call(`/api/activities/${activityId}/finish`, {
    method: "POST",
    headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.20" },
  });
  expect(finish.status).toBe(204);
});

describe("reportAlarmPlan", () => {
  const base = { cap: 3, timeoutMs: 300_000, backoffMs: 4_000 };

  it("generates under the cap; backoff scales with post-increment attempts", () => {
    expect(reportAlarmPlan({ ...base, attempts: 1, inFlight: false })).toEqual({
      action: "generate",
      backoffMs: 4_000,
    });
    expect(reportAlarmPlan({ ...base, attempts: 3, inFlight: false })).toEqual({
      action: "generate",
      backoffMs: 12_000,
    });
  });

  it("re-arms at the timeout interval while a run is still in flight", () => {
    expect(reportAlarmPlan({ ...base, attempts: 1, inFlight: true })).toEqual({ action: "rearm", delayMs: 300_000 });
    expect(reportAlarmPlan({ ...base, attempts: 3, inFlight: true })).toEqual({ action: "rearm", delayMs: 300_000 });
  });

  it("cap boundary: attempts == cap still acts, cap+1 is terminal on both paths", () => {
    expect(reportAlarmPlan({ ...base, attempts: 3, inFlight: false }).action).toBe("generate");
    expect(reportAlarmPlan({ ...base, attempts: 3, inFlight: true }).action).toBe("rearm");
    expect(reportAlarmPlan({ ...base, attempts: 4, inFlight: false })).toEqual({ action: "terminal" });
    expect(reportAlarmPlan({ ...base, attempts: 4, inFlight: true })).toEqual({ action: "terminal" });
  });
});

describe("report pipeline (transcript from Chat DO → ReportRunner → §7 shape)", () => {
  it("finish → alarm generates → ready; teacher sees the whole class, student sees their own, shape matches §7", async () => {
    let report: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      report = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      expect(((await report.clone().json()) as { code?: string }).code).toBe("report_pending");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const teacherReport = (await report?.json()) as {
      topicTitle: string;
      classReport: { axes: unknown[]; overview: string[]; students: Array<{ id: string }> };
      students: Array<{
        participantId: string;
        participantName: string;
        pseudonym: string;
        analysis: { stated: boolean } | null;
        violations: Array<{ turn: number; type: string; excerpt: string }>;
        positions: Array<{ axis: string; at: number; end: string }>;
      }>;
    };
    expect(teacherReport.classReport.axes.length).toBeGreaterThan(0);
    expect(teacherReport.students).toHaveLength(2);
    expect(teacherReport.students.map((s) => s.participantName).sort()).toEqual(["小明", "阿華"].sort());
    expect(teacherReport.students.map((s) => s.pseudonym).every((p) => p.startsWith("學生"))).toBe(true);
    const positioned = teacherReport.students.find((s) => s.positions.length > 0);
    expect(positioned?.positions[0]).toMatchObject({ axis: "契約與承諾", end: "middle", at: 50 });

    const speaker = teacherReport.students.find((s) => s.participantId === students[0]!.participantId)!;
    expect(speaker.analysis?.stated).toBe(true);
    expect(speaker.violations).toHaveLength(0);

    const coder = teacherReport.students.find((s) => s.participantId === students[1]!.participantId)!;
    expect(coder.violations.length).toBeGreaterThan(0);
    expect(coder.violations[0]!.type).toBe("coding");
    expect(coder.violations[0]!.turn).toBe(1);

    const own = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[0]!.cookie } });
    expect(own.status).toBe(200);
    const studentReport = (await own.json()) as {
      topicTitle: string;
      participantName: string;
      pseudonym: string;
      analysis: { stated: boolean } | null;
      violations: unknown[];
    };
    expect(studentReport.participantName).toBe("小明");
    expect(studentReport.pseudonym).toBe(speaker.pseudonym);
    expect(studentReport.analysis?.stated).toBe(true);
    expect("classReport" in studentReport).toBe(false);

    const silent = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[2]!.cookie } });
    expect(silent.status).toBe(404);
    expect(((await silent.json()) as { code: string }).code).toBe("not_found");

    const bystander = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student-c@socrates.tw", password: "demo-demo" }),
    });
    expect(bystander.status).toBe(200);
    const absent = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: cookieOf(bystander) } });
    expect(absent.status).toBe(404);
    expect(((await absent.json()) as { code: string }).code).toBe("not_found");
  }, 60_000);

  it("generate failing every attempt → retries, then terminal failed (500 report_failed)", async () => {
    const topic = (await (
      await call("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacherCookie },
        body: JSON.stringify({
          title: "重試班題目",
          statement: "契約的界線在哪？FORCE-REPORT-GENERATE-FAILURE",
          prompts: ["請舉例"],
        }),
      })
    ).json()) as { id: string };
    const created = await classroomWithActivity(teacherCookie, "重試班", topic.id);
    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.21" },
    });
    expect(finish.status).toBe(204);

    let sawPending = false;
    let last: Response | null = null;
    for (let i = 0; i < 45; i += 1) {
      last = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (last.status === 404) sawPending = true;
      if (last.status === 500) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(sawPending).toBe(true);
    expect(last?.status).toBe(500);
    const body = (await last?.json()) as { code?: string };
    expect(body?.code).toBe("report_failed");
  }, 60_000);

  it("class-report failure with student analyses stored → partial per §7 (200, classReport null, positions empty)", async () => {
    const created = await classroomWithActivity(teacherCookie, "partial 班");
    const joined = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: created.code,
        name: "小標",
        email: `partial-${crypto.randomUUID()}@socrates.tw`,
        password: "student-pass-1",
        tosAccepted: true,
      }),
    });
    expect(joined.status).toBe(200);
    const studentCookie = cookieOf(joined);

    await speak(
      `${created.activityId}:${await participantIdOf(created.activityId, studentCookie)}`,
      studentCookie,
      "FORCE-CLASS-REPORT-FAILURE",
    );

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.22" },
    });
    expect(finish.status).toBe(204);

    let report: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const partial = (await report?.json()) as {
      classReport: { axes: unknown[] } | null;
      students: Array<{ analysis: { stated: boolean } | null; positions: unknown[] }>;
    };
    expect(partial.classReport).toBeNull();
    expect(partial.students).toHaveLength(1);
    expect(partial.students[0]!.analysis?.stated).toBe(true);
    expect(partial.students[0]!.positions).toEqual([]);

    const own = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: studentCookie } });
    expect(own.status).toBe(200);
    const ownReport = (await own.json()) as { analysis: { stated: boolean } | null; positions: unknown[] };
    expect(ownReport.analysis?.stated).toBe(true);
    expect(ownReport.positions).toEqual([]);
  }, 60_000);
});

describe("stored report read-back validation", () => {
  it("a corrupted stored row → 500 report_failed, not an off-contract shape", async () => {
    const created = await classroomWithActivity(teacherCookie, "損壞列班");
    await run(
      env.DB,
      `INSERT INTO reports (activity_id, status, teacher_report, student_reports, created_at, updated_at)
       VALUES ($id, 'ready', '{"nope":1}', '{}', $at, $at) ON CONFLICT(activity_id) DO UPDATE SET status = 'ready', teacher_report = '{"nope":1}'`,
      { id: created.activityId, at: new Date().toISOString() },
    );
    const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code?: string }).code).toBe("report_failed");
  });
});
