import { Hono } from "hono";
import { ApiError, AssistantInputSchema, LANG_NAMES, type AssistantMessage, type Lang } from "@socrates/shared";
import { enforceIpLimit, fail, parseBody, requireUser, type AppEnv } from "../http";
import { NoAvailableModelError, openProfileHarness, runProfile } from "../pi/agents/profiles";

const MOCK_REPLY: Record<Lang, (question: string) => string> = {
  zh: (question) => `（離線示範回覆）你問的是「${question}」。接上真實模型後，這裡會直接給你答案。`,
  en: (question) =>
    `(Offline demo reply) You asked “${question}”. With a real model connected, the answer appears here.`,
  es: (question) =>
    `(Respuesta de demostración) Preguntaste «${question}». Con un modelo real conectado, aquí verás la respuesta.`,
};

function transcriptOf(messages: AssistantMessage[], lang: Lang): string {
  const earlier = messages.slice(0, -1);
  const question = messages.at(-1)?.text ?? "";
  const context = earlier.length
    ? `Earlier in this chat:\n${earlier.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n")}\n\n`
    : "";
  return `${context}Question: ${question}\n\nWrite in ${LANG_NAMES[lang]}.`;
}

export function assistantRoutes() {
  return new Hono<AppEnv>().post("/assistant", async (c) => {
    const user = requireUser(c);
    await enforceIpLimit(c, "assistant", 20);
    const input = await parseBody(c, AssistantInputSchema);
    const lang = c.get("lang");
    const question = input.messages.at(-1)?.text ?? "";
    if (!c.env.AI || c.env.LLM_PROVIDER === "mock") {
      return c.json({ markdown: MOCK_REPLY[lang](question) }, 200, { "X-Socrates-Fallback": "mock" });
    }
    try {
      const { harness, runtime, teacherLegs } = await openProfileHarness(
        c.env,
        "assistant",
        user.guest ? undefined : async () => user.id,
      );
      const { text } = await runProfile(
        harness,
        runtime,
        "assistant",
        transcriptOf(input.messages, lang),
        await teacherLegs,
        { lang },
      );
      const markdown = text.trim();
      if (!markdown) fail(502, "llm_unavailable");
      return c.json({ markdown });
    } catch (error) {
      if (error instanceof NoAvailableModelError) fail(502, "llm_unavailable");
      if (error instanceof ApiError) throw error;
      console.error("[assistant] pipeline failed", error instanceof Error ? error.name : typeof error);
      fail(502, "llm_unavailable");
    }
  });
}
