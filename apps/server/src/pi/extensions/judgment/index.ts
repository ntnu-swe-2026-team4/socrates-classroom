import {
  defineEntry,
  defineExtension,
  defineTask,
  hook,
  GenerationTask,
  runEndTask,
  type Entry,
} from "@earendil-works/pi-durable";
import type { Ai } from "@cloudflare/workers-types";
import type { ViolationType } from "@socrates/shared";
import { createClefViolationClassifier, type ViolationJudgment } from "./classify";
import { createReportViolationTool } from "./tool";

export interface ViolationData {
  type: ViolationType;
  probability: number;
  excerpt: string;
  source: "classifier" | "agent";
}

export const ViolationEntry: Entry<{ [key: string]: never }> = defineEntry("app.violation");

type ViolationSink = (violation: ViolationData) => Promise<void>;

export function createJudgmentExtension(ai: Ai | undefined, reportViolation: ViolationSink) {
  const sink = reportViolation;
  const classifier = ai ? createClefViolationClassifier(ai) : null;
  const ViolationTask = defineTask<{ latest: string }, { phase: "classify" }, null>({
    name: "app.violation",
    version: 1,
    initial: () => ({ phase: "classify" }),
    phases: {
      classify: async (task, runtime, context) => {
        if (!classifier) {
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
          return;
        }
        const recorded = await runtime.memo<string>("judgment", context);
        if (recorded !== undefined) {
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
          return;
        }
        const judgment: ViolationJudgment | null = await classifier(task.input.latest);
        if (judgment && judgment.type !== "on_topic") {
          const handle = (await runtime.conversation(runtime.conversationId, context))!;
          const data: ViolationData = {
            type: judgment.type,
            probability: judgment.probability,
            excerpt: task.input.latest.slice(0, 200),
            source: "classifier",
          };
          await runtime.commit(async (tx) => {
            await handle.submit(tx, { type: "write", entry: { kind: "app.violation", data: data as never } });
          }, context);
        }
        await runtime.memo("judgment", JSON.stringify(judgment), context);
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  return defineExtension({
    name: "judgment",
    tools: [
      createReportViolationTool(async (input) => {
        await sink?.({
          type: input.type as ViolationType,
          probability: input.probability,
          excerpt: input.excerpt,
          source: "agent",
        });
      }),
    ],
    tasks: [ViolationTask],
    hooks: [
      hook(GenerationTask, {
        afterRun: async (run, api, context) => {
          if (!classifier || run.reason !== "answer") return undefined;
          const items = await api.entries(
            { minEntryId: run.first, maxEntryId: run.last, order: "ascending" },
            1000,
            undefined,
            context,
          );
          const latest = items.items
            .filter((entry) => entry.kind === "pi.user")
            .flatMap((entry) => entry.model ?? [])
            .map((message) => {
              if (message.role !== "user") return "";
              const content = message.content;
              if (typeof content === "string") return content;
              return content.map((part) => (part.type === "text" ? part.text : "")).join("");
            })
            .filter(Boolean)
            .at(-1);
          if (!latest) return undefined;
          return { tasks: [runEndTask(ViolationTask, { latest })] };
        },
      }),
    ],
  });
}
