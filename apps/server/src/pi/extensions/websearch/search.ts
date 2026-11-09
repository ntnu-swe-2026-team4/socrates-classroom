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

export const DOMAIN_ALLOWLIST = ["wikipedia.org", "terms.naer.edu.tw", "plato.stanford.edu", "iep.utm.edu"];

interface WebsearchResponse {
  items?: Array<{ url?: unknown; title?: unknown; description?: unknown }>;
}

export function createWebSearch(ai: Ai, allowlist: string[] = DOMAIN_ALLOWLIST) {
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
          const host = new URL(String(item.url ?? "")).hostname.toLowerCase();
          if (!allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;
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
      return { hits: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  };
}

export function formatAnswer(hits: SearchHit[]): string {
  if (hits.length === 0) return "No results in the allowed domains.";
  return hits
    .map((hit) =>
      hit.snippet ? `${hit.snippet}\nSource: ${hit.title} (${hit.url})` : `Source: ${hit.title} (${hit.url})`,
    )
    .join("\n\n");
}
