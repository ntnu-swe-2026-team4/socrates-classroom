import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { AdminKeyEchoSchema, AdminKeyModelEchoSchema, AdminKeyStatusSchema } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, cookieOf, rows, str } from "./helpers";

const migrations = inject("d1Migrations");

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

async function createAdminKey(cookie: string, provider = "openrouter", key = "sk-or-v1-abcdefgh") {
  const res = await call("/api/admin/keys", jsonInit({ provider, key }, cookie));
  expect(res.status).toBe(201);
  const created = AdminKeyEchoSchema.parse(await res.json());
  return { id: created.id, provider: created.provider, last4: created.last4 };
}

let admin: string;
let student: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
  student = await login("student-a@socrates.tw");
});

describe("admin BYOK credential layer (#354)", () => {
  test("key CRUD is admin-only, echoes last4 only, and keeps one key per provider", async () => {
    const anonymous = await call("/api/admin/keys");
    expect(anonymous.status).toBe(401);

    const denied = await call("/api/admin/keys", { headers: { Cookie: student } });
    expect(denied.status).toBe(403);
    expect(str(await denied.json(), "code")).toBe("forbidden");

    const key = await createAdminKey(admin);
    expect(key.provider).toBe("openrouter");
    expect(key.last4).toBe("efgh");
    expect(JSON.stringify(key)).not.toContain("sk-or-v1");

    const anonymousCreate = await call(
      "/api/admin/keys",
      jsonInit({ provider: "openrouter", key: "sk-or-v1-anon0001" }),
    );
    expect(anonymousCreate.status).toBe(401);
    const deniedCreate = await call(
      "/api/admin/keys",
      jsonInit({ provider: "openrouter", key: "sk-or-v1-student01" }, student),
    );
    expect(deniedCreate.status).toBe(403);
    expect(str(await deniedCreate.json(), "code")).toBe("forbidden");
    const deniedUpdate = await call(`/api/admin/keys/${key.id}`, putInit({ monthlyQuotaUsd: 5 }, student));
    expect(deniedUpdate.status).toBe(403);
    const deniedDelete = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: student } });
    expect(deniedDelete.status).toBe(403);

    const dupe = await call("/api/admin/keys", jsonInit({ provider: "openrouter", key: "sk-or-v1-zzzzzzzz" }, admin));
    expect(dupe.status).toBe(409);

    const listed = await call("/api/admin/keys", { headers: { Cookie: admin } });
    expect(listed.status).toBe(200);
    const keyList = AdminKeyStatusSchema.array().parse(await listed.json());
    expect(keyList).toHaveLength(1);
    expect(keyList[0]).toMatchObject({ provider: "openrouter", last4: "efgh", models: [] });
    expect(JSON.stringify(keyList)).not.toContain("sk-or-v1");

    const badProvider = await call("/api/admin/keys", jsonInit({ provider: "nope", key: "sk-nope-abcdefgh" }, admin));
    expect(badProvider.status).toBe(422);
    expect(str(await badProvider.json(), "code")).toBe("byok_provider_invalid");

    const rekey = await call(
      `/api/admin/keys/${key.id}`,
      putInit({ key: "sk-or-v1-newkey123", maxConcurrency: 6 }, admin),
    );
    expect(rekey.status).toBe(200);
    expect(await rekey.json()).toMatchObject({ id: key.id, provider: "openrouter", last4: "y123", maxConcurrency: 6 });

    const quotaOnly = await call(
      `/api/admin/keys/${key.id}`,
      putInit({ monthlyQuotaUsd: 5, maxConcurrency: 3 }, admin),
    );
    expect(quotaOnly.status).toBe(200);
    expect(await quotaOnly.json()).toMatchObject({
      id: key.id,
      last4: "y123",
      monthlyQuotaUsd: 5,
      maxConcurrency: 3,
    });

    const missing = await call("/api/admin/keys/ak_none", putInit({ monthlyQuotaUsd: 5 }, admin));
    expect(missing.status).toBe(404);

    const removed = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(removed.status).toBe(204);
    const again = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(again.status).toBe(404);
  });

  test("model legs validate against the provider catalog and order per key", async () => {
    const key = await createAdminKey(admin, "openrouter", "sk-or-v1-legtest01");

    const legA = await call(
      `/api/admin/keys/${key.id}/models`,
      putInit({ model: "z-ai/glm-5.3-flash", maxConcurrency: 2 }, admin),
    );
    expect(legA.status).toBe(200);
    expect(AdminKeyModelEchoSchema.parse(await legA.json()).maxConcurrency).toBe(2);

    const legB = await call(`/api/admin/keys/${key.id}/models`, putInit({ model: "z-ai/glm-4.7-flash" }, admin));
    expect(legB.status).toBe(200);

    const badModel = await call(`/api/admin/keys/${key.id}/models`, putInit({ model: "not-a-model" }, admin));
    expect(badModel.status).toBe(422);

    const badLimit = await call(
      `/api/admin/keys/${key.id}/models`,
      putInit({ model: "z-ai/glm-5.3-flash", maxConcurrency: 0 }, admin),
    );
    expect(badLimit.status).toBe(422);

    const catalog = await call("/api/admin/keys/providers/openrouter/models", { headers: { Cookie: admin } });
    expect(catalog.status).toBe(200);
    expect(rows(await catalog.json()).some((entry) => str(entry, "id") === "z-ai/glm-5.3-flash")).toBe(true);
    const deniedCatalog = await call("/api/admin/keys/providers/openrouter/models", {
      headers: { Cookie: student },
    });
    expect(deniedCatalog.status).toBe(403);

    const reorder = await call(
      `/api/admin/keys/${key.id}/models/order`,
      putInit({ models: ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"] }, admin),
    );
    expect(reorder.status).toBe(200);
    const keyList = AdminKeyStatusSchema.array().parse(
      await (await call("/api/admin/keys", { headers: { Cookie: admin } })).json(),
    );
    expect(keyList[0]?.models.map((leg) => leg.model)).toEqual(["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"]);

    const dropLeg = await call(`/api/admin/keys/${key.id}/models/${encodeURIComponent("z-ai/glm-4.7-flash")}`, {
      method: "DELETE",
      headers: { Cookie: admin },
    });
    expect(dropLeg.status).toBe(204);

    await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
  });

  test("key order endpoint reorders the platform pool", async () => {
    const a = await createAdminKey(admin, "deepseek", "sk-ds-aaaa1111");
    const b = await createAdminKey(admin, "groq", "sk-gq-bbbb2222");

    const reordered = await call("/api/admin/keys/order", putInit({ keys: [b.id, a.id] }, admin));
    expect(reordered.status).toBe(200);
    const keyList = AdminKeyStatusSchema.array().parse(
      await (await call("/api/admin/keys", { headers: { Cookie: admin } })).json(),
    );
    expect(keyList.map((row) => row.id)).toEqual([b.id, a.id]);

    await call(`/api/admin/keys/${a.id}`, { method: "DELETE", headers: { Cookie: admin } });
    await call(`/api/admin/keys/${b.id}`, { method: "DELETE", headers: { Cookie: admin } });
  });

  test("the keyable provider list is admin-only", async () => {
    const res = await call("/api/admin/keys/providers", { headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    expect(rows(await res.json()).some((entry) => str(entry, "id") === "openrouter")).toBe(true);

    const denied = await call("/api/admin/keys/providers", { headers: { Cookie: student } });
    expect(denied.status).toBe(403);
    expect(str(await denied.json(), "code")).toBe("forbidden");
  });

  test("adminCredentialStore resolves the provider's admin key and nothing else", async () => {
    const key = await createAdminKey(admin, "openrouter", "sk-or-v1-store9999");
    const { adminCredentialStore } = await import("../src/pi/credentials");
    const store = adminCredentialStore(env);

    const resolved = await store.read("openrouter");
    expect(resolved).toMatchObject({ type: "api_key", key: "sk-or-v1-store9999" });
    expect(await store.read("deepseek")).toBeUndefined();
    expect(await store.read("openrouter-not-a-provider")).toBeUndefined();

    const listed = await store.list();
    expect(listed).toEqual([{ providerId: "openrouter", type: "api_key" }]);

    await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(await store.read("openrouter")).toBeUndefined();
  });
});
