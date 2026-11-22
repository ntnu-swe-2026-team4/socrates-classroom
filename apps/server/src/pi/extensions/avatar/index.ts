import {
  defineEntry,
  defineExtension,
  defineTask,
  hook,
  runEndTask,
  GenerationTask,
  type Entry,
  type HookApi,
  type RunSummary,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { gatewayConfig } from "../../../gateway/config.gen";
import type { Ai } from "@cloudflare/workers-types";
import EMOTION_RAW from "../../../prompts/emotion-classify.md?raw";
import { clefChoicePrompt } from "../../clef-prompt";
import { aiRunOf, readChoiceResult } from "../../ai-run";

export type Emotion = "happy" | "angry" | "confused" | "neutral";

const EMOTIONS: readonly Emotion[] = ["happy", "angry", "confused", "neutral"];

export interface EmotionJudgment {
  emotion: Emotion;
  probabilities: { [key: string]: number };
  confidence: number;
}

export const EmotionEntry: Entry<{
  emotion: string;
  probabilities: { [key: string]: number };
  confidence: number;
}> = defineEntry("app.emotion");

const EMOTION_MODEL = gatewayConfig.classifiers.emotion;

export const EMOTION_QUESTION = clefChoicePrompt<Emotion>(EMOTION_RAW);

export function createEmotionClassifier(ai: Ai): (text: string) => Promise<EmotionJudgment | null> {
  return (text) => classify(ai, text);
}

async function classify(ai: Ai, text: string): Promise<EmotionJudgment | null> {
  try {
    const raw = await aiRunOf(ai)(EMOTION_MODEL, {
      state: { latest: text.slice(0, 2000) },
      questions: {
        emotion: { type: "choice", ...EMOTION_QUESTION },
      },
    });
    return emotionOf(raw);
  } catch {
    return null;
  }
}

export function emotionOf(raw: unknown): EmotionJudgment | null {
  const answer = readChoiceResult(raw, "emotion");
  if (answer === null) return null;
  const emotion = EMOTIONS.find((candidate) => candidate === answer.choice);
  if (emotion === undefined) return null;
  return { emotion, probabilities: answer.probabilities, confidence: answer.confidence };
}

function lastStudentTextOf(run: RunSummary, api: HookApi, context: Context): Promise<string> {
  return api
    .entries({ minEntryId: run.first, maxEntryId: run.last, order: "ascending" }, 1000, undefined, context)
    .then(
      ({ items }) =>
        items
          .filter((entry) => entry.kind === "pi.user")
          .flatMap((entry) => entry.model ?? [])
          .map((message) => {
            if (message.role !== "user") return "";
            const content = message.content;
            if (typeof content === "string") return content;
            return content.map((part) => (part.type === "text" ? part.text : "")).join("");
          })
          .filter(Boolean)
          .at(-1) ?? "",
    );
}

export function createAvatarExtension(ai: Ai | undefined) {
  const classifier = ai ? createEmotionClassifier(ai) : null;
  const EmotionTask = defineTask<{ text: string }, { phase: "record" }, null>({
    name: "app.emotion",
    version: 1,
    initial: () => ({ phase: "record" }),
    phases: {
      record: async (task, runtime, context) => {
        if (!classifier) {
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
          return;
        }
        const judgment = await classifier(task.input.text);
        if (judgment) {
          const handle = await runtime.conversation(runtime.conversationId, context);
          if (handle) {
            await runtime.commit(async (tx) => {
              await handle.submit(tx, {
                type: "write",
                entry: { kind: "app.emotion", data: { ...judgment } },
              });
            }, context);
          }
        }
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  return defineExtension({
    name: "avatar",
    tasks: [EmotionTask],
    hooks: [
      hook(GenerationTask, {
        afterRun: async (run, api, context) => {
          if (!classifier || run.reason !== "answer") return undefined;
          const text = await lastStudentTextOf(run, api, context);
          if (!text.trim()) return undefined;
          return { tasks: [runEndTask(EmotionTask, { text })] };
        },
      }),
    ],
  });
}
