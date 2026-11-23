import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Env } from "../../env";
import type { DecidedCredential } from "../credentials";
import { recordKeyedUsage } from "../../gateway/usage";

export function createUsageExtension(env: Env, decided: () => DecidedCredential | null) {
  const record = async (message: AssistantMessage): Promise<void> => {
    try {
      await recordKeyedUsage(env, decided(), {
        provider: message.provider,
        model: message.model,
        usage: message.usage,
      });
    } catch (error) {
      console.warn("[usage] record failed:", error instanceof Error ? error.message : typeof error);
    }
  };
  return defineExtension({
    name: "usage",
    hooks: [hook(GenerationTask, { afterResponse: (message) => record(message) })],
  });
}
