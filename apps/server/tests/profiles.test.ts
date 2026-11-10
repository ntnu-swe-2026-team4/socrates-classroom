import { env } from "cloudflare:workers";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { runProfile, PROFILES, profileRegistry } from "../src/pi/agents/profiles";
import { SUBMIT_CLASS_REPORT, SUBMIT_STUDENT_ANALYSIS } from "../src/pi/extensions/report-submit";

describe("agent profiles (#113: role definitions, models resolved by gateway)", () => {
  it("profiles table: role fields correct (zero model hardcode)", () => {
    expect(PROFILES.lookup.trafficClass).toBe("interactive");
    expect(PROFILES.lookup.maxTurns).toBe(3);
    expect(PROFILES.lookup.extensions).toContain("websearch");
    expect(PROFILES["topic-gen"].trafficClass).toBe("batch");
    expect(PROFILES["student-report"].extensions).toEqual(["report-submit"]);
    expect(PROFILES["class-report"].extensions).toEqual(["report-submit"]);
    for (const profile of Object.values(PROFILES)) {
      const json = JSON.stringify(profile);
      expect(json).not.toMatch(/glm|claude|gpt|@cf\//i);
    }
  });

  it("instructions: real prompt assets wired (no placeholders) + submit-tool appendix + no Handlebars residue", () => {
    expect(PROFILES["student-report"].instructions).toContain("You are reading one student's conversation");
    expect(PROFILES["student-report"].instructions).toContain(SUBMIT_STUDENT_ANALYSIS);
    expect(PROFILES["student-report"].instructions).toContain("First judge whether they stated a position");
    expect(PROFILES["class-report"].instructions).toContain("You are analyzing the whole class's conversations");
    expect(PROFILES["class-report"].instructions).toContain(SUBMIT_CLASS_REPORT);
    expect(PROFILES.lookup.instructions).toContain("term-lookup assistant");
    expect(PROFILES["topic-gen"].instructions).toContain("debate topics");
    expect(PROFILES.lookup.instructions).not.toMatch(/\{\{/);
    expect(PROFILES["topic-gen"].instructions).not.toMatch(/\{\{/);
    expect(PROFILES["student-report"].instructions).toContain("{{#if locale}}");
  });

  it("runProfile (lookup profile): full path on faux — conversation created, submit, wait, text returned", async () => {
    const { models, faux } = buildFauxModels();
    const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
    const runtime = {
      models: { models, default: models.getModel("faux", "faux-1") as never, faux: faux as never },
      registry: createRegistry(),
      env: env as never,
    };
    const { text, conversation } = await runProfile(harness, runtime, "lookup", "什麼是功利主義？", undefined, {
      lang: "es",
    });
    expect(text).toContain("功利主義");
    const agent = await conversation.agent(BACKGROUND_CONTEXT);
    expect(agent.thinkingLevel).toBe(PROFILES.lookup.thinkingLevel);
    expect(agent.instructions).not.toMatch(/\{\{/);

    const esRegistry = profileRegistry(PROFILES["student-report"], env as never);
    const esHarness = await Harness.open(new MemoryStorage(), { models, registry: esRegistry }, BACKGROUND_CONTEXT);
    const esFaux = buildFauxModels();
    esFaux.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(SUBMIT_STUDENT_ANALYSIS, {
            report: { stated: false, doing: { text: "還在探索", turns: [1] } },
          }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const esRuntime = {
      models: {
        models: esFaux.models,
        default: esFaux.models.getModel("faux", "faux-1") as never,
        faux: esFaux.faux as never,
      },
      registry: esRegistry,
      env: env as never,
    };
    const esRun = await runProfile(esHarness, esRuntime, "student-report", "學生（1）：我覺得……", undefined, {
      lang: "es",
      submitTool: SUBMIT_STUDENT_ANALYSIS,
    });
    const esAgent = await esRun.conversation.agent(BACKGROUND_CONTEXT);
    expect(esAgent.instructions).toContain("Spanish (Español)");
  }, 15_000);

  it("runProfile submitTool: faux tool call is extracted as payload (terminate round)", async () => {
    const { models, faux } = buildFauxModels();
    const registry = profileRegistry(PROFILES["class-report"], env as never);
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(SUBMIT_CLASS_REPORT, {
            students: [{ id: "學生A", summary: [{ step: "提出直覺判斷", turns: [1] }] }],
            unstated: [],
            axes: [],
            overview: ["全班立場一致"],
          }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, BACKGROUND_CONTEXT);
    const runtime = {
      models: { models, default: models.getModel("faux", "faux-1") as never, faux: faux as never },
      registry,
      env: env as never,
    };
    const { payload, text } = await runProfile(harness, runtime, "class-report", "## Roster: 1", undefined, {
      submitTool: SUBMIT_CLASS_REPORT,
    });
    expect(text).toBe("");
    expect(payload).toMatchObject({ overview: ["全班立場一致"] });
  }, 20_000);

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
