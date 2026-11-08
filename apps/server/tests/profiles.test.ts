import { env } from "cloudflare:workers";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { runProfile, PROFILES } from "../src/pi/agents/profiles";

describe("agent profiles（#113：角色定義，model 由 routing 解析）", () => {
  it("profiles 表：lookup/topic-gen/report-analyst 的角色欄位正確（零 model hardcode）", () => {
    expect(PROFILES.lookup.trafficClass).toBe("interactive");
    expect(PROFILES.lookup.maxTurns).toBe(3);
    expect(PROFILES.lookup.extensions).toContain("websearch");
    expect(PROFILES["topic-gen"].trafficClass).toBe("batch");
    expect(PROFILES["report-analyst"].extensions).toEqual([]);
    for (const profile of Object.values(PROFILES)) {
      const json = JSON.stringify(profile);
      expect(json).not.toMatch(/glm|claude|gpt|@cf\//i);
    }
  });

  it("runProfile（lookup profile）：faux 全路徑——conversation 建立、submit、wait、text 回傳", async () => {
    const { models } = buildFauxModels();
    const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
    const runtime = {
      models: { models, default: models.getModel("faux", "faux-1") as never },
      registry: createRegistry(),
      env: env as never,
    };
    const { text } = await runProfile(harness, runtime, "lookup", "什麼是功利主義？");
    expect(text).toContain("功利主義");
  }, 15_000);
});

function buildFauxModels() {
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("功利主義是一種主張：行為對錯取決於結果帶來的幸福總量。你覺得快樂可以用總量衡量嗎？"),
    ]),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, faux };
}
