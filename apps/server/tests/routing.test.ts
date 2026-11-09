import { describe, expect, it } from "vitest";
import { RoutingLedger } from "../src/routing/ledger";

describe("routing ledger (pi has no structured error state → records ok/error only; consecutive errors trigger cooldown)", () => {
  const key = { provider: "dgx-spark", model: "GLM-5.3-Flash", credential: "platform" };

  it("cooldown expires naturally without probing", () => {
    const ledger = new RoutingLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger.record(key);
      ledger.settle(key, "error");
    }
    expect(ledger.inCooldown(key)).toBe(true);
    expect(ledger.inCooldown(key, Date.now() + 61_000)).toBe(false);
  });

  it("five consecutive errors open a cooldown; ok resets the failure count", () => {
    const ledger = new RoutingLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger.record(key);
      ledger.settle(key, "error");
    }
    expect(ledger.inCooldown(key)).toBe(true);

    const ledger2 = new RoutingLedger();
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
    const ledger = new RoutingLedger();
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
    const { Router } = await import("../src/routing/router");
    const env = { LLM_PROVIDER: "mock" } as never;
    const router = new Router(env);
    expect(router.pick("interactive")).toBeNull();
  });

  it("config: workers-ai is one provider with two model entries, priority ordering correct", async () => {
    const { routingConfig } = await import("../src/routing/config.gen");
    const wa = routingConfig.providers["workers-ai"];
    expect(wa?.kind).toBe("binding");
    expect(wa?.models?.map((m) => m.id)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    const waEntries = routingConfig.defaults.availability.filter((e) => e.provider === "workers-ai");
    expect(waEntries.map((e) => e.model)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    expect(waEntries[0]!.priority).toBeLessThan(waEntries[1]!.priority);
  });

  it("ledger unit = (provider, model, credential) — same provider, different models, accounted separately", async () => {
    const { Router } = await import("../src/routing/router");
    const { ledgerKey } = await import("../src/routing/routing-schema");
    const router = new Router({ AI: {} } as never);
    const cfg = (await import("../src/routing/config.gen")).routingConfig;
    const def = cfg.providers["workers-ai"]!;
    const flash = ledgerKey(cfg.defaults.availability[1]!, def);
    const free = ledgerKey(cfg.defaults.availability[2]!, def);
    router.ledger.record(flash);
    router.ledger.record(flash);
    expect(router.ledger.status(flash).requests).toBe(2);
    expect(router.ledger.status(free).requests).toBe(0);
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
    const { Router } = await import("../src/routing/router");
    const router = new Router({ AI: {}, DGX_BASE_URL: "http://spark:8888/v1" } as never);
    const chain = router.chain("interactive", undefined, [teacherLeg]);
    expect(chain[0]).toMatchObject({ provider: "openrouter", credential: "teacher:u_teacher" });
    expect(chain[1]!.provider).toBe("dgx-spark");

    const blocked = router.chain("interactive", () => false, [teacherLeg]);
    expect(blocked.every((e) => e.credential !== "teacher:u_teacher")).toBe(true);
  });

  it("cooldown filters Router.chain: a leg with five straight failures is evicted and returns after ok", async () => {
    const { Router } = await import("../src/routing/router");
    const router = new Router({ AI: {} } as never);
    const decision = router.pick("interactive")!;
    for (let i = 0; i < 5; i += 1) {
      router.ledger.record(decision.key);
      router.settle(decision, "error");
    }
    expect(
      router.chain("interactive").some((e) => e.provider === decision.entry.provider && e.model === decision.model),
    ).toBe(false);
    router.ledger.record(decision.key);
    router.settle(decision, "ok");
    expect(
      router.chain("interactive").some((e) => e.provider === decision.entry.provider && e.model === decision.model),
    ).toBe(true);
  });

  it("dgx leg survives: def-level model resolves before canServe (priority-1 not filtered when DGX_BASE_URL is set)", async () => {
    const { Router } = await import("../src/routing/router");
    const { buildModels } = await import("../src/pi/models");
    const fakeAi = { run: async () => ({}), toMarkdown: async () => ({ format: "markdown", markdown: "" }) };
    const env = { AI: fakeAi, DGX_BASE_URL: "http://spark:8888/v1" } as never;
    const { models } = buildModels(env);
    const router = new Router(env);
    const decision = router.pick("interactive", (entry) => models.getModel(entry.provider, entry.model) !== undefined)!;
    expect(decision.entry.provider).toBe("dgx-spark");
    expect(decision.model).toBe("GLM-5.3-Flash");
  }, 20_000);

  it("teacher leg is accounted independently: its cooldown does not affect the platform chain", async () => {
    const { Router } = await import("../src/routing/router");
    const router = new Router({ AI: {} } as never);
    const decision = router.pick("interactive", undefined, [teacherLeg])!;
    expect(decision.key.credential).toBe("teacher:u_teacher");
    for (let i = 0; i < 5; i += 1) {
      router.ledger.record(decision.key);
      router.settle(decision, "error");
    }
    expect(router.ledger.inCooldown(decision.key)).toBe(true);
    const platform = router.pick("interactive", undefined, [teacherLeg]);
    expect(platform?.key.credential).toBe("platform");
  });
});

describe("dialogue run fallback legs (models.ts wiring)", () => {
  it("with AI binding: the head model in the registry carries the fallback symbol (wrapped by the provider catalog)", async () => {
    const { buildModels } = await import("../src/pi/models");
    const fakeAi = {
      run: async () => ({}),
      toMarkdown: async () => ({ format: "markdown", markdown: "" }),
    };
    const bundle = buildModels({ AI: fakeAi } as never);
    const model = bundle.models.getModel("cloudflare", "@cf/zai-org/glm-5.3-flash");
    expect(model).toBeDefined();
    // agents' MODEL_OPTIONS symbol: fallback legs are bound on the model object
    const OPTIONS = Symbol.for("agents.models.pi-ai.options");
    const options = (model as unknown as Record<symbol, unknown>)[OPTIONS] as { fallback?: string[] } | undefined;
    expect(options?.fallback).toEqual(["@cf/zai-org/glm-4.7-flash"]);
  }, 20_000);

  it("mock mode: faux has no fallback (the faux model bypasses createAI)", async () => {
    const { buildModels } = await import("../src/pi/models");
    const bundle = buildModels({ LLM_PROVIDER: "mock" } as never);
    expect(bundle.faux).toBeDefined();
    const model = bundle.models.getModel("faux", "faux-1");
    expect(model).toBeDefined();
  });
});

describe("routing schema (availability reference validation — typos fail fast instead of silently dropping a leg)", () => {
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
    },
    teacherChain: { maxConcurrency: 4 },
    trafficClasses: {},
  };

  it("reference to a nonexistent provider → parse rejects", async () => {
    const { RoutingConfigSchema } = await import("../src/routing/routing-schema");
    const result = RoutingConfigSchema.safeParse({
      ...base,
      defaults: { availability: [{ provider: "typo-name", credential: "platform", maxConcurrency: 1, priority: 1 }] },
    });
    expect(result.success).toBe(false);
  });

  it("reference to a model the provider does not offer → parse rejects", async () => {
    const { RoutingConfigSchema } = await import("../src/routing/routing-schema");
    const result = RoutingConfigSchema.safeParse({
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
    const { RoutingConfigSchema } = await import("../src/routing/routing-schema");
    const typoed = RoutingConfigSchema.safeParse({
      ...base,
      classifiers: { emotion: "clef-flash", violation: "@cf/cloudflare/clef-flash" },
    });
    expect(typoed.success).toBe(false);
    const missing = RoutingConfigSchema.safeParse({
      ...base,
      classifiers: { emotion: "@cf/cloudflare/clef-flash" },
    });
    expect(missing.success).toBe(false);
  });

  it("valid references → parse passes", async () => {
    const { RoutingConfigSchema } = await import("../src/routing/routing-schema");
    const result = RoutingConfigSchema.safeParse({
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
