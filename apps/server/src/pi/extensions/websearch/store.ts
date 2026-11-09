const MAX_STORED_RESULTS = 20;
const RESULT_TTL_MS = 15 * 60_000;
const MAX_INLINE_CHARS = 20_000;
const CONTEXT_CHARS = 400;

export interface StoredSearch {
  queries: Array<{ query: string; answer: string; error: string | null; results: SearchHitShape[] }>;
  storedAt: number;
}

interface SearchHitShape {
  title: string;
  url: string;
  snippet: string;
}

export interface StoredFetch {
  urls: Array<{ url: string; title: string; content: string; error: string | null }>;
  storedAt: number;
}

const FETCH_CACHE_TTL_MS = 60 * 60_000;
const FETCH_CACHE_MAX = 50;

export interface ResponseStore {
  storeSearch(queries: StoredSearch["queries"]): string;
  getStored(id: string): StoredSearch | null;
  storeFetched(urls: StoredFetch["urls"]): string;
  getStoredFetch(id: string): StoredFetch | null;
  getCachedFetch(url: string, mode: string): { content: string; title: string } | null;
  putCachedFetch(url: string, mode: string, content: string, title: string): void;
  isSearchHit(url: string): boolean;
}

export function createResponseStore(): ResponseStore {
  const searches = new Map<string, StoredSearch>();
  const fetches = new Map<string, StoredFetch>();
  const fetchCache = new Map<string, { content: string; title: string; at: number }>();

  function prune(map: Map<string, { storedAt: number }>, now: number): void {
    for (const [id, data] of map) {
      if (now - data.storedAt >= RESULT_TTL_MS) map.delete(id);
    }
    while (map.size > MAX_STORED_RESULTS) {
      const oldest = [...map.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
      if (!oldest) break;
      map.delete(oldest[0]);
    }
  }

  return {
    storeSearch(queries) {
      prune(searches, Date.now());
      const id = crypto.randomUUID();
      searches.set(id, { queries, storedAt: Date.now() });
      return id;
    },
    getStored(id) {
      prune(searches, Date.now());
      return searches.get(id) ?? null;
    },
    storeFetched(urls) {
      prune(fetches, Date.now());
      const id = crypto.randomUUID();
      fetches.set(id, { urls, storedAt: Date.now() });
      return id;
    },
    getStoredFetch(id) {
      prune(fetches, Date.now());
      return fetches.get(id) ?? null;
    },
    getCachedFetch: (url, mode) => getCachedFetch(url, mode),
    putCachedFetch: (url, mode, content, title) => putCachedFetch(url, mode, content, title),
    isSearchHit: (url) => isSearchHit(url),
  };

  function isSearchHit(url: string): boolean {
    for (const stored of searches.values()) {
      for (const query of stored.queries) {
        if (query.results.some((hit) => hit.url === url)) return true;
      }
    }
    return false;
  }

  function getCachedFetch(url: string, mode: string): { content: string; title: string } | null {
    const entry = fetchCache.get(`${mode}:${url}`);
    if (!entry) return null;
    if (Date.now() - entry.at >= FETCH_CACHE_TTL_MS) {
      fetchCache.delete(`${mode}:${url}`);
      return null;
    }
    return { content: entry.content, title: entry.title };
  }

  function putCachedFetch(url: string, mode: string, content: string, title: string): void {
    if (fetchCache.size > FETCH_CACHE_MAX) {
      const oldest = [...fetchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) fetchCache.delete(oldest[0]);
    }
    fetchCache.set(`${mode}:${url}`, { content, title, at: Date.now() });
  }
}

export function serialize(stored: StoredSearch): string {
  return JSON.stringify(stored, null, 2);
}

export function findPassages(content: string, queries: string[], mode: "exact" | "case-insensitive" | "fuzzy"): string {
  const MAX_OUTPUT = 20_000;
  const out: string[] = [];
  for (const query of queries) {
    if (out.join("\n").length >= MAX_OUTPUT) break;
    const haystack = mode === "exact" ? content : content.toLocaleLowerCase();
    const needle = mode === "exact" ? query : query.toLocaleLowerCase();
    let index = haystack.indexOf(needle);
    let found = 0;
    while (index !== -1 && found < 5) {
      const start = Math.max(0, index - CONTEXT_CHARS);
      const end = Math.min(content.length, index + needle.length + CONTEXT_CHARS);
      out.push(`[${query}] …${content.slice(start, end)}…`);
      found += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
    if (found === 0)
      out.push(
        `[${query}] no match${mode === "fuzzy" ? " (fuzzy not yet supported: use exact or case-insensitive)" : ""}`,
      );
  }
  return out.join("\n\n").slice(0, MAX_OUTPUT);
}

export function slicePage(
  content: string,
  offset: number,
  limit: number,
  id: string,
): { text: string; endOffset: number } {
  const endOffset = Math.min(offset + limit, content.length);
  let text = content.slice(offset, endOffset);
  if (endOffset < content.length) {
    const hint = `\n\n---\nShowing chars ${offset}-${endOffset} of ${content.length}. Use get_search_content({ responseId: "${id}", offset: ${endOffset}, limit: ${limit} }) for the next slice.`;
    const overflow = text.length + hint.length - MAX_INLINE_CHARS;
    if (overflow > 0) text = text.slice(0, text.length - overflow);
    text += hint;
  }
  return { text, endOffset };
}
