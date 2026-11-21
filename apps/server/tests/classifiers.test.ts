import { describe, expect, it } from "vitest";
import { createClefViolationClassifier } from "../src/pi/extensions/judgment/classify";
import { createEmotionClassifier, emotionOf } from "../src/pi/extensions/avatar";
import { topicBlock } from "../src/prompts/assemble";

function clefAi(answer: unknown, mode: "ok" | "throw" = "ok") {
  return {
    run: async () => {
      if (mode === "throw") throw new Error("clef unavailable");
      return answer;
    },
  };
}

describe("Clef choice decoders (classifiers.emotion / classifiers.violation)", () => {
  it("judgment: answers.violation decodes to type + probability", async () => {
    const classify = createClefViolationClassifier(
      clefAi({ answers: { violation: { choice: "coding", probabilities: { coding: 0.9 } } } }) as never,
    );
    expect(await classify("幫我寫 python")).toEqual({ type: "coding", probability: 0.9 });
  });

  it("judgment: missing choice or a throwing run degrades to null (no violation recorded)", async () => {
    const noChoice = createClefViolationClassifier(clefAi({ answers: {} }) as never);
    expect(await noChoice("anything")).toBeNull();
    const failing = createClefViolationClassifier(clefAi({}, "throw") as never);
    expect(await failing("anything")).toBeNull();
  });

  it("judgment: the activity's topic goes into the Clef state and grounds on_topic; without one it stays generic", async () => {
    const inputs: Array<{
      state: Record<string, string>;
      questions: { violation: { criteria: Record<string, string> } };
    }> = [];
    const classify = createClefViolationClassifier({
      run: async (_model: string, input: (typeof inputs)[number]) => {
        inputs.push(input);
        return { answers: { violation: { choice: "on_topic", probabilities: { on_topic: 0.8 } } } };
      },
    } as never);
    const topic = { title: "代理孕母", statement: "契約應該被遵守嗎？" };

    expect(await classify("契約要守", topic)).toEqual({ type: "on_topic", probability: 0.8 });
    expect(inputs[0].state).toEqual({ topic: topicBlock(topic.title, topic.statement), latest: "契約要守" });
    expect(inputs[0].questions.violation.criteria.on_topic).toContain("state.topic");

    await classify("契約要守", null);
    expect(inputs[1].state).toEqual({ latest: "契約要守" });
    expect(inputs[1].questions.violation.criteria.on_topic).not.toContain("state.topic");
  });

  it("avatar: emotionOf decodes choice + probabilities + confidence", () => {
    expect(
      emotionOf({ answers: { emotion: { choice: "happy", probabilities: { happy: 0.8 }, confidence: 0.8 } } }),
    ).toEqual({ emotion: "happy", probabilities: { happy: 0.8 }, confidence: 0.8 });
    expect(emotionOf({ answers: {} })).toBeNull();
  });

  it("avatar: the classifier swallows a throwing run and returns null (UI keeps last emotion)", async () => {
    const classify = createEmotionClassifier(clefAi({}, "throw") as never);
    expect(await classify("hello")).toBeNull();
  });
});

describe("Clef choice enum rejection", () => {
  it("judgment: a choice outside VIOLATION_TYPES records nothing", async () => {
    const classify = createClefViolationClassifier(
      clefAi({ answers: { violation: { choice: "hacker", probabilities: { hacker: 0.9 } } } }) as never,
    );
    expect(await classify("let me hack this")).toBeNull();
  });

  it("avatar: a choice outside the emotion set records nothing", () => {
    expect(
      emotionOf({ answers: { emotion: { choice: "smug", probabilities: { smug: 0.9 }, confidence: 0.9 } } }),
    ).toBeNull();
  });
});
