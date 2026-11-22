import { VIOLATION_TYPES, type ViolationType } from "@socrates/shared";
import type { Ai } from "@cloudflare/workers-types";
import { gatewayConfig } from "../../../gateway/config.gen";
import { topicBlock, type Topic } from "../../../prompts/assemble";
import VIOLATION_RAW from "../../../prompts/violation-classify.md?raw";
import VIOLATION_TOPIC_RAW from "../../../prompts/violation-classify-topic.md?raw";
import { clefChoicePrompt } from "../../clef-prompt";
import { aiRunOf, readChoiceResult } from "../../ai-run";

export interface ViolationJudgment {
  type: ViolationType;
  probability: number;
}

const VIOLATION_MODEL = gatewayConfig.classifiers.violation;

export const VIOLATION_QUESTIONS = {
  general: clefChoicePrompt<ViolationType>(VIOLATION_RAW),
  topic: clefChoicePrompt<ViolationType>(VIOLATION_TOPIC_RAW),
};

export type ViolationClassifier = (latest: string, topic?: Topic | null) => Promise<ViolationJudgment | null>;

function violationQuestion(latest: string, topic: Topic | null | undefined) {
  if (!topic) return { state: { latest }, ...VIOLATION_QUESTIONS.general };
  return { state: { topic: topicBlock(topic.title, topic.statement), latest }, ...VIOLATION_QUESTIONS.topic };
}

export function createClefViolationClassifier(ai: Ai): ViolationClassifier {
  return async (latest, topic) => {
    try {
      const { state, instructions, criteria } = violationQuestion(latest.slice(0, 2000), topic);
      const raw = await aiRunOf(ai)(VIOLATION_MODEL, {
        state,
        questions: { violation: { type: "choice", instructions, criteria } },
      });
      const answer = readChoiceResult(raw, "violation");
      if (answer === null) return null;
      const type = VIOLATION_TYPES.find((candidate) => candidate === answer.choice);
      if (type === undefined) return null;
      return { type, probability: answer.probability };
    } catch {
      return null;
    }
  };
}
