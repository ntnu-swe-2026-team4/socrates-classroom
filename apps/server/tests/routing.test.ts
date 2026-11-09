import { describe, expect, it } from "vitest";
import { RoutingLedger } from "../src/routing/ledger";

describe("routing ledger（pi 無結構化錯誤狀態 → 只記 ok/error；連續錯誤 cooldown）", () => {
  const key = { provider: "dgx-spark", model: "GLM-5.3-Flash", credential: "platform" };

  it("cooldown 過期自然回（無 probe）", () => {
    const ledger = new RoutingLedger();
    for (let i = 0; i < 5; i += 1) {
      ledger.record(key);
      ledger.settle(key, "error");
    }
    expect(ledger.inCooldown(key)).toBe(true);
    expect(ledger.inCooldown(key, Date.now() + 61_000)).toBe(false);
  });

  it("連續 5 次 error 開 cooldown；ok 重置失敗計數", () => {
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

  it("begin/end 包住 inFlight；settle 結束併發計數", () => {
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

describe("router 走訪（config 驅動，cooldown 過濾）", () => {
  it("mock 環境（無 AI binding、無 DGX URL）：鏈全空 → pick null", async () => {
    const { Router } = await import("../src/routing/router");
    const env = { LLM_PROVIDER: "mock" } as never;
    const router = new Router(env);
    expect(router.pick("interactive")).toBeNull();
  });

  it("config：workers-ai 是一個 provider 兩個 model 條目，priority 排序正確", async () => {
    const { routingConfig } = await import("../src/routing/config.gen");
    const wa = routingConfig.providers["workers-ai"];
    expect(wa?.kind).toBe("binding");
    expect(wa?.models?.map((m) => m.id)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    const waEntries = routingConfig.defaults.availability.filter((e) => e.provider === "workers-ai");
    expect(waEntries.map((e) => e.model)).toEqual(["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-4.7-flash"]);
    expect(waEntries[0]!.priority).toBeLessThan(waEntries[1]!.priority);
  });

  it("ledger 記帳單位＝(provider, model, credential)——同 provider 不同 model 分開記", async () => {
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

describe("teacher legs（#82：老師 key 前置，平台鏈墊後）", () => {
  const teacherLeg = {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    credential: "teacher:u_teacher",
    maxConcurrency: 4,
    priority: 0,
  };

  it("teacher leg 排在平台鏈前；canServe 擋下後落到平台鏈", async () => {
    const { Router } = await import("../src/routing/router");
    const router = new Router({ AI: {}, DGX_BASE_URL: "http://spark:8888/v1" } as never);
    const chain = router.chain("interactive", undefined, [teacherLeg]);
    expect(chain[0]).toMatchObject({ provider: "openrouter", credential: "teacher:u_teacher" });
    expect(chain[1]!.provider).toBe("dgx-spark");

    const blocked = router.chain("interactive", () => false, [teacherLeg]);
    expect(blocked.every((e) => e.credential !== "teacher:u_teacher")).toBe(true);
  });

  it("cooldown 過濾 Router.chain：5 連敗的 leg 被踢出、ok 後回歸", async () => {
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

  it("dgx 腿存活：def 級 model 在 canServe 前解析（DGX_BASE_URL 設定時 priority-1 不被過濾）", async () => {
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

  it("teacher leg 獨立記帳：cooldown 不影響平台鏈", async () => {
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

describe("對話 run 的 fallback legs（models.ts 接線）", () => {
  it("有 AI binding：registry 裡鏈首 model 帶 fallback symbol（透過 provider catalog 包裝）", async () => {
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

  it("mock 模式：faux 無 fallback（faux model 不經 createAI）", async () => {
    const { buildModels } = await import("../src/pi/models");
    const bundle = buildModels({ LLM_PROVIDER: "mock" } as never);
    expect(bundle.faux).toBeDefined();
    const model = bundle.models.getModel("faux", "faux-1");
    expect(model).toBeDefined();
  });
});

describe("routing schema（availability 引用驗證——打錯字 fail-fast 不靜默掉 leg）", () => {
  const base = {
    providers: {
      "workers-ai": { kind: "binding", models: [{ id: "@cf/zai-org/glm-4.7-flash" }] },
    },
    classifiers: {},
    voice: { stt: "s", tts: "t" },
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

  it("引用不存在的 provider → parse 拒絕", async () => {
    const { RoutingConfigSchema } = await import("../src/routing/routing-schema");
    const result = RoutingConfigSchema.safeParse({
      ...base,
      defaults: { availability: [{ provider: "typo-name", credential: "platform", maxConcurrency: 1, priority: 1 }] },
    });
    expect(result.success).toBe(false);
  });

  it("引用 provider 未提供的 model → parse 拒絕", async () => {
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

  it("合法引用 → parse 通過", async () => {
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
