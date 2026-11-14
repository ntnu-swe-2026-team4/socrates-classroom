import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { NotificationFeed } from "@socrates/shared";
import { seedDemo } from "../src/seed";
import { call, cookieOf, registerAccount } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let admin: string;

function send(path: string, cookie: string | null, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function feedOf(cookie: string): Promise<NotificationFeed> {
  const res = await send("/api/notifications", cookie, "GET");
  expect(res.status).toBe(200);
  return (await res.json()) as NotificationFeed;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  admin = cookieOf(await send("/api/auth/login", null, "POST", { email: "demo@socrates.tw", password: "demo-demo" }));
});

describe("system notifications", () => {
  it("only an admin can send or delete", async () => {
    const account = await registerAccount("一般使用者");
    const denied = await send("/api/admin/notifications", account.cookie, "POST", { title: "偷發", body: "" });
    expect(denied.status).toBe(403);
    const anonymous = await send("/api/admin/notifications", null, "POST", { title: "偷發", body: "" });
    expect(anonymous.status).toBe(401);
    const empty = await send("/api/admin/notifications", admin, "POST", { title: "  ", body: "" });
    expect(empty.status).toBe(422);
    const missing = await send("/api/admin/notifications/n_missing", admin, "DELETE");
    expect(missing.status).toBe(404);
  });

  it("every account sees a sent notice as unread until it opens the bell", async () => {
    const account = await registerAccount("收通知的人");
    const before = await feedOf(account.cookie);

    const created = await send("/api/admin/notifications", admin, "POST", {
      title: "系統維護",
      body: "週六凌晨停機。",
    });
    expect(created.status).toBe(201);
    const notice = (await created.json()) as { id: string; title: string };
    expect(notice.title).toBe("系統維護");

    const feed = await feedOf(account.cookie);
    expect(feed.unread).toBe(before.unread + 1);
    expect(feed.items[0]).toMatchObject({ id: notice.id, title: "系統維護", body: "週六凌晨停機。" });

    expect((await send("/api/notifications/seen", account.cookie, "POST")).status).toBe(204);
    expect((await feedOf(account.cookie)).unread).toBe(0);
    expect((await feedOf(admin)).items.some((item) => item.id === notice.id)).toBe(true);

    expect((await send(`/api/admin/notifications/${notice.id}`, admin, "DELETE")).status).toBe(204);
    expect((await feedOf(account.cookie)).items.some((item) => item.id === notice.id)).toBe(false);
  });

  it("the login page can read notices without a session, with nothing counted as unread", async () => {
    const created = await send("/api/admin/notifications", admin, "POST", { title: "公開公告", body: "" });
    const notice = (await created.json()) as { id: string };
    const res = await send("/api/notifications", null, "GET");
    expect(res.status).toBe(200);
    const feed = (await res.json()) as NotificationFeed;
    expect(feed.unread).toBe(0);
    expect(feed.items.some((item) => item.id === notice.id)).toBe(true);
    expect((await send("/api/notifications/seen", null, "POST")).status).toBe(401);
  });
});
