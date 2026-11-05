import { Hono } from "hono";
import { LookupInputSchema, type Lang } from "@socrates/shared";
import { parseBody, requireUser, type AppEnv } from "../http";
import { oneshot } from "../providers/oneshot";
import { z } from "zod";

const ExplanationSchema = z.object({ markdown: z.string().min(1) });

const DOMAIN_ALLOWLIST = [
  "zh.wikipedia.org",
  "en.wikipedia.org",
  "wikipedia.org",
  "terms.naer.edu.tw",
  "plato.stanford.edu",
  "iep.utm.edu",
];

function mockMarkdown(term: string, lang: Lang): string {
  const body =
    lang === "en"
      ? `**${term}** — a working definition for our dialogue, then back to the argument.`
      : `**${term}**——在對話中使用的定義（示例）。理解之後，我們回到論證本身。`;
  return body;
}

export function lookupRoutes() {
  return new Hono<AppEnv>().post("/lookup", async (c) => {
    requireUser(c);
    const input = await parseBody(c, LookupInputSchema);
    const lang = c.get("lang");
    const search = (c.env.AI as unknown as { websearch?: (req: unknown) => Promise<unknown> } | undefined)?.websearch;
    if (!search) {
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
    try {
      const raw = (await search({ query: input.term })) as {
        results?: Array<{ url?: string; title?: string; snippet?: string }>;
      };
      const hits = (raw.results ?? [])
        .filter((hit) => {
          try {
            const host = new URL(hit.url ?? "").hostname;
            return DOMAIN_ALLOWLIST.some((domain) => host === domain || host.endsWith(`.${domain}`));
          } catch {
            return false;
          }
        })
        .slice(0, 3);
      const sources = hits
        .map((hit, index) => `[${index + 1}] ${hit.title ?? hit.url}\n${hit.snippet ?? ""}`)
        .join("\n\n");
      const explanation = await oneshot(c.env, {
        system:
          "You explain a term for a student in a Socratic philosophy dialogue. One short paragraph of markdown, cite sources inline, end by pointing back to the argument. Reply JSON only.",
        user: `Term: ${input.term}\nLanguage: ${lang}\nSources:\n${sources || "(none)"}`,
        schema: ExplanationSchema,
        mock: () => ({ markdown: mockMarkdown(input.term, lang) }),
      });
      return c.json({ term: input.term, markdown: explanation.markdown });
    } catch {
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
  });
}
