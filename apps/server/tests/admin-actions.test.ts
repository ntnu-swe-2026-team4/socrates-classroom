import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { AdminActionSchema } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { z } from "zod";
import { all } from "../src/db/d1";
import { FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, cookieOf, field, str } from "./helpers";

const migrations = inject("d1Migrations");

const AdminActionFeedSchema = z.object({
  items: z.array(AdminActionSchema),
  nextCursor: z.number().nullable(),
});

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function putInit(body: unknown, cookie: string): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  };
}

async function login(email: string, password = FIXTURE_PASSWORD): Promise<string> {
  const res = await call("/api/auth/login", jsonInit({ email, password }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function createAdminKey(cookie: string, key = "sk-or-v1-audittest1") {
  const res = await call("/api/admin/keys", jsonInit({ provider: "openrouter", key }, cookie));
  expect(res.status).toBe(201);
  return { id: str(await res.json(), "id") };
}

async function actions(): Promise<Array<Record<string, unknown>>> {
  return await all<Record<string, unknown>>(
    env.DB,
    "SELECT actor_id, action, target, before_json, after_json FROM admin_actions ORDER BY id DESC",
  );
}

let admin: string;
let student: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
  student = await login("student-a@socrates.tw");
});

describe("admin action audit log (#359)", () => {
  test("key CRUD writes audit rows atomically, never with key material", async () => {
    const key = await createAdminKey(admin);
    let rows = await actions();
    expect(rows[0]).toMatchObject({
      actor_id: "u_fx_admin",
      action: "admin_key.create",
      target: `admin_key:${key.id}`,
    });
    const createdRow = rows[0];
    expect(field(createdRow, "before_json")).toBeNull();
    expect(JSON.parse(String(field(createdRow, "after_json")))).toEqual({
      provider: "openrouter",
      last4: "est1",
      maxConcurrency: null,
      monthlyQuotaUsd: null,
    });
    expect(JSON.stringify(createdRow)).not.toContain("sk-or-");

    const updated = await call(`/api/admin/keys/${key.id}`, putInit({ monthlyQuotaUsd: 5, maxConcurrency: 3 }, admin));
    expect(updated.status).toBe(200);
    rows = await actions();
    expect(rows[0]).toMatchObject({ action: "admin_key.update", target: `admin_key:${key.id}` });
    const before: unknown = JSON.parse(String(rows[0]?.before_json));
    const after: unknown = JSON.parse(String(rows[0]?.after_json));
    expect(before).toEqual({ provider: "openrouter", last4: "est1", maxConcurrency: null, monthlyQuotaUsd: null });
    expect(after).toEqual({ provider: "openrouter", last4: "est1", maxConcurrency: 3, monthlyQuotaUsd: 5 });
    expect(JSON.stringify(rows[0])).not.toContain("sk-or-");

    const leg = await call(
      `/api/admin/keys/${key.id}/models`,
      putInit({ model: "z-ai/glm-5.3-flash", maxConcurrency: 2 }, admin),
    );
    expect(leg.status).toBe(200);
    rows = await actions();
    expect(rows[0]).toMatchObject({
      action: "admin_key_model.upsert",
      target: `admin_key:${key.id}`,
    });
    expect(JSON.parse(String(rows[0]?.after_json))).toMatchObject({
      model: "z-ai/glm-5.3-flash",
      maxConcurrency: 2,
    });

    const removed = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(removed.status).toBe(204);
    rows = await actions();
    expect(rows[0]).toMatchObject({ action: "admin_key.delete", target: `admin_key:${key.id}` });
  });

  test("a failed write leaves no audit row behind (same-batch rollback)", async () => {
    const key = await createAdminKey(admin, "sk-or-v1-rollback01");
    const before = await actions();

    const dupe = await call("/api/admin/keys", jsonInit({ provider: "openrouter", key: "sk-or-v1-rollback02" }, admin));
    expect(dupe.status).toBe(409);
    expect(await actions()).toEqual(before);

    const missing = await call("/api/admin/keys/ak_none", putInit({ monthlyQuotaUsd: 5 }, admin));
    expect(missing.status).toBe(404);
    expect(await actions()).toEqual(before);

    await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
  });

  test("the action feed is admin-only, newest first, paginated", async () => {
    const anonymous = await call("/api/admin/actions");
    expect(anonymous.status).toBe(401);

    const denied = await call("/api/admin/actions", { headers: { Cookie: student } });
    expect(denied.status).toBe(403);
    expect(str(await denied.json(), "code")).toBe("forbidden");

    const feed = await call("/api/admin/actions?limit=3", { headers: { Cookie: admin } });
    expect(feed.status).toBe(200);
    const page = AdminActionFeedSchema.parse(await feed.json());
    expect(page.items.length).toBeLessThanOrEqual(3);
    const ids = page.items.map((item) => item.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);

    const cursor = page.nextCursor;
    if (cursor !== null) {
      const next = await call(`/api/admin/actions?limit=3&cursor=${cursor}`, { headers: { Cookie: admin } });
      expect(next.status).toBe(200);
      const nextPage = AdminActionFeedSchema.parse(await next.json());
      expect(nextPage.items.length).toBeGreaterThan(0);
      expect(nextPage.items.every((item) => item.id < cursor)).toBe(true);
    }
  });

  test("key and leg ordering write audit rows without key material (#390)", async () => {
    const key = await createAdminKey(admin, "sk-or-v1-auditorder");
    const legRes = await call(`/api/admin/keys/${key.id}/models`, putInit({ model: "z-ai/glm-5.3-flash" }, admin));
    expect(legRes.status).toBe(200);
    const secondRes = await call(`/api/admin/keys/${key.id}/models`, putInit({ model: "z-ai/glm-4.7-flash" }, admin));
    expect(secondRes.status).toBe(200);

    const legOrder = await call(
      `/api/admin/keys/${key.id}/models/order`,
      putInit({ models: ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"] }, admin),
    );
    expect(legOrder.status).toBe(200);
    const keyOrder = await call("/api/admin/keys/order", putInit({ keys: [key.id] }, admin));
    expect(keyOrder.status).toBe(200);

    const rows = await actions();
    const legRow = rows.find((row) => row.action === "admin_key_model.order");
    expect(legRow?.target).toBe(`admin_key:${key.id}`);
    expect(JSON.parse(String(legRow?.after_json))).toEqual({
      models: ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"],
    });
    const keyRow = rows.find((row) => row.action === "admin_key.order");
    expect(keyRow?.target).toBe("admin_keys");
    expect(JSON.parse(String(keyRow?.after_json))).toEqual({ keys: [key.id] });
    expect(JSON.stringify(rows)).not.toContain("sk-or-");
  });
});
