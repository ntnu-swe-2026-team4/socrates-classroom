import { beforeAll, describe, expect, test } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { run } from "../src/db/d1";
import { seedDemo } from "../src/seed";
import migrationSql from "../migrations/001_init.sql";

const ctx = createExecutionContext();

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`http://worker.test${path}`, init), env, ctx);
}

beforeAll(async () => {
  for (const statement of migrationSql.split(";")) {
    if (statement.trim()) await run(env.DB, statement.trim());
  }
  await seedDemo(env.DB);
});

describe("Worker 入口（default export 全鏈路）", () => {
  test("/health", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("API 404 帶契約錯誤形狀（zh 本地化）", async () => {
    const res = await call("/api/nope", { headers: { "Accept-Language": "zh-TW" } });
    expect(res.status).toBe(404);
    const payload = (await res.json()) as { message: string; code: string };
    expect(payload.code).toBe("not_found");
    expect(payload.message).toContain("找不到");
  });

  test("dev seed 無 token 404、有 token 200", async () => {
    const denied = await call("/api/dev/seed", { method: "POST" });
    expect(denied.status).toBe(404);
    const granted = await call("/api/dev/seed", { method: "POST", headers: { "x-seed-token": "dev-seed-token" } });
    expect(granted.status).toBe(200);
    expect(((await granted.json()) as { seeded: boolean }).seeded).toBe(true);
  });

  test("完整黃金流程經 Worker 入口：login→classroom→join→dialogue SSE→finish→report", async () => {
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
    });
    const teacher = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;

    const topics = await call("/api/topics", { headers: { Cookie: teacher } });
    const first = ((await topics.json()) as Array<{ id: string }>)[0]!;
    const created = await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ name: "worker 班", topicId: first.id }),
    });
    const classroom = (await created.json()) as { code: string; activityId: string };

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: classroom.code, name: "黃金生", tosAccepted: true }),
    });
    const student = (joined.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;

    const dialogue = await call(`/api/activities/${classroom.activityId}/dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ text: "我認為結果比原則重要。" }),
    });
    expect(dialogue.status).toBe(200);
    const reader = dialogue.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (!body.includes("event: done")) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    expect(body).toContain("event: delta");
    expect(body).toContain("event: done");

    await call(`/api/activities/${classroom.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher },
    });
    await env.ReportJob.getByName(classroom.activityId).advance();
    const report = await call(`/api/activities/${classroom.activityId}/report`, { headers: { Cookie: student } });
    expect(report.status).toBe(200);
    const payload = (await report.json()) as { individual: { pseudonym: string } };
    expect(payload.individual.pseudonym).toMatch(/^學生/);
  });
});
