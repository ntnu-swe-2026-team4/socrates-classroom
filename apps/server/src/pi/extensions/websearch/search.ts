import type { Ai } from "@cloudflare/workers-types";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  error: string | null;
}

export function createWebSearch(ai: Ai) {
  return async (query: string, numResults = 5): Promise<SearchOutcome> => {
    try {
      const response = await ai.websearch({
        gatewayId: "default",
        query,
        provider: "ceramic",
        limit: numResults,
      });
      if (!response.ok) {
        return { hits: [], error: `websearch_${response.status}` };
      }
      const raw: unknown = await response.json();
      const hits: SearchHit[] = [];
      const items: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, "items") : undefined;
      if (Array.isArray(items)) {
        for (const entry of items) {
          if (typeof entry !== "object" || entry === null) continue;
          const url = Reflect.get(entry, "url");
          if (typeof url !== "string") continue;
          try {
            new URL(url);
            hits.push({
              title: String(Reflect.get(entry, "title") ?? url),
              url,
              snippet: String(Reflect.get(entry, "description") ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 500),
            });
          } catch {}
        }
      }
      return { hits, error: null };
    } catch (cause) {
      return { hits: [], error: cause instanceof Error ? cause.name : String(cause) };
    }
  };
}

export function formatAnswer(hits: SearchHit[]): string {
  if (hits.length === 0) return "No results found.";
  return hits
    .map((hit) =>
      hit.snippet ? `${hit.snippet}\nSource: ${hit.title} (${hit.url})` : `Source: ${hit.title} (${hit.url})`,
    )
    .join("\n\n");
}
