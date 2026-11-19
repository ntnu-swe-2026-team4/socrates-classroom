import { Hono } from "hono";
import { ApiError, LookupInputSchema, LANG_NAMES, type Lang } from "@socrates/shared";
import { enforceIpLimit, fail, parseBody, requireUser, type AppEnv } from "../http";
import { openProfileHarness, runProfile } from "../pi/agents/profiles";

function mockMarkdown(term: string, lang: string): string {
  if (lang === "en") return `**${term}** — a working definition for our dialogue, then back to the argument.`;
  if (lang === "es") return `**${term}** — definición provisional para el diálogo; volvamos al argumento.`;
  return `**${term}**——在對話中使用的定義（示例）。理解之後，我們回到論證本身。`;
}

export function lookupRoutes() {
  return new Hono<AppEnv>().post("/lookup", async (c) => {
    requireUser(c);
    await enforceIpLimit(c, "lookup", 20);
    const input = await parseBody(c, LookupInputSchema);
    const lang = c.get("lang") as Lang;
    // A canned explanation only in the explicit mock mode (tests, local demo); otherwise a failure is an error the
    // panel shows, never a made-up definition.
    if (c.env.LLM_PROVIDER === "mock") return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    if (!c.env.AI) fail(502, "llm_unavailable");
    let markdown = "";
    try {
      const { harness, runtime } = await openProfileHarness(c.env, "lookup");
      const { text } = await runProfile(harness, runtime, "lookup", `${input.term}\n\nWrite in ${LANG_NAMES[lang]}.`);
      markdown = text.trim();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("[lookup] pipeline failed", error instanceof Error ? error.name : typeof error);
    }
    if (!markdown) fail(502, "llm_unavailable");
    return c.json({ term: input.term, markdown });
  });
}
