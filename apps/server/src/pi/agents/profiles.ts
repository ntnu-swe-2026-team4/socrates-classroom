import {
  createRegistry,
  Harness,
  type AgentChange,
  type Conversation,
  type Registry,
  type Submission,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { LANG_NAMES, type Lang } from "@socrates/shared";
import STUDENT_REPORT_RAW from "../../prompts/student-report.md?raw";
import CLASS_REPORT_RAW from "../../prompts/class-report.md?raw";
import LOOKUP_RAW from "../../prompts/lookup.md?raw";
import TOPIC_GEN_RAW from "../../prompts/topic-gen.md?raw";
import type { Env } from "../../env";
import { buildModels } from "../models";
import { socratesExtension } from "../extensions/socrates";
import { createAvatarExtension } from "../extensions/avatar";
import { createJudgmentExtension } from "../extensions/judgment";
import { createWebSearchExtension } from "../extensions/websearch";
import { getRouter, type TrafficClass } from "../../gateway/router";
import type { SettleKind } from "../../gateway/ledger";
import { teacherLegsOf, type TeacherLeg } from "../credentials";
import { reportSubmitExtension, SUBMIT_CLASS_REPORT, SUBMIT_STUDENT_ANALYSIS } from "../extensions/report-submit";
import type { JsonObject } from "@earendil-works/pi-durable";

export type ProfileName = "socrates" | "topic-gen" | "student-report" | "class-report" | "lookup";

const ROLE_USER_MARKER = '{{role "user"}}';
const LOCALE_BLOCK = "{{#if locale}}{{locale}}{{else}}繁體中文{{/if}}";

const STUDENT_REPORT_SHAPE = `Submit the report by calling ${SUBMIT_STUDENT_ANALYSIS} as your final action; do not also write it as text.
turns are the student's line numbers in the conversation, each at least 1.
tension is null when there is none.`;

const CLASS_REPORT_SHAPE = `Submit the report by calling ${SUBMIT_CLASS_REPORT} as your final action; do not also write it as text.
- students: every student who stated a position, in roster order; summary has 1-3 steps
- when the class has no disagreement, axes is an empty array and the overview says so plainly
- end is "low", "middle", or "high"; at is 0-100 (low 0-49, middle 50, high 51-100)
- overview: 3-5 lines`;

function instructionsOf(asset: string, outputShape?: string): string {
  const [instructions] = asset.split(ROLE_USER_MARKER);
  const body = instructions.trim();
  return outputShape ? `${body}\n\n${outputShape}` : body;
}

export interface AgentProfile {
  name: ProfileName;
  instructions: string;
  extensions: string[];
  maxTurns: number | undefined;
  trafficClass: TrafficClass;
  thinkingLevel: ModelThinkingLevel;
}

export const PROFILES: Record<ProfileName, AgentProfile> = {
  socrates: {
    name: "socrates",
    instructions: "",
    extensions: ["socrates", "avatar", "judgment", "websearch"],
    maxTurns: undefined,
    trafficClass: "interactive",
    thinkingLevel: "high",
  },
  "topic-gen": {
    name: "topic-gen",
    instructions: instructionsOf(TOPIC_GEN_RAW),
    extensions: ["websearch"],
    maxTurns: 6,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "student-report": {
    name: "student-report",
    instructions: instructionsOf(STUDENT_REPORT_RAW, STUDENT_REPORT_SHAPE),
    extensions: ["report-submit"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "class-report": {
    name: "class-report",
    instructions: instructionsOf(CLASS_REPORT_RAW, CLASS_REPORT_SHAPE),
    extensions: ["report-submit"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  lookup: {
    name: "lookup",
    instructions: instructionsOf(LOOKUP_RAW),
    extensions: ["websearch"],
    maxTurns: 3,
    trafficClass: "interactive",
    thinkingLevel: "high",
  },
};

export function profileRegistry(profile: AgentProfile, env: Env): Registry {
  const registry = createRegistry();
  if (profile.extensions.includes("socrates")) registry.install(socratesExtension());
  if (profile.extensions.includes("avatar")) registry.install(createAvatarExtension(env.AI));
  if (profile.extensions.includes("judgment")) {
    registry.install(
      createJudgmentExtension(env.AI, async (violation) => {
        console.warn("[judgment:sink]", violation.type, violation.source);
      }),
    );
  }
  if (profile.extensions.includes("websearch")) registry.install(createWebSearchExtension(env.AI));
  if (profile.extensions.includes("report-submit")) registry.install(reportSubmitExtension);
  return registry;
}

function agentChangeFor(profile: AgentProfile, lang: Lang): AgentChange {
  return {
    instructions: (profile.instructions || undefined)?.replaceAll(LOCALE_BLOCK, LANG_NAMES[lang]),
    ...(profile.maxTurns !== undefined ? { maxTurns: profile.maxTurns } : {}),
    thinkingLevel: profile.thinkingLevel,
  };
}

/**
 * models/registry must be the same instances the harness uses: registry
 * subscriptions and faux state are per-instance; a second copy sees neither.
 */
export interface ProfileRuntime {
  models: ReturnType<typeof buildModels>;
  registry: Registry;
  env: Env;
}

export async function openProfileHarness(
  env: Env,
  profileName: Exclude<ProfileName, "socrates">,
  teacherOf?: () => Promise<string | null>,
): Promise<{ harness: Harness; runtime: ProfileRuntime; teacherLegs: Promise<TeacherLeg[]> }> {
  const models = buildModels(env, teacherOf ? { teacherOf } : {});
  const registry = profileRegistry(PROFILES[profileName], env);
  const harness = await Harness.open(new MemoryStorage(), { models: models.models, registry }, BACKGROUND_CONTEXT);
  return {
    harness,
    runtime: { models, registry, env },
    teacherLegs: teacherOf ? teacherLegsOf(env, await teacherOf()) : Promise.resolve([]),
  };
}

export interface RunProfileOptions {
  lang?: Lang;
  submitTool?: string;
}

function toolCallPayload(entry: { model?: readonly unknown[] }, toolName: string): JsonObject | null {
  for (const message of entry.model ?? []) {
    const candidate = message as { role?: string; content?: unknown };
    if (candidate.role !== "assistant" || typeof candidate.content !== "object" || candidate.content === null) continue;
    if (Array.isArray(candidate.content)) {
      for (const part of candidate.content) {
        const block = part as { type?: string; name?: string; arguments?: unknown };
        if (block.type !== "toolCall" || block.name !== toolName) continue;
        let args: unknown = block.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            continue;
          }
        }
        if (args && typeof args === "object" && !Array.isArray(args)) return args as JsonObject;
      }
    }
  }
  return null;
}

export async function runProfile(
  harness: Harness,
  runtime: ProfileRuntime,
  profileName: Exclude<ProfileName, "socrates">,
  input: string,
  teacherLegs?: TeacherLeg[],
  options: RunProfileOptions = {},
): Promise<{ text: string; payload: JsonObject | null; conversation: Conversation }> {
  const profile = PROFILES[profileName];
  const conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: agentChangeFor(profile, options.lang ?? "zh") },
    BACKGROUND_CONTEXT,
  );
  const router = getRouter(runtime.env);
  const canServe = (entry: { provider: string; model: string }): boolean =>
    runtime.models.models.getModel(entry.provider, entry.model) !== undefined;
  const decision = router.pick(profile.trafficClass, canServe, teacherLegs);
  if (!decision && !runtime.models.faux) throw new Error("no_available_model");
  const model = decision
    ? runtime.models.models.getModel(decision.entry.provider, decision.model)
    : runtime.models.default;
  if (!model) throw new Error("model_not_resolvable");
  let kind: SettleKind = "error";
  try {
    await conversation.configure({ model: { provider: model.provider, modelId: model.id } }, BACKGROUND_CONTEXT);
    const submission: Submission = await conversation.submit({ type: "input", content: input }, BACKGROUND_CONTEXT);
    const settled = await submission.wait(BACKGROUND_CONTEXT);
    if (settled.status !== "done" || settled.type !== "input") {
      kind = settled.status === "unanswered" && settled.reason === "aborted" ? "ok" : "error";
      return { text: "", payload: null, conversation };
    }
    const answer = await conversation.entries(
      { maxEntryId: settled.answer, order: "descending" },
      20,
      undefined,
      BACKGROUND_CONTEXT,
    );
    if (options.submitTool) {
      for (const entry of answer.items) {
        const payload = toolCallPayload(entry, options.submitTool);
        if (payload) {
          kind = "ok";
          return { text: "", payload, conversation };
        }
      }
    }
    const message = answer.items[0]?.model?.[0];
    const text =
      message?.role === "assistant"
        ? typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("")
        : "";
    kind = "ok";
    return { text, payload: null, conversation };
  } finally {
    if (decision) router.settle(decision, kind);
  }
}
