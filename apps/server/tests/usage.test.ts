import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, inject } from "vitest";
import { all, run } from "../src/db/d1";
import type { Env } from "../src/env";
import { recordTeacherUsage } from "../src/gateway/usage";

interface SentEmail {
  to: string | { email: string; name: string } | (string | { email: string; name: string })[];
  from: string | { email: string; name: string };
  subject: string;
  text: string;
}

const THRESHOLDS = [60, 80, 100];

async function seedTeacher(id: string, quota: number | null, email: string | null): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO users (id, name, email, password_hash, lang, created_at)
     VALUES ($id, $name, $email, 'x', 'zh', '2026-11-21T00:00:00.000Z')`,
    { id, name: `額度${id}`, email },
  );
  await run(
    env.DB,
    `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at, monthly_quota_usd)
     VALUES ($id, 'openrouter', 'enc', 'zzzz', 0, '2026-11-21T00:00:00.000Z', $quota)`,
    { id, quota },
  );
}

async function monthSpend(id: string): Promise<number> {
  const rows = await all<{ spend: number }>(
    env.DB,
    `SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM teacher_key_usage WHERE user_id = $id`,
    { id },
  );
  return rows[0]?.spend ?? 0;
}

async function alertedThresholds(id: string): Promise<number[]> {
  const rows = await all<{ threshold: number }>(
    env.DB,
    "SELECT threshold FROM teacher_quota_alerts WHERE user_id = $id ORDER BY threshold",
    { id },
  );
  return rows.map((row) => row.threshold);
}

async function pendingThresholds(id: string): Promise<number[]> {
  const rows = await all<{ threshold: number }>(
    env.DB,
    "SELECT threshold FROM teacher_quota_alerts WHERE user_id = $id AND sent_at IS NULL ORDER BY threshold",
    { id },
  );
  return rows.map((row) => row.threshold);
}

const currentWindow = () => new Date().toISOString().slice(0, 7);

function sample(provider: string, costUsd: number) {
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
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

describe("teacher usage recording and quota alerts", () => {
  function mailEnv(sent: SentEmail[]): Env {
    return {
      ...env,
      SEND_EMAIL: {
        send: async (message: SentEmail) => {
          sent.push(message);
          return { messageId: "m1" };
        },
      } as never,
      ALERT_FROM_EMAIL: "noreply@socrates.g36maid.dev",
      ADMIN_ALERT_EMAIL: "admin@socrates.g36maid.dev",
    } as unknown as Env;
  }

  it("records usage for a teacher's keyed provider and ignores everything else", async () => {
    await seedTeacher("u_qa1", null, "qa1@example.com");
    const bare = env as unknown as Env;
    await recordTeacherUsage(bare, "u_qa1", sample("openrouter", 0.004));
    await recordTeacherUsage(bare, "u_qa1", sample("workers-ai", 9));

    const rows = await all<{ provider_id: string; model: string; input_tokens: number; cost_usd: number }>(
      env.DB,
      "SELECT provider_id, model, input_tokens, cost_usd FROM teacher_key_usage WHERE user_id = 'u_qa1'",
    );
    expect(rows).toEqual([
      { provider_id: "openrouter", model: "z-ai/glm-5.3-flash", input_tokens: 10, cost_usd: 0.004 },
    ]);
    expect(await monthSpend("u_qa1")).toBeCloseTo(0.004, 6);
    expect(await alertedThresholds("u_qa1")).toEqual([]);
  });

  it("crossing thresholds claims each alert once per window and emails teacher and admin", async () => {
    const sent: SentEmail[] = [];
    await seedTeacher("u_qa2", 0.1, "qa2@example.com");

    await recordTeacherUsage(mailEnv(sent), "u_qa2", sample("openrouter", 0.06));
    expect(await alertedThresholds("u_qa2")).toEqual([60]);
    expect(sent).toHaveLength(2);
    expect(sent.map((message) => message.to)).toEqual(["qa2@example.com", "admin@socrates.g36maid.dev"]);

    await recordTeacherUsage(mailEnv(sent), "u_qa2", sample("openrouter", 0.02));
    expect(await alertedThresholds("u_qa2")).toEqual([60, 80]);
    expect(sent).toHaveLength(4);

    await recordTeacherUsage(mailEnv(sent), "u_qa2", sample("openrouter", 0.02));
    expect(await alertedThresholds("u_qa2")).toEqual(THRESHOLDS);
    expect(sent).toHaveLength(6);

    await recordTeacherUsage(mailEnv(sent), "u_qa2", sample("openrouter", 0.02));
    expect(await alertedThresholds("u_qa2")).toEqual(THRESHOLDS);
    expect(sent).toHaveLength(6);
  });

  it("a single sample that jumps past several thresholds claims each crossed one", async () => {
    const sent: SentEmail[] = [];
    await seedTeacher("u_qa3", 0.1, "qa3@example.com");

    await recordTeacherUsage(mailEnv(sent), "u_qa3", sample("openrouter", 0.085));
    expect(await alertedThresholds("u_qa3")).toEqual([60, 80]);
    expect(sent).toHaveLength(4);
  });

  it("keeps the claim but skips the email path when the binding is absent", async () => {
    await seedTeacher("u_qa4", 0.1, "qa4@example.com");
    const withoutBinding = { ...env } as unknown as Env;
    delete withoutBinding.SEND_EMAIL;

    await expect(recordTeacherUsage(withoutBinding, "u_qa4", sample("openrouter", 0.06))).resolves.toBeUndefined();
    expect(await alertedThresholds("u_qa4")).toEqual([60]);
  });

  it("re-arms the threshold when the send fails", async () => {
    await seedTeacher("u_qa5", 0.1, "qa5@example.com");
    const failing = mailEnv([]);
    failing.SEND_EMAIL = {
      send: async () => {
        throw new Error("E_RATE_LIMIT_EXCEEDED");
      },
    } as never;

    await expect(recordTeacherUsage(failing, "u_qa5", sample("openrouter", 0.06))).resolves.toBeUndefined();
    expect(await alertedThresholds("u_qa5")).toEqual([]);

    const sent: SentEmail[] = [];
    await recordTeacherUsage(mailEnv(sent), "u_qa5", sample("openrouter", 0.01));
    expect(await alertedThresholds("u_qa5")).toEqual([60]);
    expect(sent).toHaveLength(2);
  });

  it("re-arms the threshold when the recipient lookup fails", async () => {
    await seedTeacher("u_qa6", 0.1, "qa6@example.com");
    const sent: SentEmail[] = [];
    const brokenUsersDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("FROM users")) throw new Error("D1_ERROR");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const broken = { ...mailEnv(sent), DB: brokenUsersDb } as unknown as Env;

    await expect(recordTeacherUsage(broken, "u_qa6", sample("openrouter", 0.06))).resolves.toBeUndefined();
    expect(await alertedThresholds("u_qa6")).toEqual([]);
    expect(sent).toHaveLength(0);

    await recordTeacherUsage(mailEnv(sent), "u_qa6", sample("openrouter", 0.01));
    expect(await alertedThresholds("u_qa6")).toEqual([60]);
    expect(sent).toHaveLength(2);
  });

  it("retries an orphaned pending claim once its lease expires", async () => {
    const sent: SentEmail[] = [];
    await seedTeacher("u_qa7", 0.1, "qa7@example.com");
    await run(
      env.DB,
      `INSERT INTO teacher_quota_alerts (user_id, provider_id, window, threshold, claimed_at)
       VALUES ($uid, 'openrouter', $win, 60, $stale)`,
      { uid: "u_qa7", win: currentWindow(), stale: "2026-11-01T00:00:00.000Z" },
    );

    await recordTeacherUsage(mailEnv(sent), "u_qa7", sample("openrouter", 0.06));
    expect(sent).toHaveLength(2);
    expect(await pendingThresholds("u_qa7")).toEqual([]);

    await recordTeacherUsage(mailEnv(sent), "u_qa7", sample("openrouter", 0.01));
    expect(sent).toHaveLength(2);
    expect(await alertedThresholds("u_qa7")).toEqual([60]);
  });

  it("leaves a pending claim alone while its lease is live", async () => {
    const sent: SentEmail[] = [];
    await seedTeacher("u_qa8", 0.1, "qa8@example.com");
    await run(
      env.DB,
      `INSERT INTO teacher_quota_alerts (user_id, provider_id, window, threshold, claimed_at)
       VALUES ($uid, 'openrouter', $win, 60, $now)`,
      { uid: "u_qa8", win: currentWindow(), now: new Date().toISOString() },
    );

    await recordTeacherUsage(mailEnv(sent), "u_qa8", sample("openrouter", 0.06));
    expect(sent).toHaveLength(0);
    expect(await pendingThresholds("u_qa8")).toEqual([60]);
  });

  it("re-arms an orphaned claim when the retry announce fails", async () => {
    await seedTeacher("u_qa9", 0.1, "qa9@example.com");
    await run(
      env.DB,
      `INSERT INTO teacher_quota_alerts (user_id, provider_id, window, threshold, claimed_at)
       VALUES ($uid, 'openrouter', $win, 60, $stale)`,
      { uid: "u_qa9", win: currentWindow(), stale: "2026-11-01T00:00:00.000Z" },
    );
    const failing = mailEnv([]);
    failing.SEND_EMAIL = {
      send: async () => {
        throw new Error("E_RATE_LIMIT_EXCEEDED");
      },
    } as never;

    await expect(recordTeacherUsage(failing, "u_qa9", sample("openrouter", 0.06))).resolves.toBeUndefined();
    expect(await alertedThresholds("u_qa9")).toEqual([]);

    const sent: SentEmail[] = [];
    await recordTeacherUsage(mailEnv(sent), "u_qa9", sample("openrouter", 0.01));
    expect(await alertedThresholds("u_qa9")).toEqual([60]);
    expect(sent).toHaveLength(2);
  });
});
