import { VIOLATION_TYPES, type ViolationType } from "@socrates/shared";
import type { Ai } from "@cloudflare/workers-types";
import { gatewayConfig } from "../../../gateway/config.gen";
import { topicBlock, type Topic } from "../../../prompts/assemble";
import VIOLATION_RAW from "../../../prompts/violation-classify.md?raw";
import VIOLATION_TOPIC_RAW from "../../../prompts/violation-classify-topic.md?raw";
import { clefChoicePrompt } from "../../clef-prompt";

export interface ViolationJudgment {
  type: ViolationType;
  probability: number;
}

const VIOLATION_MODEL = gatewayConfig.classifiers.violation;

export const VIOLATION_QUESTIONS = {
  general: clefChoicePrompt<ViolationType>(VIOLATION_RAW),
  topic: clefChoicePrompt<ViolationType>(VIOLATION_TOPIC_RAW),
};

interface ClefRunResult {
  answers?: Record<string, { choice?: string; probabilities?: Record<string, number> }>;
}

export type ViolationClassifier = (latest: string, topic?: Topic | null) => Promise<ViolationJudgment | null>;

function violationQuestion(latest: string, topic: Topic | null | undefined) {
  if (!topic) return { state: { latest }, ...VIOLATION_QUESTIONS.general };
  return { state: { topic: topicBlock(topic.title, topic.statement), latest }, ...VIOLATION_QUESTIONS.topic };
}

export function createClefViolationClassifier(ai: Ai): ViolationClassifier {
  return async (latest, topic) => {
    try {
      const { state, instructions, criteria } = violationQuestion(latest.slice(0, 2000), topic);
      const raw = (await (ai as unknown as { run: (m: string, i: unknown) => Promise<unknown> }).run(VIOLATION_MODEL, {
        state,
        questions: { violation: { type: "choice", instructions, criteria } },
      })) as ClefRunResult;
      const answer = raw.answers?.violation;
      const choice = answer?.choice;
      if (answer === undefined || choice === undefined || !VIOLATION_TYPES.includes(choice as ViolationType))
        return null;
      return { type: choice as ViolationType, probability: answer.probabilities?.[choice] ?? 0 };
    } catch {
      return null;
    }
  };
}
