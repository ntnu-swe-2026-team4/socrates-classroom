import { Hono } from "hono";
import { LookupInputSchema, LANG_NAMES, type Lang } from "@socrates/shared";
import { parseBody, requireUser, type AppEnv } from "../http";
import { openProfileHarness, runProfile } from "../pi/agents/profiles";

function mockMarkdown(term: string, lang: string): string {
  if (lang === "en") return `**${term}** — a working definition for our dialogue, then back to the argument.`;
  if (lang === "es") return `**${term}** — definición provisional para el diálogo; volvamos al argumento.`;
  return `**${term}**——在對話中使用的定義（示例）。理解之後，我們回到論證本身。`;
}

export function lookupRoutes() {
  return new Hono<AppEnv>().post("/lookup", async (c) => {
    requireUser(c);
    const input = await parseBody(c, LookupInputSchema);
    const lang = c.get("lang");
    if (!c.env.AI || c.env.LLM_PROVIDER === "mock") {
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
    try {
      const { harness, runtime } = await openProfileHarness(c.env, "lookup");
      const { text } = await runProfile(
        harness,
        runtime,
        "lookup",
        `${input.term}\n\nWrite in ${LANG_NAMES[c.get("lang") as Lang]}.`,
      );
      const markdown = text.trim();
      if (!markdown) return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
      return c.json({ term: input.term, markdown });
    } catch (error) {
      console.error("[lookup] pipeline failed", error);
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
  });
}
