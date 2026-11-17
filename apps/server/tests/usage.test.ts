import { env as workerEnv } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { AdminUsageAlert, Usage } from "@socrates/shared";
import type { Env } from "../src/env";
import { seedDemo } from "../src/seed";
import { flushUsageAlerts, recordUsage, type AlertEmail } from "../src/routes/usage";
import { call, cookieOf, registerAccount } from "./helpers";

const json = { "Content-Type": "application/json" };
const env = workerEnv as unknown as Env;
let admin: string;

function send(path: string, cookie: string | null, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function usageOf(cookie: string): Promise<Usage> {
  const res = await send("/api/settings/usage", cookie, "GET");
  expect(res.status).toBe(200);
  return (await res.json()) as Usage;
}

function outbox() {
  const sent: AlertEmail[] = [];
  return { sent, sender: async (email: AlertEmail) => void sent.push(email) };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
  await seedDemo(env.DB);
  admin = cookieOf(await send("/api/auth/login", null, "POST", { email: "admin@socrates.tw", password: "demo-demo" }));
});

describe("usage quota and alerts", () => {
  it("needs an account, starts empty and validates the quota", async () => {
    expect((await send("/api/settings/usage", null, "GET")).status).toBe(401);
    const account = await registerAccount("用量甲");
    const empty = await usageOf(account.cookie);
    expect(empty).toMatchObject({ tokens: 0, requests: 0, quota: null, emailReady: false });
    expect(empty.thresholds.map((item) => item.threshold)).toEqual([60, 80, 100]);
    expect(empty.thresholds.every((item) => item.reachedAt === null)).toBe(true);
    expect(new Date(empty.resetsAt).getTime()).toBeGreaterThan(Date.now());

    expect((await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 10 })).status).toBe(422);
    expect((await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 1.5 })).status).toBe(422);
    const set = await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 10_000 });
    expect(((await set.json()) as Usage).quota).toBe(10_000);
    const cleared = await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: null });
    expect(((await cleared.json()) as Usage).quota).toBeNull();
  });

  it("counts usage against the quota and emails each threshold once, to the owner and the admins", async () => {
    const account = await registerAccount("用量乙");
    await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 10_000 });
    const mail = outbox();

    await recordUsage(env, account.id, 5_000, { sender: mail.sender });
    expect(mail.sent).toHaveLength(0);
    expect((await usageOf(account.cookie)).thresholds.every((item) => item.reachedAt === null)).toBe(true);

    await recordUsage(env, account.id, 1_500, { sender: mail.sender });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.subject).toContain("60%");
    expect(mail.sent[0]?.to).toContain("admin@socrates.tw");
    expect(mail.sent[0]?.to.some((address) => address !== "admin@socrates.tw")).toBe(true);

    await recordUsage(env, account.id, 500, { sender: mail.sender });
    expect(mail.sent).toHaveLength(1);

    await recordUsage(env, account.id, 4_000, { sender: mail.sender });
    expect(mail.sent.map((email) => email.subject.match(/\d+%/)?.[0])).toEqual(["60%", "80%", "100%"]);

    await recordUsage(env, account.id, 9_000, { sender: mail.sender });
    expect(mail.sent).toHaveLength(3);

    const usage = await usageOf(account.cookie);
    expect(usage).toMatchObject({ tokens: 20_000, requests: 5, quota: 10_000 });
    expect(usage.thresholds.every((item) => item.reachedAt !== null && item.emailedAt !== null)).toBe(true);
  });

  it("keeps alerts pending without an email transport, then sends them once one is available", async () => {
    const account = await registerAccount("用量丙");
    await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 1_000 });
    await recordUsage(env, account.id, 700, { sender: null });
    const pending = (await usageOf(account.cookie)).thresholds.find((item) => item.threshold === 60);
    expect(pending?.reachedAt).not.toBeNull();
    expect(pending?.emailedAt).toBeNull();

    const mail = outbox();
    expect(await flushUsageAlerts(env, mail.sender)).toBeGreaterThanOrEqual(1);
    expect(mail.sent.some((email) => email.text.includes("用量丙"))).toBe(true);
    expect(await flushUsageAlerts(env, mail.sender)).toBe(0);
  });

  it("lowering the quota below current usage raises the alerts; usage from a past month does not count", async () => {
    const account = await registerAccount("用量丁");
    await recordUsage(env, account.id, 900, { sender: null, now: new Date("2020-01-15T00:00:00Z") });
    expect((await usageOf(account.cookie)).tokens).toBe(0);
    await recordUsage(env, account.id, 900, { sender: null });
    const after = await send("/api/settings/usage/quota", account.cookie, "PUT", { tokens: 1_000 });
    const reached = ((await after.json()) as Usage).thresholds.filter((item) => item.reachedAt !== null);
    expect(reached.map((item) => item.threshold)).toEqual([60, 80]);
  });

  it("lists alerts for admins only", async () => {
    const account = await registerAccount("用量戊");
    expect((await send("/api/admin/usage-alerts", account.cookie, "GET")).status).toBe(403);
    const rows = (await (await send("/api/admin/usage-alerts", admin, "GET")).json()) as AdminUsageAlert[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ threshold: expect.any(Number), name: expect.any(String) });
  });
});
