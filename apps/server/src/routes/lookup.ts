import { Hono } from "hono";
import { LookupInputSchema } from "@socrates/shared";
import { fail, guardUser, langOf, rateLimit, validateJson, type AppEnv } from "../http";
import { openProfileHarness, runProfile } from "../pi/agents/profiles";
import { lookupInput } from "../prompts/assemble";

function mockMarkdown(term: string, lang: string): string {
  if (lang === "en") return `**${term}** — a working definition for our dialogue, then back to the argument.`;
  if (lang === "es") return `**${term}** — definición provisional para el diálogo; volvamos al argumento.`;
  return `**${term}**——在對話中使用的定義（示例）。理解之後，我們回到論證本身。`;
}

export function lookupRoutes() {
  return new Hono<AppEnv>().post(
    "/lookup",
    guardUser(),
    rateLimit("lookup", 20),
    validateJson(LookupInputSchema),
    async (c) => {
      const input = c.req.valid("json");
      const lang = c.get("lang");
      if (c.env.LLM_PROVIDER === "mock") {
        return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) }, 200, {
          "X-Socrates-Fallback": "mock",
        });
      }
      if (!c.env.AI) fail(502, "llm_unavailable");
      let markdown = "";
      try {
        const { harness, runtime } = await openProfileHarness(c.env, "lookup");
        const { text } = await runProfile(harness, runtime, "lookup", lookupInput(input.term, langOf(c)));
        markdown = text.trim();
      } catch (error) {
        console.error("[lookup] pipeline failed", error instanceof Error ? error.name : typeof error);
        fail(502, "llm_unavailable");
      }
      if (!markdown) fail(502, "llm_unavailable");
      return c.json({ term: input.term, markdown });
    },
  );
}
