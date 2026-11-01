import { expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db";

test("沒有 GLM_API_KEY 時，對話端點回 503 且不開 SSE", async () => {
  const db = openDb(":memory:");
  const config = loadConfig({ dbPath: ":memory:", llmProvider: "glm", glmKey: "", seedDemo: false });
  const app = createApp(db, config);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "student", name: "測試" }),
  });
  const cookie = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
  const created = await app.request("/api/archives", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "沒有 key" }),
  });
  const { id } = await created.json() as any;
  const res = await app.request(`/api/archives/${id}/dialogue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Accept: "text/event-stream", "Accept-Language": "en" },
    body: JSON.stringify({ text: "hello" }),
  });
  expect(res.status).toBe(503);
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  const body = await res.json() as any;
  expect(body.code).toBe("llm_not_configured");
  expect(body.message).toBe("Socrates cannot reply right now. Please try again later.");
  db.close();
});
