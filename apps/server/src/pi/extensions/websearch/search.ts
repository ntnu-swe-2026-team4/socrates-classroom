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

interface WebsearchResponse {
  items?: Array<{ url?: unknown; title?: unknown; description?: unknown }>;
}

export function createWebSearch(ai: Ai) {
  return async (query: string, numResults = 5): Promise<SearchOutcome> => {
    try {
      const response = await (ai as unknown as { websearch?: (req: unknown) => Promise<Response> }).websearch!({
        gatewayId: "default",
        query,
        provider: "ceramic",
        limit: numResults,
      });
      if (!response.ok) {
        return { hits: [], error: `websearch_${response.status}` };
      }
      const raw = (await response.json()) as WebsearchResponse;
      const hits: SearchHit[] = [];
      for (const item of raw.items ?? []) {
        try {
          new URL(String(item.url ?? ""));
          hits.push({
            title: String(item.title ?? item.url ?? ""),
            url: String(item.url ?? ""),
            snippet: String(item.description ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 500),
          });
        } catch {}
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
