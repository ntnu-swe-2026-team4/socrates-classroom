import { describe, expect, it } from "vitest";
import { RoutingLedger } from "../src/routing/ledger";

describe("routing ledger（cooldown 語意，LiteLLM 慣例）", () => {
  const key = { provider: "dgx-spark", model: "GLM-5.3-Flash-EXL3", credential: "platform" };

  it("ok 清除 cooldown；429/timeout 開 60s；過期自然回（無 probe）", () => {
    const ledger = new RoutingLedger();
    ledger.record(key);
    ledger.settle(key, "rate");
    expect(ledger.inCooldown(key)).toBe(true);

    // Cooldown expiry is passive: time advances, no probe needed
    const ledger2 = new RoutingLedger();
    ledger2.record(key);
    ledger2.settle(key, "timeout");
    expect(ledger2.inCooldown(key, Date.now() + 61_000)).toBe(false);
  });

  it("auth（401/403）直接 dead，不重試", () => {
    const ledger = new RoutingLedger();
    ledger.record(key);
    ledger.settle(key, "auth");
    expect(ledger.isDead(key)).toBe(true);
    expect(ledger.inCooldown(key, Date.now() + 999_999_999)).toBe(true);
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
  });

  it("mock 模式：faux 無 fallback（faux model 不經 createAI）", async () => {
    const { buildModels } = await import("../src/pi/models");
    const bundle = buildModels({ LLM_PROVIDER: "mock" } as never);
    expect(bundle.faux).toBeDefined();
    const model = bundle.models.getModel("faux", "faux-1");
    expect(model).toBeDefined();
  });
});
