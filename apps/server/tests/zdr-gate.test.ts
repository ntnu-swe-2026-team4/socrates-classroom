import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { AdminKeyEchoSchema, AdminKeyStatusSchema } from "@socrates/shared";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { all } from "../src/db/d1";
import { FIXTURE_PASSWORD, seedFixture } from "../src/seed";
import { call, cookieOf, field, str } from "./helpers";

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

async function createKey(cookie: string, provider: string, key: string) {
  const res = await call("/api/admin/keys", jsonInit({ provider, key }, cookie));
  expect(res.status).toBe(201);
  return { id: str(await res.json(), "id") };
}

async function addLeg(cookie: string, id: string, model: string) {
  const res = await call(`/api/admin/keys/${id}/models`, putInit({ model }, cookie));
  expect(res.status).toBe(200);
}

const CF_WORKERS_AI = "cloudflare-workers-ai";
const GLM_FLASH = "@cf/zai-org/glm-5.3-flash";

let admin: string;
let student: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  admin = await login("admin@socrates.tw");
  student = await login("student-a@socrates.tw");
});

describe("admin BYOK ZDR gate (#357)", () => {
  test("an unapproved key never enters the chain; the approval endpoint is admin-only", async () => {
    const { adminLegsOf } = await import("../src/pi/credentials");
    const key = await createKey(admin, CF_WORKERS_AI, "cf-token-zdrcheck-01");
    await addLeg(admin, key.id, GLM_FLASH);
    expect(await adminLegsOf(env)).toEqual([]);

    const anonymous = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({}));
    expect(anonymous.status).toBe(401);
    const denied = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({}, student));
    expect(denied.status).toBe(403);
    expect(str(await denied.json(), "code")).toBe("forbidden");

    const missing = await call(
      `/api/admin/keys/ak_none/zdr`,
      jsonInit({ retentionSource: "https://example.com/privacy", verifiedAt: "2026-11-08" }, admin),
    );
    expect(missing.status).toBe(404);

    const noSource = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({ verifiedAt: "2026-11-08" }, admin));
    expect(noSource.status).toBe(422);
    expect(str(await noSource.json(), "code")).toBe("validation");
    expect(await adminLegsOf(env)).toEqual([]);

    const removed = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(removed.status).toBe(204);
  });

  test("a key on any keyable provider approves without a model whitelist", async () => {
    const key = await createKey(admin, "openrouter", "sk-or-v1-zdr-attest");
    await addLeg(admin, key.id, "z-ai/glm-5.3-flash");

    const approved = await call(
      `/api/admin/keys/${key.id}/zdr`,
      jsonInit(
        {
          retentionSource: "https://openrouter.ai/docs/guides/features/zdr",
          verifiedAt: "2026-11-08",
        },
        admin,
      ),
    );
    expect(approved.status).toBe(200);
    const echo = AdminKeyEchoSchema.parse(await approved.json());
    expect(echo.zdrStatus).toBe("approved");

    const keyList = AdminKeyStatusSchema.array().parse(
      await (await call("/api/admin/keys", { headers: { Cookie: admin } })).json(),
    );
    expect(keyList.find((row) => row.id === key.id)?.zdrStatus).toBe("approved");

    const removed = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(removed.status).toBe(204);
  });

  test("an attested key enters the chain with the checklist snapshot in the audit log", async () => {
    const { adminLegsOf } = await import("../src/pi/credentials");
    const key = await createKey(admin, CF_WORKERS_AI, "cf-token-zdropass-002");
    await addLeg(admin, key.id, GLM_FLASH);

    const approved = await call(
      `/api/admin/keys/${key.id}/zdr`,
      jsonInit(
        {
          retentionSource: "https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/",
          verifiedAt: "2026-11-08",
        },
        admin,
      ),
    );
    expect(approved.status).toBe(200);
    const echo = AdminKeyEchoSchema.parse(await approved.json());
    expect(echo.zdrStatus).toBe("approved");
    expect(echo.zdrRetentionSource).toContain("glm-5.3-flash");
    expect(echo.zdrVerifiedAt).toBe("2026-11-08");

    const legs = await adminLegsOf(env);
    expect(legs).toEqual([
      {
        provider: CF_WORKERS_AI,
        model: GLM_FLASH,
        credential: `admin:${key.id}`,
        maxConcurrency: (await import("../src/gateway/config.gen")).gatewayConfig.adminChain.maxConcurrency,
        providerMaxConcurrency: null,
        priority: 0,
      },
    ]);

    const rows = await all<{ action: string; after_json: string }>(
      env.DB,
      "SELECT action, after_json FROM admin_actions ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]?.action).toBe("admin_key.zdr_approve");
    const after: unknown = JSON.parse(String(rows[0]?.after_json));
    expect(field(after, "zdrStatus")).toBe("approved");
    expect(field(after, "models")).toEqual([GLM_FLASH]);
    expect(JSON.stringify(rows[0])).not.toContain("cf-token");
  });

  test("re-approval is idempotent and refreshes the leg snapshot; malformed or future dates are rejected", async () => {
    const { adminLegsOf } = await import("../src/pi/credentials");
    const key = await createKey(admin, "openrouter", "sk-or-v1-zdrrepeat1");
    const firstModel = "z-ai/glm-5.3-flash";
    await addLeg(admin, key.id, firstModel);
    const legsOfKey = async () => (await adminLegsOf(env)).filter((leg) => leg.credential === `admin:${key.id}`);

    const source = {
      retentionSource: "https://openrouter.ai/docs/guides/features/zdr",
      verifiedAt: "2026-11-08",
    };
    const malformed = await call(
      `/api/admin/keys/${key.id}/zdr`,
      jsonInit({ ...source, verifiedAt: "2026-13-45" }, admin),
    );
    expect(malformed.status).toBe(422);
    const future = await call(
      `/api/admin/keys/${key.id}/zdr`,
      jsonInit({ ...source, verifiedAt: "2999-01-01" }, admin),
    );
    expect(future.status).toBe(422);
    expect(await legsOfKey()).toEqual([]);

    const first = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit(source, admin));
    expect(first.status).toBe(200);

    const secondModel = "z-ai/glm-4.7-flash";
    await addLeg(admin, key.id, secondModel);
    const again = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit(source, admin));
    expect(again.status).toBe(200);
    const echo = AdminKeyEchoSchema.parse(await again.json());
    expect(echo.zdrStatus).toBe("approved");
    expect(echo.zdrVerifiedAt).toBe("2026-11-08");

    const rows = await all<{ after_json: string }>(
      env.DB,
      "SELECT after_json FROM admin_actions WHERE action = 'admin_key.zdr_approve' ORDER BY id DESC LIMIT 1",
    );
    const after: unknown = JSON.parse(String(rows[0]?.after_json));
    expect(field(after, "models")).toEqual([firstModel, secondModel]);
    expect((await legsOfKey()).map((leg) => leg.model)).toEqual([firstModel, secondModel]);

    await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
  });
});
