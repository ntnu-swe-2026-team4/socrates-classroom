import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test, vi } from "vitest";
import worker from "../src/index";
import { seedDemo } from "../src/seed";
import { applyMigrations } from "./migrations";

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

let teacher: string;
let code: string;
let activityId: string;

beforeAll(async () => {
  await applyMigrations(env.DB);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacher = cookieOf(login);

  const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{ id: string }>;
  expect(topics.length).toBeGreaterThan(0);
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ name: "R6 班", topicId: topics[0]!.id }),
    })
  ).json()) as { code: string; activityId: string; classroomId: string };
  code = created.code;
  activityId = created.activityId;
});

describe("R6 REST 層（Hono，真 Worker 入口）", () => {
  test("health／seed guard", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/api/dev/seed", { method: "POST" })).status).toBe(404);
  });

  test("me／guest join（ToS）→ activity 解析", async () => {
    const me = await call("/api/me", { headers: { Cookie: teacher } });
    expect(((await me.json()) as { role: string }).role).toBe("teacher");

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const { user, activityId: aid } = (await joined.json()) as { user: { role: string }; activityId: string };
    expect(user.role).toBe("student");
    expect(aid).toBe(activityId);

    const noTos = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生B", tosAccepted: false }),
    });
    expect(noTos.status).toBe(422);
    expect(((await noTos.json()) as { code: string }).code).toBe("tos_required");
  });

  test("GET /classrooms——角色視角列表；code/url 只給老師", async () => {
    const unauthorized = await call("/api/classrooms");
    expect(unauthorized.status).toBe(401);

    const teacherList = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      role: string;
      code: string | null;
      current: { activityId: string } | null;
    }>;
    const own = teacherList.find((entry) => entry.current?.activityId === activityId);
    expect(own).toBeDefined();
    expect(own!.role).toBe("teacher");
    expect(own!.code).not.toBeNull();

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生C", tosAccepted: true }),
    });
    const student = cookieOf(joined);
    const studentList = (await (await call("/api/classrooms", { headers: { Cookie: student } })).json()) as Array<{
      role: string;
      code: string | null;
      teacherName: string;
      memberCount: number;
      current: { activityId: string } | null;
    }>;
    const member = studentList.find((entry) => entry.current?.activityId === activityId);
    expect(member).toBeDefined();
    expect(member!.role).toBe("student");
    expect(member!.code).toBeNull();
    expect(member!.teacherName).toBeTruthy();
    expect(member!.memberCount).toBeGreaterThan(0);
  });

  test("startActivity——重開活動（{topicId} 契約 shape；同 code 新 activityId）", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const restarted = await call("/api/classrooms/c_missing/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: topics[0]!.id }),
    });
    expect(restarted.status).toBe(404);

    const classrooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: { activityId: string } | null;
    }>;
    const own = classrooms.find((entry) => entry.current?.activityId === activityId);
    const res = await call(`/api/classrooms/${own!.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: topics[0]!.id }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { activityId: string; code: string };
    expect(payload.activityId).not.toBe(activityId);
    expect(payload.code).toBe(code);
  });

  test("finish→report 語意（pending → 404 report_pending；學生 IDOR 只見自己）", async () => {
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生報", tosAccepted: true }),
    });
    const student = cookieOf(joined);

    const report0 = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacher } });
    expect(report0.status).toBe(404);
    expect(((await report0.json()) as { code: string }).code).toBe("report_pending");

    const finish = await call(`/api/activities/${activityId}/finish`, { method: "POST", headers: { Cookie: teacher } });
    expect(finish.status).toBe(204);
    const again = await call(`/api/activities/${activityId}/finish`, { method: "POST", headers: { Cookie: teacher } });
    expect(again.status).toBe(204);

    await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
      },
      { timeout: 30_000 },
    );

    const mine = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: student } });
    expect(mine.status).toBe(200);
    const mineData = (await mine.json()) as Record<string, unknown>;
    expect("students" in mineData).toBe(false);
    expect("classReport" in mineData).toBe(false);
    expect(typeof mineData.pseudonym).toBe("string");
  }, 60_000);

  test("授權矩陣抽檢：outsider 403／teacher-only 403", async () => {
    const outsiderLogin = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@socrates.tw", password: "wrong-password" }),
    });
    expect(outsiderLogin.status).toBe(401);

    const topics = await call("/api/topics");
    expect(topics.status).toBe(401);

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生D", tosAccepted: true }),
    });
    const student = cookieOf(joined);
    const finish = await call(`/api/activities/${activityId}/finish`, { method: "POST", headers: { Cookie: student } });
    expect(finish.status).toBe(403);
  });

  test("teacher keys CRUD：PUT 冪等、order、只回 last4、teacher-only", async () => {
    const put = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "openrouter", model: "z-ai/glm-5.3-flash", key: "sk-or-v1-abcdefgh" }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { last4: string }).last4).toBe("efgh");

    const again = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "openrouter", model: "z-ai/glm-5.3-flash", key: "sk-or-v1-zzzzzzzz" }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { last4: string }).last4).toBe("zzzz");

    const list = (await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json()) as Array<{
      provider: string;
      model: string;
      last4: string;
    }>;
    expect(list).toEqual([
      {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        last4: "zzzz",
        sortOrder: 0,
        updatedAt: expect.any(String),
      },
    ]);

    const badProvider = await call("/api/settings/keys/evil", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "evil", model: "any", key: "sk-or-v1-abcdefgh" }),
    });
    expect(badProvider.status).toBe(422);

    const badModel = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "openrouter", model: "not-a-model", key: "sk-or-v1-abcdefgh" }),
    });
    expect(badModel.status).toBe(422);

    const providers = (await (
      await call("/api/settings/keys/providers", { headers: { Cookie: teacher } })
    ).json()) as Array<{
      id: string;
    }>;
    expect(providers.some((entry) => entry.id === "openrouter")).toBe(true);
    const models = (await (
      await call("/api/settings/keys/providers/openrouter/models", { headers: { Cookie: teacher } })
    ).json()) as Array<{ id: string }>;
    expect(models.some((entry) => entry.id === "z-ai/glm-5.3-flash")).toBe(true);

    const studentCookie = cookieOf(
      await call("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "R6生F", tosAccepted: true }),
      }),
    );
    const studentPut = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: studentCookie },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-v1-abcdefgh" }),
    });
    expect(studentPut.status).toBe(403);

    const order = await call("/api/settings/keys/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ providers: ["openrouter"] }),
    });
    expect(order.status).toBe(200);

    const del = await call("/api/settings/keys/openrouter", { method: "DELETE", headers: { Cookie: teacher } });
    expect(del.status).toBe(204);
  });

  test("register→login 學生雙軌：註冊即成員，同 email 密碼可登入", async () => {
    const email = `reg-${Date.now()}@socrates.tw`;
    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, password: "student-pass-1", name: "註冊生A", tosAccepted: true }),
    });
    expect(registered.status).toBe(200);
    expect(((await registered.json()) as { role: string }).role).toBe("student");

    const noConsent = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        email: `nc-${Date.now()}@socrates.tw`,
        password: "student-pass-1",
        name: "未同意生",
        tosAccepted: false,
      }),
    });
    expect(noConsent.status).toBe(422);
    expect(((await noConsent.json()) as { code?: string }).code).toBe("tos_required");

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "student-pass-1" }),
    });
    expect(login.status).toBe(200);
    const me = await call("/api/me", { headers: { Cookie: cookieOf(login) } });
    expect(((await me.json()) as { role: string }).role).toBe("student");
  });

  test("lookup mock：websearch 缺 binding → fallback 文字（prose mock）", async () => {
    const student = cookieOf(
      await call("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "R6生E", tosAccepted: true }),
      }),
    );
    const lookup = await call("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ term: "功利主義" }),
    });
    expect(lookup.status).toBe(200);
    expect(((await lookup.json()) as { markdown: string }).markdown).toContain("功利主義");
  });
});

describe("report（#74：finish→pending→ready→GET）", () => {
  test("finish 觸發 ReportRunner：pending→ready→角色分流報告", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      title: string;
    }>;
    const created = (await (
      await call("/api/classrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacher },
        body: JSON.stringify({ name: "Report 班", topicId: topics[0]!.id }),
      })
    ).json()) as { code: string; activityId: string };
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "報告生", tosAccepted: true }),
    });
    const student = cookieOf(joined);

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher },
    });
    expect(finish.status).toBe(204);

    const report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
    expect([200, 404]).toContain(report.status);
    if (report.status === 404) {
      expect(((await report.json()) as { code: string }).code).toBe("report_pending");
    }

    const settled = await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
        return (await res.json()) as { topicTitle: string; classReport: unknown; students: unknown[] };
      },
      { timeout: 30_000, interval: 500 },
    );
    expect(settled.topicTitle).toBe(topics[0]!.title);
    expect(Array.isArray(settled.students)).toBe(true);

    const asStudent = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: student } });
    expect(asStudent.status).toBe(200);
    const studentReport = (await asStudent.json()) as { pseudonym: string; analysis: unknown };
    expect(typeof studentReport.pseudonym).toBe("string");
    expect("analysis" in studentReport).toBe(true);
  }, 40_000);
});
