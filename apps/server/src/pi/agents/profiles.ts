import {
  createRegistry,
  type Harness,
  type AgentChange,
  type Conversation,
  type Registry,
  type Submission,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Env } from "../../env";
import type { buildModels } from "../models";
import { socratesExtension } from "../extensions/socrates";
import { createAvatarExtension } from "../extensions/avatar";
import { createJudgmentExtension } from "../extensions/judgment";
import { createWebSearchExtension } from "../extensions/websearch";
import { routingConfig } from "../../routing/config.gen";
import { getRouter, type TrafficClass } from "../../routing/router";

export type ProfileName = "socrates" | "topic-gen" | "report-analyst" | "lookup";

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
    instructions: "topic-gen",
    extensions: ["websearch"],
    maxTurns: 6,
    trafficClass: "batch",
  },
  "report-analyst": {
    name: "report-analyst",
    instructions: "report-analyst",
    extensions: [],
    maxTurns: 4,
    trafficClass: "batch",
  },
  lookup: {
    name: "lookup",
    instructions: "lookup",
    extensions: ["websearch"],
    maxTurns: 3,
    trafficClass: "interactive",
  },
};

function _registryFor(profile: AgentProfile, env: Env): Registry {
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

export async function runProfile(
  harness: Harness,
  runtime: ProfileRuntime,
  profileName: Exclude<ProfileName, "socrates">,
  input: string,
): Promise<{ text: string; conversation: Conversation }> {
  const profile = PROFILES[profileName];
  const conversation = await harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: agentChangeFor(profile) },
    BACKGROUND_CONTEXT,
  );
  const router = getRouter(runtime.env);
  const canServe = (entry: { provider: string; model?: string }): boolean => {
    const def = routingConfig.providers[entry.provider];
    const modelId = entry.model ?? def?.model ?? "";
    return runtime.models.models.getModel(entry.provider, modelId) !== undefined;
  };
  const decision = router.pick(profile.trafficClass, canServe);
  const model = decision
    ? (runtime.models.models.getModel(decision.entry.provider, decision.model) ?? runtime.models.default)
    : runtime.models.default;
  await conversation.configure({ model: { provider: model.provider, modelId: model.id } }, BACKGROUND_CONTEXT);
  const submission: Submission = await conversation.submit({ type: "input", content: input }, BACKGROUND_CONTEXT);
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  if (settled.status !== "done" || settled.type !== "input") {
    if (decision) router.settle(decision, "error");
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
  if (decision) router.settle(decision, text ? "ok" : "error");
  return { text, conversation };
}
