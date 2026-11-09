import { env } from "cloudflare:workers";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { runProfile, PROFILES } from "../src/pi/agents/profiles";

describe("agent profiles (#113: role definitions, models resolved by routing)", () => {
  it("profiles table: role fields correct (zero model hardcode)", () => {
    expect(PROFILES.lookup.trafficClass).toBe("interactive");
    expect(PROFILES.lookup.maxTurns).toBe(3);
    expect(PROFILES.lookup.extensions).toContain("websearch");
    expect(PROFILES["topic-gen"].trafficClass).toBe("batch");
    expect(PROFILES["student-report"].extensions).toEqual([]);
    expect(PROFILES["class-report"].extensions).toEqual([]);
    for (const profile of Object.values(PROFILES)) {
      const json = JSON.stringify(profile);
      expect(json).not.toMatch(/glm|claude|gpt|@cf\//i);
    }
  });

  it("instructions: real prompt assets wired (no placeholders) + JSON shape appendix + no Handlebars residue", () => {
    expect(PROFILES["student-report"].instructions).toContain("You are reading one student's conversation");
    expect(PROFILES["student-report"].instructions).toContain('"stated": true');
    expect(PROFILES["class-report"].instructions).toContain("You are analyzing the whole class's conversations");
    expect(PROFILES["class-report"].instructions).toContain('"unstated"');
    expect(PROFILES.lookup.instructions).toContain("term-lookup assistant");
    expect(PROFILES["topic-gen"].instructions).toContain("debate topics");
    expect(PROFILES["topic-gen"].instructions).toContain('"topics"');
    for (const profile of Object.values(PROFILES)) {
      expect(profile.instructions).not.toMatch(/\{\{/);
      expect(profile.instructions).not.toContain("{{role");
    }
  });

  it("runProfile (lookup profile): full path on faux — conversation created, submit, wait, text returned", async () => {
    const { models, faux } = buildFauxModels();
    const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
    const runtime = {
      models: { models, default: models.getModel("faux", "faux-1") as never, faux: faux as never },
      registry: createRegistry(),
      env: env as never,
    };
    const { text, conversation } = await runProfile(harness, runtime, "lookup", "什麼是功利主義？");
    expect(text).toContain("功利主義");
    const agent = await conversation.agent(BACKGROUND_CONTEXT);
    expect(agent.thinkingLevel).toBe(PROFILES.lookup.thinkingLevel);
  }, 15_000);

  it("every profile pins its thinkingLevel — the product decision lives in the table, not in DO code", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.thinkingLevel).toBe("high");
    }
  });
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
