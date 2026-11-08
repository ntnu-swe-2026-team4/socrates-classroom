import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import worker from "../src/index";
import { run } from "../src/db/d1";
import { seedDemo } from "../src/seed";
import migrationSql from "../migrations/001_init.sql";
import keysMigration from "../migrations/002_teacher_keys.sql";

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
  for (const statement of [...migrationSql.split(";"), ...keysMigration.split(";")]) {
    if (statement.trim()) await run(env.DB, statement.trim());
  }
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

  test("finish→report 語意（pending → 404 report_pending）", async () => {
    const report0 = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacher } });
    expect(report0.status).toBe(404);
    expect(((await report0.json()) as { code: string }).code).toBe("report_pending");

    const finish = await call(`/api/activities/${activityId}/finish`, { method: "POST", headers: { Cookie: teacher } });
    expect(finish.status).toBe(204);
    const again = await call(`/api/activities/${activityId}/finish`, { method: "POST", headers: { Cookie: teacher } });
    expect(again.status).toBe(204);
  });

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
    const live = await call(`/api/activities/${activityId}/live`, { headers: { Cookie: student } });
    expect(live.status).toBe(404);
  });

  test("teacher keys CRUD：PUT 冪等、order、只回 last4、teacher-only", async () => {
    const put = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-v1-abcdefgh" }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { last4: string }).last4).toBe("efgh");

    const again = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "openrouter", key: "sk-or-v1-zzzzzzzz" }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { last4: string }).last4).toBe("zzzz");

    const list = (await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json()) as Array<{
      provider: string;
      last4: string;
    }>;
    expect(list).toEqual([{ provider: "openrouter", last4: "zzzz", sortOrder: 0, updatedAt: expect.any(String) }]);

    const badProvider = await call("/api/settings/keys/evil", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ provider: "evil", key: "sk-or-v1-abcdefgh" }),
    });
    expect(badProvider.status).toBe(422);

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
  test("finish 觸發 ReportRunner：pending 狀態立即可讀", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
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
    void student;
  });
});
