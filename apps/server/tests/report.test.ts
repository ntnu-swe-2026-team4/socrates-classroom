import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { placeOnAxes, placeOnModelAxes, pointOnAxis, reportAlarmPlan } from "../src/do/report-runner";
import { call, classroomWithActivity, cookieOf, participantIdOf, registerStudent, speak } from "./helpers";

let teacherCookie: string;
let classroomCode: string;
let activityId: string;
const students: Array<{ cookie: string; participantId: string }> = [];
let topicAxes: string[] = [];

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
  // the class report's axes are the activity topic's: read them to compare
  const topicRow = await env.DB.prepare(
    "SELECT t.axes FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = ?",
  )
    .bind(created.activityId)
    .first<{ axes: string }>();
  topicAxes = (JSON.parse(topicRow?.axes ?? "[]") as Array<{ name: string }>).map((axis) => axis.name);
  classroomCode = created.code;
  activityId = created.activityId;

  for (const name of ["小明", "阿華", "小靜", "小華"]) {
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
  // 小靜 (students[2]) never speaks; 小華 states the other side
  await speak(`${activityId}:${students[3]!.participantId}`, students[3]!.cookie, "我覺得承諾比契約更重要");

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

describe("placeOnAxes", () => {
  const analysis = (turns: number[]) => ({
    stated: true as const,
    claim: { text: "c", turns },
    reasons: { text: "r", turns },
    tension: null,
  });
  const stated = [
    { id: "學生1", analysis: analysis([1, 2]) },
    { id: "學生3", analysis: analysis([4]) },
  ];
  const teacherAxes = [
    { name: "甲", left: "甲左", right: "甲右" },
    { name: "乙", left: "乙左", right: "乙右" },
  ];
  const sides = { low: "left", middle: "middle", high: "right" } as const;
  const position = (id: string, end: "low" | "middle" | "high", turns: number[]) => ({
    id,
    turns,
    view: "v",
    side: sides[end],
    strength: end === "middle" ? 1 : 4,
  });

  it("the end and point on the axis come from the side and how firmly: firm left is near 0, firm right near 100", () => {
    expect([1, 3, 5].map((strength) => pointOnAxis("left", strength))).toEqual([
      { end: "low", at: 40 },
      { end: "low", at: 20 },
      { end: "low", at: 0 },
    ]);
    expect([1, 3, 5].map((strength) => pointOnAxis("right", strength).at)).toEqual([60, 80, 100]);
    expect(pointOnAxis("middle", 5)).toEqual({ end: "middle", at: 50 });
    const placed = placeOnAxes(
      teacherAxes,
      {
        axes: [{ axis: 1, positions: [position("學生1", "low", [1]), position("學生3", "high", [4])] }],
        overview: ["o"],
      },
      stated,
      "學生",
    );
    expect(placed.axes[0]!.positions.map((p) => [p.end, p.at])).toEqual([
      ["low", 10],
      ["high", 90],
    ]);
    expect(placed.axes[0]!.positions[0]).not.toHaveProperty("strength");
    expect(placed.axes[0]!.positions[0]).not.toHaveProperty("side");
  });

  it("the axes are the teacher's, in order, whatever the model sends; an axis nobody spoke to stays with no positions", () => {
    const placed = placeOnAxes(
      teacherAxes,
      { axes: [{ axis: 2, positions: [position("學生1", "low", [1])] }], overview: ["o"] },
      stated,
      "學生",
    );
    expect(placed.axes.map(({ name, low, high }) => ({ name, low, high }))).toEqual([
      { name: "甲", low: "甲左", high: "甲右" },
      { name: "乙", low: "乙左", high: "乙右" },
    ]);
    expect(placed.axes[0]!.positions).toEqual([]);
    expect(placed.axes[1]!.positions.map((p) => p.id)).toEqual(["學生1"]);
    expect(placed.overview).toEqual(["o"]);
  });

  it("maps an ID with spaces, without the prefix, or with a rewritten prefix to that student, and keeps only cited lines", () => {
    const placed = placeOnAxes(
      teacherAxes,
      {
        axes: [
          { axis: 1, positions: [position(" 學生1 ", "low", [2, 7]), position("3", "high", [4])] },
          // glm-4.7-flash wrote 学生 in simplified characters
          { axis: 2, positions: [position("学生1", "low", [1]), position("Student 3", "high", [4])] },
        ],
        overview: ["o"],
      },
      stated,
      "學生",
    );
    for (const axis of placed.axes) expect(axis.positions.map((p) => p.id)).toEqual(["學生1", "學生3"]);
    expect(placed.axes[0]!.positions.map((p) => p.turns)).toEqual([[2], [4]]);
  });

  it("drops positions for unstated students, uncited lines, a second one for the same student, and unknown axes", () => {
    const placed = placeOnAxes(
      teacherAxes,
      {
        axes: [
          // 學生2 did not state; line 9 is not in 學生3's report
          {
            axis: 1,
            positions: [position("學生1", "low", [1]), position("學生2", "high", [1]), position("學生3", "high", [9])],
          },
          { axis: 2, positions: [position("學生1", "middle", [1]), position("1", "low", [1])] },
          { axis: 2, positions: [position("學生3", "high", [4])] }, // the same axis sent twice: merged
          { axis: 3, positions: [position("學生3", "high", [4])] }, // the topic has two axes
        ],
        overview: ["o"],
      },
      stated,
      "學生",
    );
    expect(placed.axes).toHaveLength(2);
    expect(placed.axes[0]!.positions.map((p) => p.id)).toEqual(["學生1"]);
    expect(placed.axes[1]!.positions.map((p) => [p.id, p.end])).toEqual([
      ["學生1", "middle"],
      ["學生3", "high"],
    ]);
  });
});

describe("placeOnModelAxes (report.axes = ai: the model sets the axes)", () => {
  const stated = [
    {
      id: "學生1",
      analysis: {
        stated: true as const,
        claim: { text: "c", turns: [1, 2] },
        reasons: { text: "r", turns: [2] },
        tension: null,
      },
    },
    {
      id: "學生3",
      analysis: {
        stated: true as const,
        claim: { text: "c", turns: [4] },
        reasons: { text: "r", turns: [4] },
        tension: null,
      },
    },
  ];
  const position = (id: string, side: "left" | "middle" | "right", turns: number[]) => ({
    id,
    turns,
    view: "v",
    side,
    strength: side === "middle" ? 1 : 4,
  });
  const axis = (name: string, positions: ReturnType<typeof position>[]) => ({
    name,
    left: `${name}左`,
    right: `${name}右`,
    why: `${name}的理由`,
    positions,
  });

  it("keeps the model's axes in order (left end = low, right end = high, with why) and drops one that places no one", () => {
    const placed = placeOnModelAxes(
      { axes: [axis("甲", []), axis("乙", [position("學生1", "left", [1])])], overview: ["o"] },
      stated,
      "學生",
    );
    expect(placed.axes).toEqual([
      {
        name: "乙",
        low: "乙左",
        high: "乙右",
        why: "乙的理由",
        positions: [{ id: "學生1", turns: [1], view: "v", end: "low", at: 10 }],
      },
    ]);
    expect(placed.overview).toEqual(["o"]);
  });

  it("drops unstated students, uncited lines, a second position for a student, and a repeated axis name", () => {
    const placed = placeOnModelAxes(
      {
        axes: [
          // 學生2 did not state; line 9 is not in 學生3's report
          axis("甲", [
            position("學生1", "left", [1]),
            position("學生2", "right", [1]),
            position("學生3", "right", [9]),
          ]),
          axis("乙", [position("學生1", "middle", [1]), position("1", "left", [1]), position("學生3", "right", [4])]),
          axis("乙", [position("學生3", "left", [4])]),
          axis("丙", [position("學生2", "right", [1])]),
        ],
        overview: ["o"],
      },
      stated,
      "學生",
    );
    expect(placed.axes.map((a) => a.name)).toEqual(["甲", "乙"]);
    expect(placed.axes[0]!.positions.map((p) => p.id)).toEqual(["學生1"]);
    expect(placed.axes[1]!.positions.map((p) => [p.id, p.end])).toEqual([
      ["學生1", "middle"],
      ["學生3", "high"],
    ]);
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
      classReport: {
        axes: Array<{ name: string; positions: Array<{ id: string }> }>;
        overview: string[];
        students: Array<{ id: string; summary: Array<{ step: string; turns: number[] }> }>;
        unstated: string[];
      };
      students: Array<{
        participantId: string;
        participantName: string;
        pseudonym: string;
        analysis: { stated: boolean } | null;
        violations: Array<{ turn: number; type: string; excerpt: string }>;
        positions: Array<{ axis: string; at: number; end: string }>;
      }>;
    };
    // the class report's axes are the topic's, not the model's (the faux model also sends an axis 9: dropped)
    expect(topicAxes.length).toBeGreaterThan(0);
    expect(teacherReport.classReport.axes.map((axis) => axis.name)).toEqual(topicAxes);
    expect(teacherReport.students).toHaveLength(3);
    expect(teacherReport.students.map((s) => s.participantName).sort()).toEqual(["小明", "阿華", "小華"].sort());
    expect(teacherReport.students.map((s) => s.pseudonym).every((p) => p.startsWith("學生"))).toBe(true);
    const speaker0 = teacherReport.students.find((s) => s.participantId === students[0]!.participantId)!;
    expect(speaker0.positions[0]).toMatchObject({ axis: topicAxes[0], end: "middle", at: 50 });

    // The class report agrees with the student reports on who stated a position: its students and unstated are
    // copied from the analyses, and every position belongs to a student whose analysis is stated.
    const statedIds = teacherReport.students.filter((s) => s.analysis?.stated).map((s) => s.pseudonym);
    expect(teacherReport.classReport.students.map((s) => s.id).sort()).toEqual([...statedIds].sort());
    expect(teacherReport.classReport.students.find((s) => s.id === speaker0.pseudonym)!.summary[0]).toEqual({
      step: "契約應該被遵守",
      turns: [1],
    });
    expect(teacherReport.classReport.unstated).toEqual(
      teacherReport.students.filter((s) => s.analysis?.stated === false).map((s) => s.pseudonym),
    );
    // the coder only asked for other work: stated=false in their own report, so unstated in the class report
    const coderPseudonym = teacherReport.students.find(
      (s) => s.participantId === students[1]!.participantId,
    )!.pseudonym;
    expect(teacherReport.classReport.unstated).toEqual([coderPseudonym]);
    expect(teacherReport.classReport.students.map((s) => s.id)).not.toContain(coderPseudonym);
    for (const axis of teacherReport.classReport.axes) {
      for (const position of axis.positions) expect(statedIds).toContain(position.id);
    }
    // Two students stated (the coder did not), so the faux class model places two different students and writes the
    // second one's ID without the pseudonym prefix: it is mapped back to that student, not dropped or merged.
    expect(statedIds).toHaveLength(2);
    expect(teacherReport.classReport.axes[0]!.positions.map((p) => p.id).sort()).toEqual([...statedIds].sort());

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
          axes: [{ name: "契約的界線", left: "契約優先", right: "人情優先" }],
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
    for (let i = 0; i < 180; i += 1) {
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
  }, 120_000);

  it("an activity keeps the axes setting it started with: started with ai, reported with the model's axes after a switch back", async () => {
    await run(
      env.DB,
      "INSERT INTO settings (key, value, updated_at) VALUES ('report_axes', 'ai', '2026-11-19') ON CONFLICT(key) DO UPDATE SET value = 'ai'",
    );
    let created: Awaited<ReturnType<typeof classroomWithActivity>>;
    try {
      created = await classroomWithActivity(teacherCookie, "AI 軸班");
    } finally {
      await run(env.DB, "DELETE FROM settings WHERE key = 'report_axes'"); // back to teacher before the report runs
    }
    const account = await registerStudent(created.code, "小艾");
    const participantId = await participantIdOf(created.activityId, account.cookie);
    await speak(`${created.activityId}:${participantId}`, account.cookie, "契約應該被遵守");

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.25" },
    });
    expect(finish.status).toBe(204);
    let report: Response | null = null;
    for (let i = 0; i < 180; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const ready = (await report?.json()) as {
      classReport: { axes: Array<{ name: string; why?: string; positions: unknown[] }> } | null;
    };
    // the faux model's own axis, with why: not the topic's axes
    expect(ready.classReport!.axes.map(({ name, why }) => ({ name, why }))).toEqual([{ name: "契約", why: "分歧" }]);
    expect(ready.classReport!.axes[0]!.positions).toHaveLength(1);
  }, 120_000);

  it("class report that fails its first attempt is tried again → ready with a class report", async () => {
    const created = await classroomWithActivity(teacherCookie, "重試一次班");
    const account = await registerStudent(created.code, "小試");
    const participantId = await participantIdOf(created.activityId, account.cookie);

    await speak(`${created.activityId}:${participantId}`, account.cookie, "FORCE-CLASS-REPORT-FLAKY");

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.24" },
    });
    expect(finish.status).toBe(204);

    let report: Response | null = null;
    for (let i = 0; i < 180; i += 1) {
      report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
      if (report.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(report?.status).toBe(200);
    const ready = (await report?.json()) as { classReport: { students: unknown[] } | null };
    expect(ready.classReport).not.toBeNull();
    expect(ready.classReport!.students).toHaveLength(1);
  }, 120_000);

  it("a student who spoke but whose report cites unspoken lines on every attempt → no analysis, and the class report never claims nobody stated", async () => {
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
    const partial = (await report?.json()) as {
      classReport: unknown;
      students: Array<{ analysis: unknown }>;
    };
    expect(partial.classReport).toBeNull();
    expect(partial.students).toHaveLength(1);
    expect(partial.students[0]!.analysis).toBeNull();
  }, 120_000);
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
