import { Hono } from "hono";
import { LANG_NAMES, LookupInputSchema, type Lang } from "@socrates/shared";
import { parseBody, requireUser, type AppEnv } from "../http";
import { getOneshotBundle, oneshot } from "../providers/oneshot";
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
  if (lang === "en") return `**${term}** — a working definition for our dialogue, then back to the argument.`;
  if (lang === "es") return `**${term}** — definición provisional para el diálogo; volvamos al argumento.`;
  return `**${term}**——在對話中使用的定義（示例）。理解之後，我們回到論證本身。`;
}

export function lookupRoutes() {
  return new Hono<AppEnv>().post("/lookup", async (c) => {
    requireUser(c);
    const input = await parseBody(c, LookupInputSchema);
    const lang = c.get("lang");
    const ai = c.env.AI as unknown as { websearch?: (req: unknown) => Promise<Response> } | undefined;
    if (!ai?.websearch) {
      console.error(
        "[lookup] no websearch on AI binding, keys:",
        c.env.AI ? Object.keys(c.env.AI).slice(0, 20) : "no AI",
      );
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
    try {
      const response = await ai.websearch({
        gatewayId: "default",
        query: input.term,
        provider: "ceramic",
        limit: 5,
      });
      if (!response.ok) {
        console.error("[lookup] websearch failed", response.status, (await response.text()).slice(0, 200));
        throw new Error(`websearch_${response.status}`);
      }
      const raw = (await response.json()) as { items?: Array<{ url?: string; title?: string; description?: string }> };
      const hits = (raw.items ?? [])
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
        .map((hit, index) => `[${index + 1}] ${hit.title ?? hit.url}\n${hit.description ?? ""}`)
        .join("\n\n");
      const explanation = await oneshot(c.env, getOneshotBundle(c.env), {
        system: `You explain a term for a student in a Socratic philosophy dialogue. One short paragraph of markdown in ${LANG_NAMES[lang]}, cite sources inline, end by pointing back to the argument. Reply JSON only.`,
        user: `Term: ${input.term}\nLanguage: ${lang}\nSources:\n${sources || "(none)"}`,
        schema: ExplanationSchema,
        mock: () => ({ markdown: mockMarkdown(input.term, lang) }),
      });
      return c.json({ term: input.term, markdown: explanation.markdown });
    } catch (error) {
      console.error("[lookup] pipeline failed", error);
      return c.json({ term: input.term, markdown: mockMarkdown(input.term, lang) });
    }
  });
}
