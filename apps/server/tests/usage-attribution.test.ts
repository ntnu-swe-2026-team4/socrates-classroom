import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, inject } from "vitest";
import { all, run } from "../src/db/d1";
import { encryptKey } from "../src/auth-crypto";
import { recordKeyedUsage } from "../src/gateway/usage";
import { keyedCredentialStore, type DecidedCredential } from "../src/pi/credentials";
import type { UsageSample } from "../src/gateway/usage";

const migrations = inject("d1Migrations");

async function seedPools(): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO users (id, name, email, password_hash, lang, created_at)
     VALUES ('u_attr', '歸因老師', 'attr@example.com', 'x', 'zh', '2026-11-18T00:00:00.000Z')`,
  );
  await run(
    env.DB,
    `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at, monthly_quota_usd)
     VALUES ('u_attr', 'openrouter', $enc, 'tch1', 0, '2026-11-18T00:00:00.000Z', 0.1)`,
    { enc: await encryptKey(env, "sk-or-v1-teacherkey") },
  );
  await run(
    env.DB,
    `INSERT INTO admin_keys (id, provider_id, key_enc, last4, sort_order, updated_at, monthly_quota_usd)
     VALUES ('ak_attr', 'openrouter', $enc, 'adm1', 0, '2026-11-18T00:00:00.000Z', 5)`,
    { enc: await encryptKey(env, "sk-or-v1-adminkey01") },
  );
}

function sample(provider: string, costUsd: number): UsageSample {
  return {
    provider,
    model: "z-ai/glm-5.3-flash",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costUsd },
    },
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedPools();
});

describe("usage attribution by the decided credential (#356)", () => {
  it("an admin-leg turn lands in the platform pool and leaves the teacher's quota untouched", async () => {
    const before = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM teacher_key_usage WHERE user_id = 'u_attr'",
    );
    await recordKeyedUsage(env, { provider: "openrouter", credential: "admin:ak_attr" }, sample("openrouter", 3));

    const adminRows = await all<{ admin_key_id: string; cost_usd: number }>(
      env.DB,
      "SELECT admin_key_id, cost_usd FROM admin_key_usage WHERE admin_key_id = 'ak_attr'",
    );
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]?.cost_usd).toBe(3);

    const after = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM teacher_key_usage WHERE user_id = 'u_attr'",
    );
    expect(after[0]?.n).toBe(before[0]?.n ?? 0);
    const alerts = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM teacher_quota_alerts WHERE user_id = 'u_attr'",
    );
    expect(alerts[0]?.n).toBe(0);
  });

  it("a teacher-leg turn records against the teacher pool", async () => {
    await recordKeyedUsage(env, { provider: "openrouter", credential: "teacher:u_attr" }, sample("openrouter", 0.02));
    const rows = await all<{ user_id: string; cost_usd: number }>(
      env.DB,
      "SELECT user_id, cost_usd FROM teacher_key_usage WHERE user_id = 'u_attr'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost_usd).toBeCloseTo(0.02, 6);
  });

  it("a platform leg or an unknown decision records nothing in either keyed pool", async () => {
    await recordKeyedUsage(env, null, sample("openrouter", 9));
    await recordKeyedUsage(env, { provider: "workers-ai", credential: "platform" }, sample("openrouter", 9));
    const teacherRows = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM teacher_key_usage WHERE user_id = 'u_attr' AND cost_usd = 9",
    );
    const adminRows = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM admin_key_usage WHERE admin_key_id = 'ak_attr' AND cost_usd = 9",
    );
    expect(teacherRows[0]?.n ?? 0).toBe(0);
    expect(adminRows[0]?.n ?? 0).toBe(0);
  });
});

describe("keyedCredentialStore resolves by the decided credential (#356)", () => {
  const decided = (value: DecidedCredential | null) => () => value;

  it("serves the teacher's key only when the decision is that teacher's leg", async () => {
    const store = keyedCredentialStore(env, decided({ provider: "openrouter", credential: "teacher:u_attr" }));
    expect(await store.read("openrouter")).toMatchObject({ type: "api_key", key: "sk-or-v1-teacherkey" });
    expect(await store.read("deepseek")).toBeUndefined();
  });

  it("serves the admin key when the decision is that admin leg", async () => {
    const store = keyedCredentialStore(env, decided({ provider: "openrouter", credential: "admin:ak_attr" }));
    expect(await store.read("openrouter")).toMatchObject({ type: "api_key", key: "sk-or-v1-adminkey01" });
  });

  it("no decision or a provider mismatch resolves to nothing — no silent env fallback", async () => {
    const empty = keyedCredentialStore(env, decided(null));
    expect(await empty.read("openrouter")).toBeUndefined();

    const mismatch = keyedCredentialStore(env, decided({ provider: "deepseek", credential: "teacher:u_attr" }));
    expect(await mismatch.read("openrouter")).toBeUndefined();
  });

  it("lists both pools' providers for status display", async () => {
    const store = keyedCredentialStore(env, decided(null));
    const listed = await store.list();
    expect(listed).toEqual([{ providerId: "openrouter", type: "api_key" }]);
  });
});
