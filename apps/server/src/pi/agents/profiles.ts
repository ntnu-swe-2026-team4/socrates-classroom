import {
  createRegistry,
  Harness,
  type AgentChange,
  type Conversation,
  type Registry,
  type Submission,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
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
import { getRouter, type TrafficClass } from "../../routing/router";
import type { SettleKind } from "../../routing/ledger";
import { teacherLegsOf, type TeacherLeg } from "../credentials";

export type ProfileName = "socrates" | "topic-gen" | "student-report" | "class-report" | "lookup";

const ROLE_USER_MARKER = '{{role "user"}}';
const LOCALE_BLOCK = "{{#if locale}}{{locale}}{{else}}繁體中文{{/if}}";

const STUDENT_REPORT_SHAPE = `Respond with only JSON, no markdown fences.
If they stated a position:
{"stated": true, "claim": {"text": "...", "turns": [2]}, "reasons": {"text": "...", "turns": [3]}, "tension": {"text": "...", "turns": [4]}}
tension is null when there is none.
If they never stated a position:
{"stated": false, "doing": {"text": "...", "turns": [1]}}
turns are the student's line numbers in the conversation, each at least 1.`;

const CLASS_REPORT_SHAPE = `Respond with only JSON, no markdown fences:
{"students": [{"id": "...", "summary": [{"step": "cause → result", "turns": [2, 3]}]}], "unstated": ["..."], "axes": [{"name": "...", "low": "...", "high": "...", "positions": [{"id": "...", "turns": [2], "view": "...", "end": "low", "at": 25}], "why": "..."}], "overview": ["..."]}
- students: every student who stated a position, in roster order; summary has 1-3 steps
- end is "low", "middle", or "high"; at is 0-100 (low 0-49, middle 50, high 51-100)
- overview: 3-5 lines`;

function instructionsOf(asset: string, outputShape?: string): string {
  const [instructions] = asset.split(ROLE_USER_MARKER);
  const body = instructions.replaceAll(LOCALE_BLOCK, "繁體中文").trim();
  return outputShape ? `${body}\n\n${outputShape}` : body;
}

export interface AgentProfile {
  name: ProfileName;
  instructions: string;
  extensions: string[];
  maxTurns: number | undefined;
  trafficClass: TrafficClass;
}

export const PROFILES: Record<ProfileName, AgentProfile> = {
  socrates: {
    name: "socrates",
    instructions: "",
    extensions: ["socrates", "avatar", "judgment", "websearch"],
    maxTurns: undefined,
    trafficClass: "interactive",
  },
  "topic-gen": {
    name: "topic-gen",
    instructions: instructionsOf(TOPIC_GEN_RAW),
    extensions: ["websearch"],
    maxTurns: 6,
    trafficClass: "batch",
  },
  "student-report": {
    name: "student-report",
    instructions: instructionsOf(STUDENT_REPORT_RAW, STUDENT_REPORT_SHAPE),
    extensions: [],
    maxTurns: 4,
    trafficClass: "batch",
  },
  "class-report": {
    name: "class-report",
    instructions: instructionsOf(CLASS_REPORT_RAW, CLASS_REPORT_SHAPE),
    extensions: [],
    maxTurns: 4,
    trafficClass: "batch",
  },
  lookup: {
    name: "lookup",
    instructions: instructionsOf(LOOKUP_RAW),
    extensions: ["websearch"],
    maxTurns: 3,
    trafficClass: "interactive",
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
  return registry;
}

function agentChangeFor(profile: AgentProfile): AgentChange {
  return {
    instructions: profile.instructions || undefined,
    ...(profile.maxTurns !== undefined ? { maxTurns: profile.maxTurns } : {}),
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

export async function runProfile(
  harness: Harness,
  runtime: ProfileRuntime,
  profileName: Exclude<ProfileName, "socrates">,
  input: string,
  teacherLegs?: TeacherLeg[],
): Promise<{ text: string; conversation: Conversation }> {
  const profile = PROFILES[profileName];
  const conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: agentChangeFor(profile) },
    BACKGROUND_CONTEXT,
  );
  const router = getRouter(runtime.env);
  const canServe = (entry: { provider: string; model: string }): boolean =>
    runtime.models.models.getModel(entry.provider, entry.model) !== undefined;
  const decision = router.pick(profile.trafficClass, canServe, teacherLegs);
  const model = decision
    ? (runtime.models.models.getModel(decision.entry.provider, decision.model) ?? runtime.models.default)
    : runtime.models.default;
  let kind: SettleKind = "error";
  try {
    await conversation.configure({ model: { provider: model.provider, modelId: model.id } }, BACKGROUND_CONTEXT);
    const submission: Submission = await conversation.submit({ type: "input", content: input }, BACKGROUND_CONTEXT);
    const settled = await submission.wait(BACKGROUND_CONTEXT);
    if (settled.status !== "done" || settled.type !== "input") {
      return { text: "", conversation };
    }
    const answer = await conversation.entries(
      { maxEntryId: settled.answer, order: "descending" },
      1,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const message = answer.items[0]?.model?.[0];
    const text =
      message?.role === "assistant"
        ? typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("")
        : "";
    kind = "ok";
    return { text, conversation };
  } finally {
    if (decision) router.settle(decision, kind);
  }
}
