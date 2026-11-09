import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import worker from "../src/index";
import { seedDemo } from "../src/seed";
import type { ServerMessage } from "../src/ws/protocol";

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    env,
    { waitUntil: () => {} },
  );
}

function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
}

async function frames(socket: WebSocket) {
  const list: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    list.push(JSON.parse(event.data) as ServerMessage);
    for (const waiter of waiters.splice(0)) waiter();
  });
  return {
    list,
    until: async (check: (frames: ServerMessage[]) => boolean) => {
      for (let i = 0; i < 500 && !check(list); i++) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      expect(check(list)).toBe(true);
    },
  };
}

async function speak(thread: string, cookie: string, question: string): Promise<void> {
  const socket = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(socket?.status).toBe(101);
  const ws = socket!.webSocket as WebSocket;
  ws.accept();
  const rx = await frames(ws);
  await rx.until((f) => f.some((m) => m.type === "hello"));
  ws.send(JSON.stringify({ type: "watch" }));
  await rx.until((f) => f.some((m) => m.type === "view"));
  ws.send(JSON.stringify({ type: "submit", id: "s1", input: question }));
  await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
  await rx.until((f) => JSON.stringify(f).includes("直覺判斷"));
  ws.close();
}

let teacherCookie: string;
let classroomCode: string;
let activityId: string;
const students: Array<{ cookie: string; userId: string }> = [];

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacherCookie = cookieOf(login);
  const topics = (await (await call("/api/topics", { headers: { Cookie: teacherCookie } })).json()) as Array<{
    id: string;
  }>;
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacherCookie },
      body: JSON.stringify({ name: "報告班", topicId: topics[0]!.id }),
    })
  ).json()) as { code: string; activityId: string };
  classroomCode = created.code;
  activityId = created.activityId;

  for (const name of ["小明", "阿華"]) {
    const res = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: classroomCode, name, tosAccepted: true }),
    });
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    students.push({ cookie: cookieOf(res), userId: user.id });
  }

  await speak(`${activityId}:${students[0]!.userId}`, students[0]!.cookie, "我覺得契約應該被遵守");
  await speak(`${activityId}:${students[1]!.userId}`, students[1]!.cookie, "幫我寫一個 python 排序");

  const finish = await call(`/api/activities/${activityId}/finish`, {
    method: "POST",
    headers: { Cookie: teacherCookie },
  });
  expect(finish.status).toBe(204);
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
        studentId: string;
        pseudonym: string;
        analysis: { stated: boolean } | null;
        violations: Array<{ turn: number; type: string; excerpt: string }>;
      }>;
    };
    expect(teacherReport.classReport.axes.length).toBeGreaterThan(0);
    expect(teacherReport.students).toHaveLength(2);
    expect(teacherReport.students.map((s) => s.pseudonym).every((p) => p.startsWith("學生"))).toBe(true);

    const speaker = teacherReport.students.find((s) => s.studentId === students[0]!.userId)!;
    expect(speaker.analysis?.stated).toBe(true);
    expect(speaker.violations).toHaveLength(0);

    const coder = teacherReport.students.find((s) => s.studentId === students[1]!.userId)!;
    expect(coder.violations.length).toBeGreaterThan(0);
    expect(coder.violations[0]!.type).toBe("coding");

    const own = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: students[0]!.cookie } });
    expect(own.status).toBe(200);
    const studentReport = (await own.json()) as {
      topicTitle: string;
      pseudonym: string;
      analysis: { stated: boolean } | null;
      violations: unknown[];
    };
    expect(studentReport.pseudonym).toBe(speaker.pseudonym);
    expect(studentReport.analysis?.stated).toBe(true);
    expect("classReport" in studentReport).toBe(false);
  }, 60_000);

  it("class-report failure with student analyses stored → partial per §7 (200, classReport null, positions empty)", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacherCookie } })).json()) as Array<{
      id: string;
    }>;
    const created = (await (
      await call("/api/classrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacherCookie },
        body: JSON.stringify({ name: "partial 班", topicId: topics[0]!.id }),
      })
    ).json()) as { code: string; activityId: string };
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "小標", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const { user } = (await joined.json()) as { user: { id: string } };
    const studentCookie = cookieOf(joined);

    await speak(`${created.activityId}:${user.id}`, studentCookie, "FORCE-CLASS-REPORT-FAILURE");

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie },
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
