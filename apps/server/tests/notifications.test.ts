import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { seedFixture } from "../src/seed";
import { call, cookieOf } from "./helpers";

const migrations = inject("d1Migrations");

const json: Record<string, string> = { "Content-Type": "application/json" };

async function login(email: string, password = "demo-demo"): Promise<string> {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function compose(admin: string, title: string, body = "維護公告內文"): Promise<Response> {
  return call("/api/admin/notifications", {
    method: "POST",
    headers: { ...json, Cookie: admin },
    body: JSON.stringify({ title, body }),
  });
}

interface FeedItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

async function feed(cookie?: string): Promise<{ items: FeedItem[]; unread: number | null }> {
  const res = await call("/api/notifications", ...(cookie ? [{ headers: { Cookie: cookie } }] : []));
  expect(res.status).toBe(200);
  return (await res.json()) as { items: FeedItem[]; unread: number | null };
}

let admin: string;
let student: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
  student = await login("student-a@socrates.tw");
});

describe("notifications feed and read watermark (#239)", () => {
  test("admin composes an announcement; non-admin and anonymous are rejected", async () => {
    const created = await compose(admin, "期中維護公告");
    expect(created.status).toBe(201);
    const row = (await created.json()) as FeedItem;
    expect(row.title).toBe("期中維護公告");
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeTruthy();

    expect((await compose(student, "越權公告")).status).toBe(403);
    expect((await compose("", "匿名公告")).status).toBe(401);
  });

  test("feed is login-free; unread is null when not signed in", async () => {
    const body = await feed();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.unread).toBeNull();
  });

  test("feed lists latest first with the composed announcements", async () => {
    const before = (await feed()).items.length;
    await compose(admin, `排序公告 ${Date.now()}`);
    const body = await feed();
    expect(body.items.length).toBe(before + 1);
    expect(body.items[0].createdAt >= body.items[body.items.length - 1].createdAt).toBe(true);
  });

  test("unread counts only items newer than the watermark; seen marks it idempotently", async () => {
    await compose(admin, `未讀公告 ${Date.now()}`);
    const first = await feed(student);
    expect(first.unread).toBeGreaterThan(0);

    expect((await call("/api/notifications/seen", { method: "POST", headers: { Cookie: student } })).status).toBe(204);
    expect((await feed(student)).unread).toBe(0);
    expect((await call("/api/notifications/seen", { method: "POST", headers: { Cookie: student } })).status).toBe(204);
    expect((await feed(student)).unread).toBe(0);
  });

  test("a new announcement after seen becomes unread again", async () => {
    await call("/api/notifications/seen", { method: "POST", headers: { Cookie: student } });
    await compose(admin, `新未讀 ${Date.now()}`);
    expect((await feed(student)).unread).toBe(1);
  });

  test("seen requires an account", async () => {
    expect((await call("/api/notifications/seen", { method: "POST" })).status).toBe(401);
  });

  test("compose validates title and body", async () => {
    expect((await compose(admin, " ")).status).toBe(422);
    expect(
      (
        await call("/api/admin/notifications", {
          method: "POST",
          headers: { ...json, Cookie: admin },
          body: JSON.stringify({ title: "無內文" }),
        })
      ).status,
    ).toBe(422);
  });
});
