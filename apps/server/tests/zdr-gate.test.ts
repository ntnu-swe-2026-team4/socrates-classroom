import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { AdminKeyStatus } from "@socrates/shared";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { all } from "../src/db/d1";
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
  return (await res.json()) as { id: string };
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
    expect(await adminLegsOf(env as never)).toEqual([]);

    const anonymous = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({}));
    expect(anonymous.status).toBe(401);
    const denied = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({}, student));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe("forbidden");

    const missing = await call(
      `/api/admin/keys/ak_none/zdr`,
      jsonInit({ retentionSource: "https://example.com/privacy", verifiedAt: "2026-11-08" }, admin),
    );
    expect(missing.status).toBe(404);

    const noSource = await call(`/api/admin/keys/${key.id}/zdr`, jsonInit({ verifiedAt: "2026-11-08" }, admin));
    expect(noSource.status).toBe(422);
    expect(((await noSource.json()) as { code: string }).code).toBe("validation");
    expect(await adminLegsOf(env as never)).toEqual([]);

    const removed = await call(`/api/admin/keys/${key.id}`, { method: "DELETE", headers: { Cookie: admin } });
    expect(removed.status).toBe(204);
  });

  test("models off the 0-day whitelist are hard-blocked with a dedicated error code", async () => {
    const key = await createKey(admin, "openrouter", "sk-or-v1-notwhitelisted");
    await addLeg(admin, key.id, "z-ai/glm-5.3-flash");

    const blocked = await call(
      `/api/admin/keys/${key.id}/zdr`,
      jsonInit({ retentionSource: "https://example.com/privacy", verifiedAt: "2026-11-08" }, admin),
    );
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as { code: string; message: string };
    expect(body.code).toBe("zdr_model_unverified");
    expect(body.message).toContain("z-ai/glm-5.3-flash");

    const listed = (await (await call("/api/admin/keys", { headers: { Cookie: admin } })).json()) as AdminKeyStatus[];
    expect(listed.find((row) => row.id === key.id)?.zdrStatus).toBe("unverified");
  });

  test("a whitelisted key approves with the checklist snapshot in the audit log and enters the chain", async () => {
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
    const echo = (await approved.json()) as { zdrStatus: string; zdrRetentionSource: string; zdrVerifiedAt: string };
    expect(echo.zdrStatus).toBe("approved");
    expect(echo.zdrRetentionSource).toContain("glm-5.3-flash");
    expect(echo.zdrVerifiedAt).toBe("2026-11-08");

    const legs = await adminLegsOf(env as never);
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
    const after = JSON.parse(String(rows[0]?.after_json)) as Record<string, unknown>;
    expect(after.zdrStatus).toBe("approved");
    expect(after.models).toEqual([GLM_FLASH]);
    expect(JSON.stringify(rows[0])).not.toContain("cf-token");
  });
});
