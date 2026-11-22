import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { inject } from "vitest";
import { all, run } from "../src/db/d1";

const migrations = inject("d1Migrations");

describe("migration 011: facebook identity (#207)", () => {
  it("drops the google-only provider CHECK and keeps rows plus cascade", async () => {
    const base = migrations.filter((migration) => !/^(003|008|010|011)/.test(migration.name));
    const widen = migrations.filter((migration) => migration.name.startsWith("011"));
    expect(widen).toHaveLength(1);
    await applyD1Migrations(env.DB, base);

    const at = "2026-11-21T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, role, email, password_hash, lang, created_at)
       VALUES ('u_g11', '原google戶', 'student', 'g11@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
       VALUES ('google', 'g-11', 'u_g11', 'g11@example.com', $at)`,
      { at },
    );

    await applyD1Migrations(env.DB, widen);

    const survivor = await all<{ provider: string; provider_user_id: string }>(
      env.DB,
      "SELECT provider, provider_user_id FROM user_identities WHERE user_id = 'u_g11'",
    );
    expect(survivor).toEqual([{ provider: "google", provider_user_id: "g-11" }]);

    await run(
      env.DB,
      `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
       VALUES ('facebook', 'fb-1', 'u_g11', NULL, $at)`,
      { at },
    );

    await run(env.DB, "DELETE FROM users WHERE id = 'u_g11'");
    const after = await all<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM user_identities");
    expect(after).toEqual([{ n: 0 }]);
  });
});

describe("migration 010: retire capability (no-mode, #210)", () => {
  it("drops can_manage_classes and the legacy role column from users", async () => {
    const base = migrations.filter((migration) => !/^(003|008|010)/.test(migration.name));
    const retire = migrations.filter((migration) => migration.name.startsWith("010"));
    expect(retire).toHaveLength(1);
    await applyD1Migrations(env.DB, base);

    const at = "2026-11-21T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, role, email, password_hash, lang, created_at, can_manage_classes, is_admin)
       VALUES ('u_legacy', '舊老師', 'teacher', 'legacy@example.com', 'x', 'zh', $at, 1, 0)`,
      { at },
    );

    await applyD1Migrations(env.DB, retire);

    const columns = await all<{ name: string }>(env.DB, "PRAGMA table_info(users)");
    const names = columns.map((column) => column.name);
    expect(names).not.toContain("can_manage_classes");
    expect(names).not.toContain("role");

    const survivor = await all<{ name: string; is_admin: number }>(
      env.DB,
      "SELECT name, is_admin FROM users WHERE id = 'u_legacy'",
    );
    expect(survivor).toEqual([{ name: "舊老師", is_admin: 0 }]);
  });
});

describe("migration 008: teacher key models", () => {
  it("splits the per-provider model into (provider, model) legs with their own max_concurrency", async () => {
    const legacy = migrations.filter((migration) => !/^(003|008)/.test(migration.name));
    const split = migrations.filter((migration) => migration.name.startsWith("008"));
    expect(split).toHaveLength(1);
    await applyD1Migrations(env.DB, legacy);

    const at = "2026-11-18T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_t8', '金鑰老師', 't8@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, model, sort_order, updated_at)
       VALUES ('u_t8', 'openrouter', 'enc', 'zzzz', 'z-ai/glm-5.3-flash', 3, $at)`,
      { at },
    );

    await applyD1Migrations(env.DB, split);

    const legs = await all<{
      user_id: string;
      provider_id: string;
      model: string;
      max_concurrency: number | null;
      sort_order: number;
    }>(env.DB, "SELECT user_id, provider_id, model, max_concurrency, sort_order FROM teacher_key_models");
    expect(legs).toEqual([
      { user_id: "u_t8", provider_id: "openrouter", model: "z-ai/glm-5.3-flash", max_concurrency: null, sort_order: 0 },
    ]);

    const columns = await all<{ name: string }>(env.DB, "PRAGMA table_info(teacher_keys)");
    expect(columns.map((column) => column.name)).not.toContain("model");
    expect(columns.map((column) => column.name)).toContain("max_concurrency");

    const existing = await all<{ max_concurrency: number | null }>(
      env.DB,
      "SELECT max_concurrency FROM teacher_keys WHERE user_id = 'u_t8'",
    );
    expect(existing).toEqual([{ max_concurrency: null }]);

    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at, max_concurrency)
       VALUES ('u_t8', 'deepseek', 'enc', 'aaaa', 1, $at, 6)`,
      { at },
    );
    const fresh = await all<{ max_concurrency: number | null }>(
      env.DB,
      "SELECT max_concurrency FROM teacher_keys WHERE user_id = 'u_t8' AND provider_id = 'deepseek'",
    );
    expect(fresh).toEqual([{ max_concurrency: 6 }]);
  });
});
describe("migration 009: teacher key usage ledger and quota alerts", () => {
  it("adds a nullable monthly quota to teacher_keys and creates usage/alerts tables keyed to the key row", async () => {
    const base = migrations.filter((migration) => !/^(003|009)/.test(migration.name));
    const usage = migrations.filter((migration) => migration.name.startsWith("009"));
    expect(usage).toHaveLength(1);
    await applyD1Migrations(env.DB, base);

    const at = "2026-11-21T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_ta', '額度老師', 'ta@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
       VALUES ('u_ta', 'openrouter', 'enc', 'zzzz', 0, $at)`,
      { at },
    );

    await applyD1Migrations(env.DB, usage);

    const existing = await all<{ monthly_quota_usd: number | null }>(
      env.DB,
      "SELECT monthly_quota_usd FROM teacher_keys WHERE user_id = 'u_ta'",
    );
    expect(existing).toEqual([{ monthly_quota_usd: null }]);

    await run(
      env.DB,
      `INSERT INTO teacher_key_usage (user_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed)
       VALUES ('u_ta', 'openrouter', 'z-ai/glm-5.3-flash', 10, 5, 15, 0.003, 0)`,
    );
    const usageRow = await all<{ model: string; cost_usd: number }>(
      env.DB,
      "SELECT model, cost_usd FROM teacher_key_usage",
    );
    expect(usageRow).toEqual([{ model: "z-ai/glm-5.3-flash", cost_usd: 0.003 }]);

    const insertAlert = () =>
      run(
        env.DB,
        `INSERT OR IGNORE INTO teacher_quota_alerts (user_id, provider_id, window, threshold)
         VALUES ('u_ta', 'openrouter', '2026-11', 60)`,
      );
    await insertAlert();
    await insertAlert();
    const alerts = await all<{ window: string; threshold: number }>(
      env.DB,
      "SELECT window, threshold FROM teacher_quota_alerts",
    );
    expect(alerts).toEqual([{ window: "2026-11", threshold: 60 }]);

    await run(env.DB, "DELETE FROM users WHERE id = 'u_ta'");
    const orphaned = await all<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM teacher_key_usage");
    expect(orphaned).toEqual([{ n: 0 }]);
    const orphanedAlerts = await all<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM teacher_quota_alerts");
    expect(orphanedAlerts).toEqual([{ n: 0 }]);
  });
});

describe("migration 003: activity participant backfill", () => {
  it("existing members become member participants and keep their pseudonyms", async () => {
    const legacy = migrations.filter((migration) => !migration.name.startsWith("003"));
    const backfill = migrations.filter((migration) => migration.name.startsWith("003"));
    expect(backfill).toHaveLength(1);
    await applyD1Migrations(env.DB, legacy);

    const at = "2026-11-15T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_t', '林老師', 't@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_s', '王小明', 's@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at)
       VALUES ('c1', '班', 'u_t', 'code-1', 'a2', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO topics (id, owner_id, title, statement, prompts, created_at)
       VALUES ('t1', NULL, '題目', '陳述', '["問"]', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ('a1', 'c1', 't1', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ('a2', 'c1', 't1', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at)
       VALUES ('c1', 'u_s', '王小明', $at, $at)`,
      { at },
    );
    await run(env.DB, `INSERT INTO pseudonyms (activity_id, student_id, pseudonym) VALUES ('a1', 'u_s', '學生1')`);

    await applyD1Migrations(env.DB, backfill);

    const participants = await all<{
      activity_id: string;
      id: string;
      user_id: string;
      kind: string;
      display_name: string;
    }>(env.DB, "SELECT activity_id, id, user_id, kind, display_name FROM activity_participants ORDER BY activity_id");
    expect(participants).toEqual([
      { activity_id: "a1", id: "u_s", user_id: "u_s", kind: "member", display_name: "王小明" },
      { activity_id: "a2", id: "u_s", user_id: "u_s", kind: "member", display_name: "王小明" },
    ]);

    const pseudonyms = await all<{ activity_id: string; participant_id: string; pseudonym: string }>(
      env.DB,
      "SELECT activity_id, participant_id, pseudonym FROM pseudonyms",
    );
    expect(pseudonyms).toEqual([{ activity_id: "a1", participant_id: "u_s", pseudonym: "學生1" }]);
  });

  it("deleting the user keeps the participant (report link) and drops only its user_id", async () => {
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_gone', '離場者', 'gone@example.com', 'x', 'zh', '2026-11-15T00:00:00.000Z')`,
    );
    await run(
      env.DB,
      `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
       VALUES ('a1', 'p_gone', 'u_gone', 'member', '離場者', NULL, '2026-11-15T00:00:00.000Z')`,
    );
    await run(
      env.DB,
      `INSERT INTO pseudonyms (activity_id, participant_id, pseudonym) VALUES ('a1', 'p_gone', '學生2')`,
    );

    await run(env.DB, "DELETE FROM users WHERE id = 'u_gone'");

    const participant = await all<{ id: string; user_id: string | null }>(
      env.DB,
      "SELECT id, user_id FROM activity_participants WHERE id = 'p_gone'",
    );
    expect(participant).toEqual([{ id: "p_gone", user_id: null }]);
    const pseudonym = await all<{ pseudonym: string }>(
      env.DB,
      "SELECT pseudonym FROM pseudonyms WHERE participant_id = 'p_gone'",
    );
    expect(pseudonym).toEqual([{ pseudonym: "學生2" }]);
  });
});

describe("migration 007: user identities", () => {
  it("provider identity is unique and cascades with its user", async () => {
    expect(migrations.some((migration) => migration.name === "007_user_identities.sql")).toBe(true);

    const at = "2026-11-15T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_oid', 'OAuth生', 'oid@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
       VALUES ('google', 'sub-1', 'u_oid', 'oid@example.com', $at)`,
      { at },
    );

    await expect(
      run(
        env.DB,
        `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
         VALUES ('google', 'sub-1', 'u_oid', 'again@example.com', $at)`,
        { at },
      ),
    ).rejects.toThrow();
    await expect(
      run(
        env.DB,
        `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
         VALUES ('google', 'sub-2', 'u_missing', 'x@example.com', $at)`,
        { at },
      ),
    ).rejects.toThrow();

    await run(env.DB, "DELETE FROM users WHERE id = 'u_oid'");
    const identities = await all<{ provider: string }>(
      env.DB,
      "SELECT provider FROM user_identities WHERE user_id = 'u_oid'",
    );
    expect(identities).toEqual([]);
  });
});

describe("migration 013: solo threads (#281)", () => {
  it("creates solo_threads table with user foreign key cascade", async () => {
    expect(migrations.some((migration) => migration.name === "013_solo_threads.sql")).toBe(true);

    const at = "2026-11-22T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_solo_m', '單人使用者', 'solo_m@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO solo_threads (id, user_id, title, created_at, updated_at)
       VALUES ('solo_m1', 'u_solo_m', '測試題目', $at, $at)`,
      { at },
    );

    const threads = await all<{ id: string; title: string }>(
      env.DB,
      "SELECT id, title FROM solo_threads WHERE user_id = 'u_solo_m'",
    );
    expect(threads).toEqual([{ id: "solo_m1", title: "測試題目" }]);

    await run(env.DB, "DELETE FROM users WHERE id = 'u_solo_m'");
    const after = await all<{ id: string }>(env.DB, "SELECT id FROM solo_threads WHERE user_id = 'u_solo_m'");
    expect(after).toEqual([]);
  });
});
