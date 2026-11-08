const MAX_CONTENT_CHARS = 100_000;

export interface FetchOutcome {
  url: string;
  title: string;
  content: string;
  error: string | null;
}

const BLOCKED_HOSTNAMES = ["localhost", "metadata.google.internal"];

function isPrivateIp(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
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

export async function fetchPage(
  rawUrl: string,
  mode: "readable" | "raw",
  toMarkdown?: Ai["toMarkdown"],
): Promise<FetchOutcome> {
  try {
    const url = validateUrl(rawUrl);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      return { url: rawUrl, title: "", content: "", error: `HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
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
