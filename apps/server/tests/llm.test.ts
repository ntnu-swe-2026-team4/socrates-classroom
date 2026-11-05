import { beforeAll, describe, expect, test } from "vitest";
import { env } from "cloudflare:test";

describe("PiAgent mock 對話（SSE 契約）", () => {
  let code: string;
  let activityId: string;
  let cookie: string;

  beforeAll(async () => {
    const { createApp } = await import("../src/app");
    const { seedDemo } = await import("../src/seed");
    const { run, one } = await import("../src/db/d1");
    const migration = (await import("../migrations/001_init.sql")).default;
    const app = createApp();
    for (const statement of migration.split(";")) {
      if (statement.trim()) await run(env.DB, statement.trim());
    }
    await seedDemo(env.DB);
    const topic = await one<{ id: string }>(env.DB, "SELECT id FROM topics LIMIT 1");
    const login = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
      },
      env,
    );
    const teacherCookie = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
    const created = await app.request(
      "/api/classrooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacherCookie },
        body: JSON.stringify({ name: "llm 測試班", topicId: topic!.id }),
      },
      env,
    );
    const classroom = (await created.json()) as { code: string; activityId: string };
    code = classroom.code;
    activityId = classroom.activityId;
    const joined = await app.request(
      "/api/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: "測試生", tosAccepted: true }),
      },
      env,
    );
    cookie = (joined.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
  });

  test("done.message.text 等於 delta 總和", async () => {
    const { createApp } = await import("../src/app");
    const app = createApp();
    const res = await app.request(
      `/api/activities/${activityId}/dialogue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ text: "正義就是大多數人的利益。" }),
      },
      env,
    );
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
    let deltaSum = "";
    let doneText = "";
    for (const block of body.split("\n\n")) {
      const event = block
        .split("\n")
        .find((l) => l.startsWith("event: "))
        ?.slice(7);
      const data = block
        .split("\n")
        .find((l) => l.startsWith("data: "))
        ?.slice(6);
      if (event === "delta") deltaSum += (JSON.parse(data!) as { text: string }).text;
      if (event === "done") doneText = (JSON.parse(data!) as { message: { text: string } }).message.text;
    }
    expect(doneText.length).toBeGreaterThan(4);
    expect(deltaSum).toBe(doneText);
  });
});

describe("Coordinator gate", () => {
  test("併發閘滿後 busy，settle 後恢復", async () => {
    const stub = env.Coordinator.getByName("test-provider");
    const limits = { concurrency: 2 };
    expect(await stub.lease("test-provider", "t1", limits)).toBe("granted");
    expect(await stub.lease("test-provider", "t2", limits)).toBe("granted");
    expect(await stub.lease("test-provider", "t3", limits)).toBe("busy");
    await stub.settle("test-provider", "ok");
    expect(await stub.lease("test-provider", "t3", limits)).toBe("granted");
    await stub.settle("test-provider", "ok");
    await stub.settle("test-provider", "ok");
  });

  test("連續失敗觸發 breaker open", async () => {
    const stub = env.Coordinator.getByName("breaker-provider");
    for (let i = 0; i < 5; i += 1) {
      await stub.lease("breaker-provider", `t${i}`);
      await stub.settle("breaker-provider", "error");
    }
    const outcome = await stub.lease("breaker-provider", "t9");
    expect(outcome).toBe("open");
  });
});
