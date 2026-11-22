import { env } from "cloudflare:workers";
import { applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { z } from "zod";
import { ThinkingIndicatorsSchema, type StudentAnalysis, type ThinkingIndicators } from "@socrates/shared";
import { byCodeUnit } from "@socrates/shared";
import {
  PlannedClassReportSubmissionSchema,
  ReportAxesPlanSchema,
  SUBMIT_CLASS_AXES_REPORT,
  SUBMIT_CLASS_REPORT,
  SUBMIT_STUDENT_ANALYSIS,
  SUBMIT_STUDENT_INDICATORS,
} from "../src/pi/extensions/report-submit";
import {
  type ReportRunner,
  citesSpokenLines,
  indicatorsCiteSpokenLines,
  pointOnAxis,
  reportAlarmPlan,
  toClassReport,
  toPlannedClassReport,
} from "../src/do/report-runner";
import { call, classroomWithActivity, cookieOf, must, participantIdOf, registerStudent, speak } from "./helpers";

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

  await speak(`${activityId}:${students[0].participantId}`, students[0].cookie, "我覺得契約應該被遵守");
  await speak(`${activityId}:${students[1].participantId}`, students[1].cookie, "幫我寫一個 python 排序");

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
    for (let i = 0; i < 120; i += 1) {
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
    expect(teacherReport.students.map((s) => s.participantName).sort(byCodeUnit)).toEqual(
      ["小明", "阿華"].sort(byCodeUnit),
    );
    expect(teacherReport.students.map((s) => s.pseudonym).every((p) => p.startsWith("學生"))).toBe(true);
    const positioned = teacherReport.students.find((s) => s.positions.length > 0);
    expect(positioned?.positions[0]).toMatchObject({ axis: "契約與承諾", end: "middle", at: 50 });

    const speaker = must(
      teacherReport.students.find((s) => s.participantId === students[0].participantId),
      "speaker student row",
    );
    expect(speaker.analysis?.stated).toBe(true);
    expect(speaker.violations).toHaveLength(0);

    const coder = must(
      teacherReport.students.find((s) => s.participantId === students[1].participantId),
      "coder student row",
    );
    expect(coder.violations.length).toBeGreaterThan(0);
    expect(coder.violations[0].type).toBe("coding");
    expect(coder.violations[0].turn).toBe(1);

    const own = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[0].cookie } });
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

    const silent = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[2].cookie } });
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
  }, 90_000);

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
    for (let i = 0; i < 120; i += 1) {
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
    expect(partial.students[0].analysis?.stated).toBe(true);
    expect(partial.students[0].positions).toEqual([]);
    expect(
      Object.keys((partial.students[0] as { indicators?: object | null }).indicators ?? {}).sort(byCodeUnit),
    ).toEqual(["a1", "a2", "c1", "c2", "s1", "s2"]);

    const own = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: studentCookie } });
    expect(own.status).toBe(200);
    const ownReport = (await own.json()) as { analysis: { stated: boolean } | null; positions: unknown[] };
    expect(ownReport.analysis?.stated).toBe(true);
    expect(ownReport.positions).toEqual([]);
  }, 90_000);
});

describe("class report positions: the model gives the side and how firmly; the server computes the point", () => {
  it("pointOnAxis: left is below 50, right above, middle 50; firmer is farther from the middle", () => {
    expect([1, 3, 5].map((strength) => pointOnAxis("left", strength))).toEqual([
      { end: "low", at: 40 },
      { end: "low", at: 20 },
      { end: "low", at: 0 },
    ]);
    expect([1, 3, 5].map((strength) => pointOnAxis("right", strength).at)).toEqual([60, 80, 100]);
    expect(pointOnAxis("middle", 5)).toEqual({ end: "middle", at: 50 });
  });

  it("toClassReport: the axis' left and right ends become low and high; positions carry end and at, not side", () => {
    const report = toClassReport({
      students: [],
      unstated: [],
      axes: [
        {
          name: "n",
          left: "l",
          right: "r",
          positions: [{ id: "學生1", turns: [1], view: "v", side: "right", strength: 2 }],
          why: "w",
        },
      ],
      overview: ["o"],
    });
    expect(report.axes[0]).toEqual({
      name: "n",
      low: "l",
      high: "r",
      positions: [{ id: "學生1", turns: [1], view: "v", end: "high", at: 70 }],
      why: "w",
    });
  });
});

describe("student reports cite only lines the student said", () => {
  const stated = (turns: number[]): StudentAnalysis => ({
    stated: true,
    claim: { text: "c", turns },
    reasons: { text: "r", turns: [1] },
    tension: null,
  });

  it("citesSpokenLines: every cited line must be one the student said", () => {
    expect(citesSpokenLines(stated([1, 2]), 2)).toBe(true);
    expect(citesSpokenLines(stated([3]), 2)).toBe(false);
    expect(citesSpokenLines({ stated: false, doing: { text: "d", turns: [4] } }, 3)).toBe(false);
  });

  it("a report citing an unspoken line is refused and retried; the retried report is kept", async () => {
    const created = await classroomWithActivity(teacherCookie, "引用錯行班");
    const account = await registerStudent(created.code, "小錯");
    const participantId = await participantIdOf(created.activityId, account.cookie);
    await speak(`${created.activityId}:${participantId}`, account.cookie, "我會拉 FORCE-UNSPOKEN-TURN");

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.23" },
    });
    expect(finish.status).toBe(204);
    let report: Response | null = null;
    for (let i = 0; i < 180; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const body = (await report?.json()) as { students: Array<{ analysis: { claim: { turns: number[] } } | null }> };
    expect(body.students).toHaveLength(1);
    expect(body.students[0].analysis?.claim.turns).toEqual([1]);
  }, 120_000);
});

describe("thinking indicators (#255): a separate call from the student analysis", () => {
  const none = { level: 0 as const, turns: [], evidence: "" };
  const indicators = (s2: ThinkingIndicators["s2"]): ThinkingIndicators => ({
    c1: none,
    c2: none,
    s1: none,
    s2,
    a1: none,
    a2: none,
  });

  it("indicatorsCiteSpokenLines: levels 1-3 cite spoken lines, level 0 cites none", () => {
    expect(indicatorsCiteSpokenLines(indicators(none), 2)).toBe(true);
    expect(indicatorsCiteSpokenLines(indicators({ level: 3, turns: [2], evidence: "e" }), 2)).toBe(true);
    expect(indicatorsCiteSpokenLines(indicators({ level: 2, turns: [1, 2], evidence: "e" }), 2)).toBe(true);
    expect(indicatorsCiteSpokenLines(indicators({ level: 2, turns: [], evidence: "e" }), 2)).toBe(false);
    expect(indicatorsCiteSpokenLines(indicators({ level: 0, turns: [1], evidence: "" }), 2)).toBe(false);
    expect(indicatorsCiteSpokenLines(indicators({ level: 1, turns: [3], evidence: "e" }), 2)).toBe(false);
  });

  it("ThinkingIndicatorsSchema: levels 0-3 only, turns at least 1, all six indicators present", () => {
    expect(ThinkingIndicatorsSchema.safeParse(indicators({ level: 3, turns: [1], evidence: "e" })).success).toBe(true);
    for (const s2 of [
      { level: 4, turns: [1], evidence: "e" },
      { level: -1, turns: [], evidence: "" },
      { level: 1.5, turns: [1], evidence: "e" },
      { level: 1, turns: [0], evidence: "e" },
      { level: 1, turns: [1] },
    ]) {
      expect(ThinkingIndicatorsSchema.safeParse({ ...indicators(none), s2 }).success).toBe(false);
    }
    const { a2: _dropped, ...missing } = indicators(none);
    expect(ThinkingIndicatorsSchema.safeParse(missing).success).toBe(false);
  });

  it("bad indicators are retried; still bad after the retries → only indicators null, the analysis kept", async () => {
    const created = await classroomWithActivity(teacherCookie, "指標重試班");
    const ids: string[] = [];
    for (const [name, line] of [
      ["小重", "我會拉 FORCE-INDICATOR-RETRY"],
      ["小壞", "我會拉 FORCE-INDICATOR-FAILURE"],
    ] as const) {
      const account = await registerStudent(created.code, name);
      const participantId = await participantIdOf(created.activityId, account.cookie);
      ids.push(participantId);
      await speak(`${created.activityId}:${participantId}`, account.cookie, line);
    }
    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.24" },
    });
    expect(finish.status).toBe(204);
    let report: Response | null = null;
    for (let i = 0; i < 240; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const body = (await report?.json()) as {
      students: Array<{
        participantId: string;
        analysis: { stated: boolean } | null;
        indicators: { s2: { turns: number[] } } | null;
      }>;
    };
    const retried = must(
      body.students.find((s) => s.participantId === ids[0]),
      "retried student row",
    );
    const failed = must(
      body.students.find((s) => s.participantId === ids[1]),
      "failed student row",
    );
    expect(retried.indicators?.s2.turns).toEqual([1]);
    expect(retried.analysis?.stated).toBe(true);
    expect(failed.indicators).toBeNull();
    expect(failed.analysis?.stated).toBe(true);
  }, 150_000);

  it("the report carries indicators for every student with a conversation, teacher and student views alike", async () => {
    let report: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      report = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const body = (await report?.json()) as {
      students: Array<{ indicators: Record<string, { level: number }> | null }>;
    };
    for (const student of body.students) {
      expect(Object.keys(student.indicators ?? {}).sort(byCodeUnit)).toEqual(["a1", "a2", "c1", "c2", "s1", "s2"]);
    }
    const own = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[0].cookie } });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { indicators: unknown }).indicators).not.toBeNull();
  }, 60_000);

  it("a report stored before indicators existed reads back with indicators null, not report_failed", async () => {
    const created = await classroomWithActivity(teacherCookie, "舊報告班");
    await run(
      env.DB,
      `INSERT INTO reports (activity_id, status, teacher_report, student_reports, created_at, updated_at)
       VALUES ($id, 'ready', $teacher, $students, $at, $at)`,
      {
        id: created.activityId,
        teacher: JSON.stringify({ topicTitle: "t", classReport: null }),
        students: JSON.stringify({ p_old: { pseudonym: "學生1", analysis: null, violations: [], positions: [] } }),
        at: new Date().toISOString(),
      },
    );
    const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { students: Array<{ indicators: unknown }> };
    expect(body.students).toHaveLength(1);
    expect(body.students[0].indicators).toBeNull();
  });

  it("a student whose conversation came back empty gets indicators null", async () => {
    const created = await classroomWithActivity(teacherCookie, "空對話班");
    const result = await runInDurableObject(env.ReportRunner.getByName(created.activityId), async (runner) => {
      const internals = runner as unknown as {
        openHarness: ReportRunner["openHarness"];
        studentIndicators: ReportRunner["studentIndicators"];
      };
      const harness = await internals.openHarness(runner.indicatorsRegistry);
      return internals.studentIndicators(harness, { title: "t", statement: "s" }, "  ", 1, [], "zh");
    });
    expect(result).toBeNull();
  }, 120_000);

  it("only the indicators registry offers the indicators tool", async () => {
    const created = await classroomWithActivity(teacherCookie, "指標工具班");
    const names = await runInDurableObject(env.ReportRunner.getByName(created.activityId), async (runner) => ({
      main: runner.registry
        .snapshot()
        .tools()
        .map(({ tool }) => tool.name),
      indicators: runner.indicatorsRegistry
        .snapshot()
        .tools()
        .map(({ tool }) => tool.name),
    }));
    expect(names.main).not.toContain(SUBMIT_STUDENT_INDICATORS);
    expect(names.indicators).toContain(SUBMIT_STUDENT_INDICATORS);
    expect(names.indicators).not.toContain(SUBMIT_STUDENT_ANALYSIS);
  });
});

describe("class report with an axes plan passed in (#159)", () => {
  it("toPlannedClassReport: teacher's axes first as written; every axis lists every student once", () => {
    const plan = { count: 3, teacher: [{ name: "契約", left: "守約", right: "人情" }] };
    const roster = ["學生1", "學生2"];
    const at = (id: string, side: "left" | "middle" | "right", strength: number) => ({
      id,
      turns: [1],
      view: "v",
      side,
      strength,
    });
    const everyone = [at("學生1", "right", 2), at("學生2", "middle", 1)];
    const added = (name: string, positions = everyone) => ({
      name,
      left: "可比較",
      right: "不可比較",
      positions,
      why: "w",
    });
    const base = { students: [], unstated: [], overview: ["o"] };
    const planned = (teacher = everyone, addedAxes = [added("生命")]) => ({
      ...base,
      teacherAxes: [{ positions: teacher, why: "w" }],
      addedAxes,
    });
    const report = toPlannedClassReport(plan, roster, planned());
    expect(report.axes.map(({ name, low, high }) => [name, low, high])).toEqual([
      ["契約", "守約", "人情"],
      ["生命", "可比較", "不可比較"],
    ]);
    expect(report.axes[0].positions.map(({ id, end, at: point }) => [id, end, point])).toEqual([
      ["學生1", "high", 70],
      ["學生2", "middle", 50],
    ]);
    const fails = (submission: Parameters<typeof toPlannedClassReport>[2], code: string) =>
      expect(() => toPlannedClassReport(plan, roster, submission)).toThrow(code);
    fails(planned([at("學生1", "left", 1)]), "report_axis_roster_mismatch");
    fails(planned([...everyone, at("學生1", "left", 1)]), "report_axis_roster_mismatch");
    fails(planned([...everyone, at("學生9", "left", 1)]), "report_axis_roster_mismatch");
    fails(planned(everyone, [added("生命", [at("學生1", "left", 1)])]), "report_axis_roster_mismatch");
    fails(planned([{ ...at("學生1", "left", 1), id: "學生1\n學生2" }]), "report_axis_roster_mismatch");
    fails({ ...base, teacherAxes: [], addedAxes: [] }, "report_teacher_axes_mismatch");
    fails(
      { ...planned(), teacherAxes: [...planned().teacherAxes, { positions: everyone, why: "w" }] },
      "report_teacher_axes_mismatch",
    );
    fails(planned(everyone, [added("a"), added("b"), added("c")]), "report_axes_over_count");
    expect(PlannedClassReportSubmissionSchema.safeParse(planned([], [])).success).toBe(false);
  });

  it("the planned tool asks for the axes before the overview, as the prompt orders", () => {
    expect(Object.keys(z.toJSONSchema(PlannedClassReportSubmissionSchema).properties ?? {})).toEqual([
      "students",
      "unstated",
      "teacherAxes",
      "addedAxes",
      "overview",
    ]);
  });

  it("ReportAxesPlanSchema: count 1-3, teacher axes no more than the count", () => {
    const axis = { name: "契約", left: "守約", right: "人情" };
    expect(ReportAxesPlanSchema.safeParse({ count: 2, teacher: [axis] }).success).toBe(true);
    for (const plan of [
      { count: 0, teacher: [] },
      { count: 4, teacher: [] },
      { count: 1, teacher: [axis, { ...axis, name: "其他" }] },
    ]) {
      expect(ReportAxesPlanSchema.safeParse(plan).success).toBe(false);
    }
  });

  it("the existing report runs never see the axes tool; only the axes registry offers it", async () => {
    const created = await classroomWithActivity(teacherCookie, "工具清單班");
    const names = await runInDurableObject(env.ReportRunner.getByName(created.activityId), async (runner) => ({
      main: runner.registry
        .snapshot()
        .tools()
        .map(({ tool }) => tool.name),
      axes: runner.axesRegistry
        .snapshot()
        .tools()
        .map(({ tool }) => tool.name),
    }));
    expect(names.main).not.toContain(SUBMIT_CLASS_AXES_REPORT);
    expect(names.main).toEqual(expect.arrayContaining([SUBMIT_STUDENT_ANALYSIS, SUBMIT_CLASS_REPORT]));
    expect(names.axes).toContain(SUBMIT_CLASS_AXES_REPORT);
    expect(names.axes).not.toContain(SUBMIT_CLASS_REPORT);
  });

  it("an axes plan passed in: the report has the teacher's axes first, then the added ones up to the count", async () => {
    const created = await classroomWithActivity(teacherCookie, "老師軸班");
    const account = await registerStudent(created.code, "小軸");
    const participantId = await participantIdOf(created.activityId, account.cookie);
    await speak(`${created.activityId}:${participantId}`, account.cookie, "我會守約");
    await run(env.DB, "UPDATE activities SET finished_at = $at WHERE id = $id", {
      id: created.activityId,
      at: new Date().toISOString(),
    });
    await env.ReportRunner.getByName(created.activityId).startReport({
      activityId: created.activityId,
      axes: { count: 2, teacher: [{ name: "契約與承諾", left: "契約至上", right: "人情優先" }] },
    });
    let report: Response | null = null;
    for (let i = 0; i < 120; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const body = (await report?.json()) as {
      classReport: { axes: Array<{ name: string; low: string; high: string; positions: unknown[] }> };
    };
    expect(body.classReport.axes).toHaveLength(2);
    expect(body.classReport.axes[0]).toMatchObject({ name: "契約與承諾", low: "契約至上", high: "人情優先" });
    for (const axis of body.classReport.axes) expect(axis.positions).toHaveLength(1);
  }, 90_000);
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
