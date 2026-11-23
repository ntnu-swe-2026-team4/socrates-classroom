import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { AdminProviderChain, AdminTeacherKeyStatus } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, cookieOf } from "./helpers";

const migrations = inject("d1Migrations");

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

async function login(email: string, password = FIXTURE_PASSWORD): Promise<string> {
  const res = await call("/api/auth/login", jsonInit({ email, password }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function putTeacherKey(cookie: string, provider: string, key: string) {
  const res = await call(`/api/settings/keys/${provider}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key }),
  });
  expect(res.status).toBe(200);
}

async function putTeacherLeg(cookie: string, provider: string, model: string) {
  const res = await call(`/api/settings/keys/${provider}/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ model }),
  });
  expect(res.status).toBe(200);
}

let admin: string;
let teacher: string;
let student: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
  teacher = await login("demo@socrates.tw");
  student = await login("student-a@socrates.tw");
});

describe("provider management reads for the admin console (#360)", () => {
  test("teacher key survey lists every account's keys with owner identity, last4-only", async () => {
    await putTeacherKey(teacher, "openrouter", "sk-or-v1-teachersrvy");
    await putTeacherLeg(teacher, "openrouter", "z-ai/glm-5.3-flash");

    const anonymous = await call("/api/admin/teacher-keys");
    expect(anonymous.status).toBe(401);
    const denied = await call("/api/admin/teacher-keys", { headers: { Cookie: student } });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe("forbidden");

    const res = await call("/api/admin/teacher-keys", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as AdminTeacherKeyStatus[];
    const entry = rows.find((row) => row.userId === "u_fx_lin" && row.provider === "openrouter");
    expect(entry).toBeTruthy();
    expect(entry?.userName).toBeTruthy();
    expect(entry?.last4).toBe("srvy");
    expect(entry?.monthCostUsd).toBe(0);
    expect(JSON.stringify(rows)).not.toContain("sk-or-v1-teachersrvy");
  });

  test("teacher key survey can disable a teacher's key (managed suspension)", async () => {
    const survey = (await (
      await call("/api/admin/teacher-keys", { headers: { Cookie: admin } })
    ).json()) as AdminTeacherKeyStatus[];
    const entry = survey.find((row) => row.userId === "u_fx_lin" && row.provider === "openrouter");
    if (!entry) throw new Error("seeded teacher key missing");

    const disabled = await call(`/api/admin/teacher-keys/${entry.userId}/${entry.provider}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disabled.status).toBe(200);
    const after = (await (
      await call("/api/admin/teacher-keys", { headers: { Cookie: admin } })
    ).json()) as AdminTeacherKeyStatus[];
    expect(after.find((row) => row.userId === entry.userId && row.provider === entry.provider)?.disabled).toBe(true);

    const teacherSelf = await call("/api/settings/keys", { headers: { Cookie: teacher } });
    const selfKeys = (await teacherSelf.json()) as Array<{ provider: string }>;
    expect(selfKeys.some((row) => row.provider === entry.provider)).toBe(true);

    const restore = await call(`/api/admin/teacher-keys/${entry.userId}/${entry.provider}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ disabled: false }),
    });
    expect(restore.status).toBe(200);

    const forbidden = await call(`/api/admin/teacher-keys/u_fx_lin/openrouter`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ disabled: true }),
    });
    expect(forbidden.status).toBe(403);
  });

  test("the YAML platform chain is a read-only static view", async () => {
    const res = await call("/api/admin/platform-chain", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    const chain = (await res.json()) as AdminProviderChain;
    expect(chain.mode).toBe("static");
    expect(chain.legs.length).toBeGreaterThan(0);
    expect(chain.legs[0]).toMatchObject({ provider: "workers-ai", credential: "platform" });
    expect(chain.legs.map((leg) => leg.priority)).toEqual(
      [...chain.legs.map((leg) => leg.priority)].sort((a, b) => a - b),
    );

    const denied = await call("/api/admin/platform-chain", { headers: { Cookie: student } });
    expect(denied.status).toBe(403);
  });
});
