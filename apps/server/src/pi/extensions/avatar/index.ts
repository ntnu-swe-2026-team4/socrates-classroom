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

export type Emotion = "happy" | "angry" | "confused" | "neutral";

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

const EMOTION_CRITERIA = {
  happy:
    "The student said something warm, funny, or made real progress: praised, joked, found a contradiction themselves, improved their reasoning",
  angry: "The student was rude, dismissive, or refusing to think (restrained, teacher-like sternness, not real anger)",
  confused: "The student's message is genuinely unclear: vague, self-contradictory, undefined terms, or nonsensical",
  neutral: "A normal Socratic follow-up without particular emotion",
};

interface ClefRunResult {
  answers?: Record<string, { choice?: string; probabilities?: Record<string, number>; confidence?: number }>;
}

async function classify(ai: Ai, text: string): Promise<EmotionJudgment | null> {
  try {
    const raw = (await (ai as unknown as { run: (m: string, i: unknown) => Promise<unknown> }).run(EMOTION_MODEL, {
      state: { latest: text.slice(0, 2000) },
      questions: {
        emotion: {
          type: "choice",
          instructions: "Pick the Socrates avatar's reaction to the student's latest message in a philosophy dialogue.",
          criteria: EMOTION_CRITERIA,
        },
      },
    })) as ClefRunResult;
    const answer = raw.answers?.emotion;
    if (answer?.choice === undefined) return null;
    const choice = answer.choice as Emotion;
    return { emotion: choice, probabilities: answer.probabilities ?? {}, confidence: answer.confidence ?? 0 };
  } catch {
    return null;
  }
}

function answerOf(run: RunSummary, api: HookApi, context: Context): Promise<string> {
  return api
    .entries({ minEntryId: run.first, maxEntryId: run.last, order: "ascending" }, 1000, undefined, context)
    .then(({ items }) =>
      items
        .filter((entry) => entry.kind === "pi.assistant")
        .flatMap((entry) => entry.model ?? [])
        .map((message) => {
          if (message.role !== "assistant") return "";
          const content = message.content;
          if (typeof content === "string") return content;
          return content.map((part) => (part.type === "text" ? part.text : "")).join("");
        })
        .join(""),
    );
}

export function createAvatarExtension(ai: Ai | undefined) {
  const classifier = ai ? (text: string) => classify(ai, text) : null;
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
          const handle = (await runtime.conversation(runtime.conversationId, context))!;
          await runtime.commit(async (tx) => {
            await handle.submit(tx, {
              type: "write",
              entry: { kind: "app.emotion", data: { ...judgment } },
            });
          }, context);
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
          const text = await answerOf(run, api, context);
          if (!text.trim()) return undefined;
          return { tasks: [runEndTask(EmotionTask, { text })] };
        },
      }),
    ],
  });
}
