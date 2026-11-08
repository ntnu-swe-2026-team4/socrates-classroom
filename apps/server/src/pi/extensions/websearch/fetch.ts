const MAX_CONTENT_CHARS = 100_000;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;

export interface FetchOutcome {
  url: string;
  title: string;
  content: string;
  error: string | null;
}

const BLOCKED_HOSTNAMES = ["localhost", "metadata.google.internal"];

function isPrivateIp(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    const [a, b] = bare.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  const v6 = bare.toLowerCase();
  if (v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice("::ffff:".length));
  return false;
}

export function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs can be fetched");
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(`Blocked internal hostname: ${host}`);
  }
  if (isPrivateIp(host)) throw new Error(`Blocked internal address: ${host}`);
  return url;
}

function titleOf(html: string, fallback: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = match?.[1]?.replace(/\s+/g, " ").trim();
  return raw || fallback;
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < MAX_CONTENT_CHARS) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text.slice(0, MAX_CONTENT_CHARS);
}

async function fetchFollowingRedirects(startUrl: URL): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      url = validateUrl(new URL(location, url).toString());
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

export async function fetchPage(
  rawUrl: string,
  mode: "readable" | "raw",
  toMarkdown?: Ai["toMarkdown"],
): Promise<FetchOutcome> {
  try {
    const url = validateUrl(rawUrl);
    const response = await fetchFollowingRedirects(url);
    if (!response.ok) {
      return { url: rawUrl, title: "", content: "", error: `HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await readBounded(response);
    const title = titleOf(raw, url.hostname);
    let content: string;
    if (mode === "raw" || !contentType.includes("html")) {
      content = raw;
    } else if (toMarkdown) {
      const result = await toMarkdown({ name: url.hostname, blob: new Blob([raw], { type: contentType }) });
      content = "markdown" in result && typeof result.markdown === "string" ? result.markdown : raw;
    } else {
      content = raw;
    }
    return { url: rawUrl, title, content: content.slice(0, MAX_CONTENT_CHARS), error: null };
  } catch (cause) {
    return { url: rawUrl, title: "", content: "", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
