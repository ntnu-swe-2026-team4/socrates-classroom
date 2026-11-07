import { beforeAll, describe, expect, test } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { run } from "../src/db/d1";
import { seedDemo } from "../src/seed";
import migrationSql from "../migrations/001_init.sql";
import soloMigrationSql from "../migrations/002_solo.sql";

const ctx = createExecutionContext();

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`http://worker.test${path}`, init), env, ctx);
}

function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
}

async function loginTeacher(): Promise<string> {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  return cookieOf(res);
}

async function joinGuest(code: string, name: string): Promise<{ cookie: string; activityId: string }> {
  const res = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, tosAccepted: true }),
  });
  return { cookie: cookieOf(res), activityId: ((await res.json()) as { activityId: string }).activityId };
}

interface Fixture {
  teacher: string;
  activityId: string;
  classroomId: string;
  code: string;
  student: string;
  studentId: string;
  outsider: string;
}

let fx: Fixture;

beforeAll(async () => {
  for (const statement of `${migrationSql};${soloMigrationSql}`.split(";")) {
    if (statement.trim()) await run(env.DB, statement.trim());
  }
  await seedDemo(env.DB);
  const teacher = await loginTeacher();
  const topics = await (await call("/api/topics", { headers: { Cookie: teacher } })).json();
  const first = (topics as Array<{ id: string }>)[0]!.id;
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ name: "E2E 班", topicId: first }),
    })
  ).json()) as { code: string; activityId: string; classroomId: string };
  const student = await joinGuest(created.code, "E2E生");
  const second = await joinGuest(created.code, "E2E生二");
  const outsiderClassroom = await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ name: "外部班", topicId: first }),
    })
  ).json();
  const outsider = await joinGuest((outsiderClassroom as { code: string }).code, "局外人");
  fx = {
    teacher,
    activityId: created.activityId,
    classroomId: created.classroomId,
    code: created.code,
    student: student.cookie,
    studentId: "",
    outsider: outsider.cookie,
  };
  void second;
  const me = await (await call("/api/me", { headers: { Cookie: student.cookie } })).json();
  fx.studentId = (me as { id: string }).id;
});

describe("黃金流程（Worker 入口）", () => {
  test("health／seed guard", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/api/dev/seed", { method: "POST" })).status).toBe(404);
    const granted = await call("/api/dev/seed", {
      method: "POST",
      headers: { "x-seed-token": "dev-seed-token" },
    });
    expect(granted.status).toBe(200);
  });

  test("login→classroom→join→SSE 對話→finish→report 全通", async () => {
    const dialogue = await call(`/api/activities/${fx.activityId}/dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ text: "我認為結果比原則重要。" }),
    });
    expect(dialogue.status).toBe(200);
    const reader = dialogue.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let deltas = 0;
    while (!body.includes("event: done")) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
      deltas = body.split("event: delta").length - 1;
    }
    await reader.cancel().catch(() => {});
    expect(deltas).toBeGreaterThanOrEqual(1);
    expect(body).toContain("event: done");

    await call(`/api/activities/${fx.activityId}/finish`, { method: "POST", headers: { Cookie: fx.teacher } });
    await env.ReportJob.getByName(fx.activityId).advance();
    const report = await call(`/api/activities/${fx.activityId}/report`, { headers: { Cookie: fx.student } });
    expect(report.status).toBe(200);
    const payload = (await report.json()) as { individual: { pseudonym: string } };
    expect(payload.individual.pseudonym).toMatch(/^學生/);
  });
});

describe("授權矩陣（§1.1）", () => {
  const matrix: Array<{ path: string; init: RequestInit; expect: Array<[string, number]> }> = [
    {
      path: "/api/topics",
      init: {},
      expect: [
        ["guest", 401],
        ["student", 403],
        ["outsider", 403],
        ["teacher", 200],
      ],
    },
    {
      path: "/api/classrooms",
      init: { method: "POST", body: JSON.stringify({ name: "x", topicId: "t" }) },
      expect: [
        ["guest", 401],
        ["student", 403],
        ["teacher", 404],
      ],
    },
    {
      path: `/api/activities/${"{{aid}}"}/dialogue`,
      init: { method: "POST", body: JSON.stringify({ text: "hi" }) },
      expect: [
        ["guest", 401],
        ["teacher", 403],
        ["outsider", 403],
      ],
    },
    {
      path: `/api/activities/${"{{aid}}"}/live`,
      init: {},
      expect: [
        ["guest", 401],
        ["student", 403],
        ["outsider", 403],
        ["teacher", 200],
      ],
    },
    {
      path: `/api/activities/${"{{aid}}"}/finish`,
      init: { method: "POST" },
      expect: [
        ["guest", 401],
        ["student", 403],
        ["outsider", 403],
      ],
    },
    {
      path: `/api/activities/${"{{aid}}"}/dialogue?studentId={{sid}}`,
      init: {},
      expect: [
        ["guest", 401],
        ["student", 200],
        ["teacher", 200],
        ["outsider", 403],
      ],
    },
  ];
  const cookies: Record<string, string> = {};

  test("全矩陣狀態碼", async () => {
    cookies.guest = "";
    cookies.student = fx.student;
    cookies.teacher = fx.teacher;
    cookies.outsider = fx.outsider;
    for (const row of matrix) {
      for (const [role, expected] of row.expect) {
        const path = row.path.replace("{{aid}}", fx.activityId).replace("{{sid}}", fx.studentId);
        const res = await call(path, {
          ...row.init,
          headers: { Cookie: cookies[role]!, "Content-Type": "application/json" },
        });
        const actual = res.status;
        expect(`${row.path} as ${role} → ${actual} (want ${expected})`).toBe(
          `${row.path} as ${role} → ${expected} (want ${expected})`,
        );
      }
    }
  });
});

describe("併發（10k 路徑）", () => {
  let liveAid = "";
  let studentB = "";

  test("併發前置：重開新活動＋第二位學生", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: fx.teacher } })).json()) as Array<{
      id: string;
    }>;
    const reopened = await call(`/api/classrooms/${fx.classroomId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.teacher },
      body: JSON.stringify({ name: "E2E 班", topicId: topics[0]!.id }),
    });
    expect(reopened.status).toBe(201);
    liveAid = ((await reopened.json()) as { activityId: string }).activityId;
    const second = await joinGuest(fx.code, "E2E生C");
    studentB = second.cookie;
    expect(liveAid).not.toBe(fx.activityId);
  });
  test("同名 join 併發：恰好一個 200、一個 409 name_taken", async () => {
    const results = await Promise.all([
      call("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fx.code, name: "賽跑生", tosAccepted: true }),
      }),
      call("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fx.code, name: "賽跑生", tosAccepted: true }),
      }),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((res) => res.status === 409)!;
    expect(((await loser.json()) as { code: string }).code).toBe("name_taken");
  });

  test("同 thread 對話併發：第二發 409 already_streaming", async () => {
    const [a, b] = await Promise.all([
      call(`/api/activities/${liveAid}/dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: fx.student },
        body: JSON.stringify({ text: "第一發…" }),
      }),
      call(`/api/activities/${liveAid}/dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: fx.student },
        body: JSON.stringify({ text: "第二發。" }),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = [a, b].find((res) => res.status === 409)!;
    expect(((await loser.json()) as { code: string }).code).toBe("already_streaming");
  });

  test("回應完成後立刻追問：200（busy 已釋放，不誤擋）", async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const res = await call(`/api/activities/${liveAid}/dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ text: "追問一句。" }),
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (!body.includes("event: done")) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    expect(body).toContain("event: done");
  });

  test("不同 thread 併發：兩位學生兩個 DO，皆 200", async () => {
    const [a, b] = await Promise.all([
      call(`/api/activities/${liveAid}/dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: fx.student },
        body: JSON.stringify({ text: "A thread。" }),
      }),
      call(`/api/activities/${liveAid}/dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: studentB },
        body: JSON.stringify({ text: "B thread。" }),
      }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  test("Coordinator burst：limit 4 下 10 發 acquire＝4 granted", async () => {
    const stub = env.Coordinator.getByName("burst-provider");
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => stub.lease("burst-provider", "t", { concurrency: 4 })),
    );
    expect(outcomes.filter((o) => o === "granted")).toHaveLength(4);
    expect(outcomes.filter((o) => o === "busy")).toHaveLength(6);
  });

  test("breaker：連續 5 error 後 open", async () => {
    const stub = env.Coordinator.getByName("breaker-e2e");
    for (let i = 0; i < 5; i += 1) {
      await stub.lease("breaker-e2e", "t");
      await stub.settle("breaker-e2e", "error");
    }
    expect(await stub.lease("breaker-e2e", "t")).toBe("open");
  });
});

describe("ActivityEvents 重播（Last-Event-ID）", () => {
  test("ring buffer：sinceId 之後的事件才補播", async () => {
    const stub = env.ActivityEvents.getByName(fx.activityId);
    const before = await stub.currentSeq();
    await stub.publishViolation({ studentId: "sx", turn: 9, type: "math", excerpt: "2+2=5？" });
    const after = await stub.currentSeq();
    expect(after).toBeGreaterThan(before);

    async function readUntil(since: number, marker: string): Promise<string> {
      const res = await stub.stream(since);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let body = "";
      while (!body.includes(marker)) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
      return body;
    }

    const replayNone = await readUntil(after, "event: live");
    expect(replayNone).not.toContain("2+2=5？");
    const replayAll = await readUntil(before, "2+2=5？");
    expect(replayAll).toContain("2+2=5？");
  });
});

describe("冪等與邊界", () => {
  test("重複 finish＝204 且報告不重置", async () => {
    await env.ReportJob.getByName(fx.activityId).advance();
    const again = await call(`/api/activities/${fx.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: fx.teacher },
    });
    expect(again.status).toBe(204);
    const report = await call(`/api/activities/${fx.activityId}/report`, { headers: { Cookie: fx.teacher } });
    expect(report.status).toBe(200);
  });

  test("輸入邊界：text>2000／name>80／term>30 → 422 validation", async () => {
    const longText = await call(`/api/activities/${fx.activityId}/dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ text: "a".repeat(2001) }),
    });
    expect(longText.status).toBe(422);
    const longName = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: fx.code, name: "n".repeat(81), tosAccepted: true }),
    });
    expect(longName.status).toBe(422);
    const longTerm = await call("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ term: "t".repeat(31) }),
    });
    expect(longTerm.status).toBe(422);
  });

  test("byok PUT 冪等（重複 put 同 last4）＋非法 provider 422", async () => {
    const put = await call("/api/settings/byok", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-v1-abcdefgh" }),
    });
    expect(put.status).toBe(200);
    const again = await call("/api/settings/byok", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-v1-abcdefgh" }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { last4: string }).last4).toBe("efgh");
    const bad = await call("/api/settings/byok", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: fx.student },
      body: JSON.stringify({ provider: "evil", key: "sk-or-v1-abcdefgh" }),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("byok_provider_invalid");
  });
});
