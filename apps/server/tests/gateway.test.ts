import { fakeEnv, must, scopedEnv, symbolValue } from "./helpers";
import { afterEach, describe, expect, it, inject } from "vitest";
import { env } from "cloudflare:workers";
import {
  evictAllDurableObjects,
  listDurableObjectIds,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { GatewayLedger } from "../src/gateway/ledger";
import { run } from "../src/db/d1";
import type { Env } from "../src/env";
import type { LedgerKey } from "../src/gateway/gateway-schema";

const fakeAi = { run: async () => ({}), toMarkdown: async () => ({ format: "markdown", markdown: "" }) };

const ledgerEnv = (overrides: Record<string, unknown> = {}): Env => scopedEnv({ AI: fakeAi, ...overrides });

const ledgerShard = (name: string) => {
  const namespace = must(env.RoutingLedger, "RoutingLedger binding");
  return namespace.get(namespace.idFromName(name));
};

afterEach(async () => {
  const namespace = must(env.RoutingLedger, "RoutingLedger binding");
  for (const id of await listDurableObjectIds(namespace)) {
    await runInDurableObject(namespace.get(id), async (_instance, state) => {
      await state.storage.deleteAll();
    });
  }
  await evictAllDurableObjects();
});

describe("gateway ledger (pi has no structured error state → records ok/error only; consecutive errors trigger cooldown)", () => {
  const key = { provider: "dgx-spark", model: "GLM-5.3-Flash", credential: "platform" };

  it("cooldown expires naturally without probing", () => {
    const ledger = new GatewayLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger.record(key);
      ledger.settle(key, "error");
    }
    expect(ledger.inCooldown(key)).toBe(true);
    expect(ledger.inCooldown(key, Date.now() + 61_000)).toBe(false);
  });

  it("five consecutive errors open a cooldown; ok resets the failure count", () => {
    const ledger = new GatewayLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger.record(key);
      ledger.settle(key, "error");
    }
    expect(ledger.inCooldown(key)).toBe(true);

    const ledger2 = new GatewayLedger();
    for (let i = 0; i < 4; i += 1) {
      ledger2.record(key);
      ledger2.settle(key, "error");
    }
    ledger2.record(key);
    ledger2.settle(key, "ok");
    for (let i = 0; i < 4; i += 1) {
      ledger2.record(key);
      ledger2.settle(key, "error");
    }
    expect(ledger2.inCooldown(key)).toBe(false);
  });

  it("begin/end bracket inFlight; settle decrements the concurrency count", () => {
    const ledger = new GatewayLedger();
    ledger.begin(key);
    ledger.begin(key);
    expect(ledger.inFlight(key)).toBe(2);
    ledger.settle(key, "ok");
    expect(ledger.inFlight(key)).toBe(1);
    ledger.settle(key, "error");
    expect(ledger.inFlight(key)).toBe(0);
  });
});

describe("router chain walk (config-driven, cooldown-filtered)", () => {
  it("mock env (no AI binding, no DGX URL): empty chain → pick returns null", async () => {
    const { Router } = await import("../src/gateway/router");
    const env = fakeEnv({ LLM_PROVIDER: "mock" });
    const router = new Router(env);
    await expect(router.pick("interactive")).resolves.toBeNull();
  });

  it("config: workers-ai is one provider with two model entries, priority ordering correct", async () => {
    const { gatewayConfig } = await import("../src/gateway/config.gen");
    const wa = gatewayConfig.providers["workers-ai"];
    expect(wa?.kind).toBe("binding");
    expect(wa?.models?.map((m) => m.id)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    const waEntries = gatewayConfig.defaults.availability.filter((e) => e.provider === "workers-ai");
    expect(waEntries.map((e) => e.model)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    expect(must(waEntries[0], "first workers-ai leg").priority).toBeLessThan(
      must(waEntries[1], "second workers-ai leg").priority,
    );
  });

  it("ledger unit = (provider, model, credential) — same provider, different models, accounted separately", async () => {
    const { ledgerKey } = await import("../src/gateway/gateway-schema");
    const cfg = (await import("../src/gateway/config.gen")).gatewayConfig;
    const def = must(cfg.providers["workers-ai"], "workers-ai provider def");
    const flash = ledgerKey(
      { ...must(cfg.defaults.availability[0], "first availability"), credential: "teacher:t_unit_models" },
      def,
    );
    const free = ledgerKey(
      { ...must(cfg.defaults.availability[1], "second availability"), credential: "teacher:t_unit_models" },
      def,
    );
    const stub = ledgerShard("teacher:t_unit_models");
    const only = (key: LedgerKey) => [{ key, maxConcurrency: 1 }];
    expect(await stub.reserve(only(flash))).not.toBeNull();
    expect(await stub.reserve(only(flash))).toBeNull();
    expect(await stub.reserve(only(free))).not.toBeNull();
    expect(await stub.admit(only(flash))).toEqual([false]);
  });
});

describe("teacherLegsOf (#152: one leg per (provider, model), each its own max_concurrency)", () => {
  it("joins keys and model legs: order = provider sort_order then model sort_order; NULL limit falls back to the config default", async () => {
    const { env } = await import("cloudflare:workers");
    const { applyD1Migrations } = await import("cloudflare:test");
    const { teacherLegsOf } = await import("../src/pi/credentials");
    const { gatewayConfig } = await import("../src/gateway/config.gen");
    await applyD1Migrations(env.DB, inject("d1Migrations"));

    const at = "2026-11-18T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_legs', '腿老師', 'legs@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
       VALUES ('u_legs', 'openrouter', 'enc', 'zzzz', 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at, max_concurrency)
       VALUES ('u_legs', 'deepseek', 'enc', 'aaaa', 1, $at, 6)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('u_legs', 'openrouter', 'z-ai/glm-5.3-flash', NULL, 1, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('u_legs', 'openrouter', 'z-ai/glm-4.7-flash', 2, 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('u_legs', 'deepseek', 'glm-4.6', NULL, 0, $at)`,
      { at },
    );

    const legs = await teacherLegsOf(env, "u_legs");
    const fallback = gatewayConfig.teacherChain.maxConcurrency;
    expect(legs).toEqual([
      {
        provider: "openrouter",
        model: "z-ai/glm-4.7-flash",
        credential: "teacher:u_legs",
        maxConcurrency: 2,
        priority: 0,
        providerMaxConcurrency: null,
      },
      {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        credential: "teacher:u_legs",
        maxConcurrency: fallback,
        priority: 0,
        providerMaxConcurrency: null,
      },
      {
        provider: "deepseek",
        model: "glm-4.6",
        credential: "teacher:u_legs",
        maxConcurrency: fallback,
        priority: 0,
        providerMaxConcurrency: 6,
      },
    ]);
  }, 60_000);

  it("a teacher with no keys yields no legs", async () => {
    const { env } = await import("cloudflare:workers");
    const { applyD1Migrations } = await import("cloudflare:test");
    const { teacherLegsOf } = await import("../src/pi/credentials");
    await applyD1Migrations(env.DB, inject("d1Migrations"));
    expect(await teacherLegsOf(env, "u_nobody")).toEqual([]);
  }, 60_000);
});

describe("provider aggregate cap (#152 follow-up: teacher_keys.max_concurrency bounds all of a provider's legs together)", () => {
  const legs = (providerMaxConcurrency: number | null) => [
    {
      provider: "openrouter",
      model: "z-ai/glm-4.7-flash",
      credential: "teacher:t_cap",
      maxConcurrency: 4,
      priority: 0,
      providerMaxConcurrency,
    },
    {
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      credential: "teacher:t_cap",
      maxConcurrency: 4,
      priority: 1,
      providerMaxConcurrency,
    },
  ];

  const own = (leg: { provider: string }) => leg.provider === "openrouter" || leg.provider === "deepseek";

  it("chain skips a provider's legs once their combined in-flight hits the provider cap; null cap never binds", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());

    const capped = legs(2);
    expect(await router.pick("interactive", own, capped)).not.toBeNull();
    expect(await router.pick("interactive", own, capped)).not.toBeNull();
    expect(await router.pick("interactive", own, capped)).toBeNull();

    const uncapped = legs(null);
    expect(await router.pick("interactive", own, uncapped)).not.toBeNull();
    expect(await router.pick("interactive", own, uncapped)).not.toBeNull();
    expect(await router.pick("interactive", own, uncapped)).not.toBeNull();
    expect(await router.pick("interactive", own, uncapped)).not.toBeNull();
  });

  it("budget = sum over providers of min(sum of legs, provider cap)", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    const capped = legs(2);
    const other = [
      { provider: "deepseek", model: "glm-4.6", credential: "teacher:t_cap", maxConcurrency: 2, priority: 2 },
    ];
    expect(await router.budget("interactive", [...capped, ...other], own)).toBe(4);
    expect(await router.budget("interactive", [...legs(null), ...other], own)).toBe(10);
  });
});

describe("teacher legs (#82: teacher keys first, platform chain as fallback)", () => {
  const teacherLeg = {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    credential: "teacher:u_teacher",
    maxConcurrency: 4,
    priority: 0,
  };

  it("teacher leg precedes the platform chain; canServe rejection falls through to the platform chain", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv({ DGX_BASE_URL: "http://spark:8888/v1" }));
    const chain = await router.chain("interactive", undefined, [teacherLeg]);
    expect(must(chain[0], "first chain leg")).toMatchObject({
      provider: "openrouter",
      credential: "teacher:u_teacher",
    });
    expect(must(chain[1], "second chain leg").provider).toBe("workers-ai");

    const blocked = await router.chain("interactive", () => false, [teacherLeg]);
    expect(blocked.every((e) => e.credential !== "teacher:u_teacher")).toBe(true);
  });

  it("cooldown filters Router.chain: a leg with five straight failures is evicted, the next leg takes over", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    const failed: { entry: { provider: string; credential: string }; model: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const decision = must(await router.pick("interactive"), "interactive decision");
      failed.push(decision);
      await router.settle(decision, "error");
    }
    const cooled = must(failed[0], "first failed decision");
    const chain = await router.chain("interactive");
    expect(chain.some((e) => e.provider === cooled.entry.provider && e.model === cooled.model)).toBe(false);
    expect(chain.length).toBeGreaterThan(0);
  });

  it("teacher leg is accounted independently: its cooldown does not affect the platform chain", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    for (let i = 0; i < 5; i += 1) {
      const decision = must(await router.pick("interactive", undefined, [teacherLeg]), "interactive teacher decision");
      expect(decision.key.credential).toBe("teacher:u_teacher");
      await router.settle(decision, "error");
    }
    const platform = must(await router.pick("interactive", undefined, [teacherLeg]), "fallback decision");
    expect(platform.key.credential).toBe("platform");
  });
});

describe("dialogue run fallback legs (models.ts wiring)", () => {
  it("with AI binding: the head model in the registry carries the fallback symbol (wrapped by the provider catalog)", async () => {
    const { buildModels } = await import("../src/pi/models");
    const fakeAi = {
      run: async () => ({}),
      toMarkdown: async () => ({ format: "markdown", markdown: "" }),
    };
    const bundle = buildModels(fakeEnv({ AI: fakeAi }));
    const model = bundle.models.getModel("cloudflare", "@cf/zai-org/glm-5.3-flash");
    expect(model).toBeDefined();
    // agents' MODEL_OPTIONS symbol: fallback legs are bound on the model object
    const OPTIONS = Symbol.for("agents.models.pi-ai.options");
    const options = symbolValue<{ fallback?: string[] }>(must(model, "workers-ai model"), OPTIONS);
    expect(options?.fallback).toEqual(["@cf/zai-org/glm-4.7-flash"]);
  }, 20_000);

  it("mock mode: faux has no fallback (the faux model bypasses createAI)", async () => {
    const { buildModels } = await import("../src/pi/models");
    const bundle = buildModels(fakeEnv({ LLM_PROVIDER: "mock" }));
    expect(bundle.faux).toBeDefined();
    const model = bundle.models.getModel("faux", "faux-1");
    expect(model).toBeDefined();
  });
});

describe("gateway schema (availability reference validation — typos fail fast instead of silently dropping a leg)", () => {
  const base = {
    providers: {
      "workers-ai": { kind: "binding", models: [{ id: "@cf/zai-org/glm-4.7-flash" }] },
    },
    classifiers: { emotion: "@cf/cloudflare/clef-flash", violation: "@cf/cloudflare/clef-flash" },
    voice: { stt: "@cf/openai/whisper-large-v3-turbo", tts: "@cf/myshell-ai/melotts" },
    report: {
      studentAttempts: 2,
      alarmAttempts: 3,
      alarmBackoffMs: 4000,
      alarmTimeoutMs: 300000,
      pseudonymPrefix: "學生",
      axes: "both",
    },
    teacherChain: { maxConcurrency: 4 },
    adminChain: { maxConcurrency: 4 },
    trafficClasses: {},
  };

  it("reference to a nonexistent provider → parse rejects", async () => {
    const { GatewayConfigSchema } = await import("../src/gateway/gateway-schema");
    const result = GatewayConfigSchema.safeParse({
      ...base,
      defaults: { availability: [{ provider: "typo-name", credential: "platform", maxConcurrency: 1, priority: 1 }] },
    });
    expect(result.success).toBe(false);
  });

  it("reference to a model the provider does not offer → parse rejects", async () => {
    const { GatewayConfigSchema } = await import("../src/gateway/gateway-schema");
    const result = GatewayConfigSchema.safeParse({
      ...base,
      defaults: {
        availability: [
          {
            provider: "workers-ai",
            model: "@cf/zai-org/nonexistent",
            credential: "platform",
            maxConcurrency: 1,
            priority: 1,
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("classifier/voice binding ids: typo or missing key fails fast", async () => {
    const { GatewayConfigSchema } = await import("../src/gateway/gateway-schema");
    const typoed = GatewayConfigSchema.safeParse({
      ...base,
      classifiers: { emotion: "clef-flash", violation: "@cf/cloudflare/clef-flash" },
    });
    expect(typoed.success).toBe(false);
    const missing = GatewayConfigSchema.safeParse({
      ...base,
      classifiers: { emotion: "@cf/cloudflare/clef-flash" },
    });
    expect(missing.success).toBe(false);
    const invalidAxes = GatewayConfigSchema.safeParse({
      ...base,
      report: { ...base.report, axes: "invalid" },
      defaults: {
        availability: [
          {
            provider: "workers-ai",
            model: "@cf/zai-org/glm-4.7-flash",
            credential: "platform",
            maxConcurrency: 1,
            priority: 1,
          },
        ],
      },
    });
    expect(invalidAxes.success).toBe(false);
  });

  it("valid references → parse passes", async () => {
    const { GatewayConfigSchema } = await import("../src/gateway/gateway-schema");
    const result = GatewayConfigSchema.safeParse({
      ...base,
      defaults: {
        availability: [
          {
            provider: "workers-ai",
            model: "@cf/zai-org/glm-4.7-flash",
            credential: "platform",
            maxConcurrency: 1,
            priority: 1,
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("Router.withRoute (reservation → verdict lifecycle; ConversationBusy must not leak the slot)", () => {
  const legs = (maxConcurrency: number) => [
    {
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      credential: "teacher:t_withroute",
      maxConcurrency,
      priority: 0,
    },
  ];
  const own = (entry: { provider: string }) => entry.provider === "openrouter";

  it("ConversationBusy releases the slot without recording a failure", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    for (let i = 0; i < 6; i += 1) {
      const decision = must(await router.pick("interactive", own, legs(1)), "interactive decision");
      const busy = new Error("conversation busy");
      busy.name = "ConversationBusy";
      await expect(router.withRoute(decision, () => Promise.reject(busy))).rejects.toThrow();
    }
    expect(await router.pick("interactive", own, legs(1))).not.toBeNull();
  });

  it("a real failure settles as error: five straight failures cool the leg down", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    for (let i = 0; i < 5; i += 1) {
      const decision = must(await router.pick("interactive", own, legs(1)), "interactive decision");
      await expect(router.withRoute(decision, () => Promise.reject(new Error("boom")))).rejects.toThrow();
    }
    await expect(router.chain("interactive", own, legs(1))).resolves.toEqual([]);
  });

  it("success path leaves the slot to the caller's settle", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    const decision = must(await router.pick("interactive", own, legs(1)), "interactive decision");
    await expect(router.withRoute(decision, () => Promise.resolve("receipt"))).resolves.toBe("receipt");
    expect(await router.pick("interactive", own, legs(1))).toBeNull();
    await router.settle(decision, "ok");
    expect(await router.pick("interactive", own, legs(1))).not.toBeNull();
  });
});

describe("RoutingLedger DO (real DO: limits and cooldowns are exact across isolates)", () => {
  const leg = (model: string, maxConcurrency: number, providerMaxConcurrency: number | null = null) => [
    {
      provider: "openrouter",
      model,
      credential: "teacher:t_fleet",
      maxConcurrency,
      priority: 0,
      providerMaxConcurrency,
    },
  ];
  const twoLegs = (maxConcurrency: number, providerMaxConcurrency: number | null = null) => [
    ...leg("z-ai/glm-4.7-flash", maxConcurrency, providerMaxConcurrency),
    { ...must(leg("z-ai/glm-5.3-flash", maxConcurrency, providerMaxConcurrency)[0], "second leg"), priority: 1 },
  ];
  const own = (entry: { provider: string }) => entry.provider === "openrouter";

  it("two Router instances (= two isolates) cannot overshoot one leg's maxConcurrency", async () => {
    const { Router } = await import("../src/gateway/router");
    const isolateA = new Router(ledgerEnv());
    const isolateB = new Router(ledgerEnv());
    const legs = leg("z-ai/glm-4.7-flash", 2);
    expect(await isolateA.pick("interactive", own, legs)).not.toBeNull();
    expect(await isolateB.pick("interactive", own, legs)).not.toBeNull();
    expect(await isolateA.pick("interactive", own, legs)).toBeNull();
    expect(await isolateB.pick("interactive", own, legs)).toBeNull();
  });

  it("the per-provider cap spans both legs and both isolates", async () => {
    const { Router } = await import("../src/gateway/router");
    const isolateA = new Router(ledgerEnv());
    const isolateB = new Router(ledgerEnv());
    expect(await isolateA.pick("interactive", own, twoLegs(4, 2))).not.toBeNull();
    expect(await isolateB.pick("interactive", own, twoLegs(4, 2))).not.toBeNull();
    expect(await isolateA.pick("interactive", own, twoLegs(4, 2))).toBeNull();
    expect(await isolateB.pick("interactive", own, twoLegs(4, 2))).toBeNull();
  });

  it("cooldown learned in one isolate filters the chain in another", async () => {
    const { Router } = await import("../src/gateway/router");
    const isolateA = new Router(ledgerEnv());
    const isolateB = new Router(ledgerEnv());
    for (let i = 0; i < 5; i += 1) {
      const decision = must(await isolateA.pick("interactive", own, twoLegs(4)), "teacher decision");
      await isolateA.settle(decision, "error");
    }
    const chain = await isolateB.chain("interactive", own, twoLegs(4));
    expect(chain.map((entry) => entry.model)).toEqual(["z-ai/glm-5.3-flash"]);
  });

  it("an expired lease is reclaimed by the alarm sweeper after a caller crash", async () => {
    const key = { provider: "openrouter", model: "z-ai/glm-5.3-flash", credential: "teacher:t_crash" };
    const candidate = [{ key, maxConcurrency: 1 }];
    const stub = ledgerShard("teacher:t_crash");
    expect(await stub.reserve(candidate, 50)).not.toBeNull();
    expect(await stub.reserve(candidate, 50)).toBeNull();
    expect((await stub.status(key)).inFlight).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await runDurableObjectAlarm(stub);
    expect((await stub.status(key)).inFlight).toBe(0);
    expect((await stub.status(key)).leases).toBe(0);
    expect(await stub.reserve(candidate, 50)).not.toBeNull();
  });

  it("fail-open: an unreachable ledger routes unaccounted instead of failing", async () => {
    const { Router } = await import("../src/gateway/router");
    const down = () => Promise.reject(new Error("ledger down"));
    const broken = { idFromName: (name: string) => name, get: () => ({ admit: down, reserve: down }) };
    const router = new Router(ledgerEnv({ RoutingLedger: broken }));
    const legs = leg("z-ai/glm-4.7-flash", 1);
    const decision = must(await router.pick("interactive", own, legs), "fail-open decision");
    expect(decision.lease).toBeNull();
    expect(await router.pick("interactive", own, legs)).not.toBeNull();
    await expect(router.settle(decision, "error")).resolves.toBeUndefined();
    await expect(router.chain("interactive", own, legs)).resolves.toHaveLength(1);
  });

  it("fail-open: budget degrades to 0 (report-runner falls back to its fixed batch) and settle failures are swallowed", async () => {
    const { Router } = await import("../src/gateway/router");
    const broken = {
      idFromName: (name: string) => name,
      get: () => ({
        admit: () => Promise.reject(new Error("ledger down")),
        reserve: () => Promise.resolve({ index: 0, lease: "l1" }),
        settle: () => Promise.reject(new Error("ledger down")),
      }),
    };
    const router = new Router(ledgerEnv({ RoutingLedger: broken }));
    const legs = leg("z-ai/glm-4.7-flash", 1);
    await expect(router.budget("batch", legs, own)).resolves.toBe(0);
    const decision = must(await router.pick("batch", own, legs), "batch decision");
    expect(decision.lease).toBe("l1");
    await expect(router.settle(decision, "error")).resolves.toBeUndefined();
  });
});

describe("workersAuthContext (platform env backs only config-declared provider names)", () => {
  it("resolves a config-declared env name; refuses pi builtin keys and platform secrets", async () => {
    const { workersAuthContext } = await import("../src/pi/credentials");
    const ctx = workersAuthContext(
      fakeEnv({
        DGX_BASE_URL: "http://spark:8888/v1",
        OPENROUTER_API_KEY: "platform-secret",
        AUTH_SECRET: "auth-secret",
      }),
    );
    // dgx-spark 退出 config：其 baseUrlEnv 不再被宣告，env 解析拒絕（tunnel 回歸時隨 provider block 恢復）
    await expect(ctx.env("DGX_BASE_URL")).resolves.toBeUndefined();
    await expect(ctx.env("OPENROUTER_API_KEY")).resolves.toBeUndefined();
    await expect(ctx.env("AUTH_SECRET")).resolves.toBeUndefined();
    await expect(ctx.fileExists("~/.aws/credentials")).resolves.toBe(false);
  });
});

describe("three-tier keyed chain (#355: teacher → admin → YAML binding; admin quota skip on month window)", () => {
  async function seedKeyedPools(): Promise<void> {
    const { env } = await import("cloudflare:workers");
    const { applyD1Migrations } = await import("cloudflare:test");
    await applyD1Migrations(env.DB, inject("d1Migrations"));
    await run(env.DB, "DELETE FROM admin_key_usage WHERE admin_key_id IN ('ak_a', 'ak_b')");
    await run(env.DB, "DELETE FROM admin_keys WHERE id IN ('ak_a', 'ak_b')");
    await run(env.DB, "DELETE FROM users WHERE id = 'u_chain'");
    const at = "2026-11-18T00:00:00.000Z";
    await run(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, lang, created_at)
       VALUES ('u_chain', '鏈老師', 'chain@example.com', 'x', 'zh', $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
       VALUES ('u_chain', 'openrouter', 'enc', 'zzzz', 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('u_chain', 'openrouter', 'z-ai/glm-5.3-flash', NULL, 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO admin_keys (id, provider_id, key_enc, last4, sort_order, updated_at, monthly_quota_usd)
       VALUES ('ak_a', 'openrouter', 'enc', 'aaaa', 0, $at, NULL)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO admin_keys (id, provider_id, key_enc, last4, sort_order, updated_at, monthly_quota_usd)
       VALUES ('ak_b', 'deepseek', 'enc', 'bbbb', 1, $at, 0.1)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO admin_key_models (admin_key_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('ak_a', 'z-ai/glm-5.3-flash', NULL, 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO admin_key_models (admin_key_id, model, max_concurrency, sort_order, updated_at)
       VALUES ('ak_b', 'glm-4.6', 3, 0, $at)`,
      { at },
    );
    await run(
      env.DB,
      `INSERT INTO admin_key_usage (admin_key_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed, created_at)
       VALUES ('ak_b', 'deepseek', 'glm-4.6', 1, 1, 2, 0.11, 0, $now)`,
      { now: new Date().toISOString() },
    );
  }

  it("adminLegsOf lists keys ordered by sort order with the adminChain fallback and skips quota-capped keys", async () => {
    await seedKeyedPools();
    const { env } = await import("cloudflare:workers");
    const { adminLegsOf } = await import("../src/pi/credentials");
    const { gatewayConfig } = await import("../src/gateway/config.gen");
    const legs = await adminLegsOf(env);
    expect(legs).toEqual([
      {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        credential: "admin:ak_a",
        maxConcurrency: gatewayConfig.adminChain.maxConcurrency,
        providerMaxConcurrency: null,
        priority: 0,
      },
    ]);
  });

  it("keyedLegsOf places teacher legs before admin legs; the chain keeps both ahead of the YAML binding legs", async () => {
    await seedKeyedPools();
    const { env } = await import("cloudflare:workers");
    const { keyedLegsOf } = await import("../src/pi/credentials");
    const { Router } = await import("../src/gateway/router");

    const legs = await keyedLegsOf(env, "u_chain");
    expect(legs.map((leg) => leg.credential)).toEqual(["teacher:u_chain", "admin:ak_a"]);

    const router = new Router(ledgerEnv());
    const entries = await router.chain("interactive", undefined, legs);
    expect(entries.map((entry) => entry.credential)).toEqual(["teacher:u_chain", "admin:ak_a", "platform", "platform"]);
    expect(entries.map((entry) => entry.provider)).toEqual(["openrouter", "openrouter", "workers-ai", "workers-ai"]);
  });

  it("same provider, teacher and admin credentials: cooldown on one leg does not touch the other", async () => {
    const { Router } = await import("../src/gateway/router");
    const router = new Router(ledgerEnv());
    const teacherLeg = {
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      credential: "teacher:u_chain",
      maxConcurrency: 4,
      priority: 0,
    };
    const adminLeg = { ...teacherLeg, credential: "admin:ak_a" };

    for (let i = 0; i < 5; i += 1) {
      const decision = must(await router.pick("interactive", undefined, [teacherLeg, adminLeg]), "teacher decision");
      expect(decision.key.credential).toBe("teacher:u_chain");
      await router.settle(decision, "error");
    }
    const entries = await router.chain("interactive", undefined, [teacherLeg, adminLeg]);
    expect(entries.map((entry) => entry.credential)).toEqual(["admin:ak_a", "platform", "platform"]);

    for (let i = 0; i < 5; i += 1) {
      const decision = must(await router.pick("interactive", undefined, [teacherLeg, adminLeg]), "admin decision");
      expect(decision.key.credential).toBe("admin:ak_a");
      await router.settle(decision, "error");
    }
    const afterBothCooled = await router.chain("interactive", undefined, [teacherLeg, adminLeg]);
    expect(afterBothCooled.map((entry) => entry.credential)).toEqual(["platform", "platform"]);
  });
});

describe("AI-only production registry (F1 regression: YAML provider id vs createAI id)", () => {
  it("pick resolves the workers-ai legs through the real models registry without DGX or teacher keys", async () => {
    const { buildModels } = await import("../src/pi/models");
    const { Router } = await import("../src/gateway/router");
    const fakeAi = { run: async () => ({}), toMarkdown: async () => ({ format: "markdown", markdown: "" }) };
    const env = fakeEnv({ AI: fakeAi });
    const { models, default: fallback } = buildModels(env);
    const router = new Router(env);
    const canServe = (entry: { provider: string; model: string }): boolean =>
      models.getModel(entry.provider, entry.model) !== undefined;
    const decision = must(await router.pick("interactive", canServe), "interactive unserved decision");
    expect(decision.entry.provider).toBe("workers-ai");
    expect(decision.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(fallback).toBeDefined();
  });
});
