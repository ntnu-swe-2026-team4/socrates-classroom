import { Hono } from "hono";
import { LookupInputSchema } from "@socrates/shared";
import { parseBody, requireUser, type AppEnv } from "../http";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { runProfile } from "../pi/agents/profiles";
import { buildModels } from "../pi/models";

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
      const models = buildModels(c.env);
      const harness = await Harness.open(
        new MemoryStorage(),
        { models: models.models, registry: createRegistry() },
        BACKGROUND_CONTEXT,
      );
      const { text } = await runProfile(
        harness,
        { models, registry: createRegistry(), env: c.env },
        "lookup",
        input.term,
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
