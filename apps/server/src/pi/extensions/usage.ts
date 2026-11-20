import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Env } from "../../env";
import { recordTeacherUsage } from "../../gateway/usage";

export function createUsageExtension(env: Env, teacherOf: () => Promise<string | null>) {
  const record = async (message: AssistantMessage): Promise<void> => {
    try {
      await recordTeacherUsage(env, await teacherOf(), {
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
