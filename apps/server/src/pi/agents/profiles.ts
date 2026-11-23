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
import CLASS_REPORT_AXES_RAW from "../../prompts/class-report-axes.md?raw";
import STUDENT_INDICATORS_RAW from "../../prompts/student-indicators.md?raw";
import STUDENT_ENGAGEMENT_RAW from "../../prompts/student-engagement.md?raw";
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
import {
  reportSubmitAxesExtension,
  reportSubmitEngagementExtension,
  reportSubmitExtension,
  reportSubmitIndicatorsExtension,
} from "../extensions/report-submit";
import { createUsageExtension } from "../extensions/usage";
import type { JsonObject } from "@earendil-works/pi-durable";

export type ProfileName =
  | "socrates"
  | "topic-gen"
  | "student-report"
  | "student-indicators"
  | "student-engagement"
  | "class-report"
  | "class-report-axes"
  | "lookup";

const LANG_PLACEHOLDER = "{{lang}}";

function instructionsOf(asset: string): string {
  return asset.trim();
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
    maxTurns: 8,
    trafficClass: "interactive",
    thinkingLevel: "low",
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
    instructions: instructionsOf(STUDENT_REPORT_RAW),
    extensions: ["report-submit"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "student-indicators": {
    name: "student-indicators",
    instructions: instructionsOf(STUDENT_INDICATORS_RAW),
    extensions: ["report-submit-indicators"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "student-engagement": {
    name: "student-engagement",
    instructions: instructionsOf(STUDENT_ENGAGEMENT_RAW),
    extensions: ["report-submit-engagement"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "class-report": {
    name: "class-report",
    instructions: instructionsOf(CLASS_REPORT_RAW),
    extensions: ["report-submit"],
    maxTurns: 4,
    trafficClass: "batch",
    thinkingLevel: "high",
  },
  "class-report-axes": {
    name: "class-report-axes",
    instructions: instructionsOf(CLASS_REPORT_AXES_RAW),
    extensions: ["report-submit-axes"],
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

export const BTW_THINKING_LEVEL: ModelThinkingLevel = "high";

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
  if (profile.extensions.includes("report-submit-axes")) registry.install(reportSubmitAxesExtension);
  if (profile.extensions.includes("report-submit-indicators")) registry.install(reportSubmitIndicatorsExtension);
  if (profile.extensions.includes("report-submit-engagement")) registry.install(reportSubmitEngagementExtension);
  return registry;
}

export function instructionsFor(name: ProfileName, lang: Lang): string {
  return PROFILES[name].instructions.replaceAll(LANG_PLACEHOLDER, LANG_NAMES[lang]);
}

function agentChangeFor(profile: AgentProfile, lang: Lang): AgentChange {
  return {
    instructions: instructionsFor(profile.name, lang) || undefined,
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
  if (teacherOf) registry.install(createUsageExtension(env, teacherOf));
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

export class NoAvailableModelError extends Error {
  constructor() {
    super("no_available_model");
    this.name = "no_available_model";
  }
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
  if (!decision && !runtime.models.faux) throw new NoAvailableModelError();
  let kind: SettleKind = "error";
  try {
    const model = decision
      ? runtime.models.models.getModel(decision.entry.provider, decision.model)
      : runtime.models.default;
    if (!model) throw new Error("model_not_resolvable");
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
