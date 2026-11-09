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

function expandIpv6(host: string): number[] | null {
  if (!host.includes(":")) return null;
  let text = host.toLowerCase();
  const v4tail = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4tail) {
    const [a = 0, b = 0, c = 0, d = 0] = v4tail[1].split(".").map(Number);
    text = `${text.slice(0, -v4tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves[1] !== undefined ? (halves[1] ? halves[1].split(":").filter(Boolean) : []) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && missing < 0) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail].map((part) => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    const [a = 0, b = 0] = bare.split(".").map(Number);
    return isPrivateIpv4(a, b);
  }
  const groups = expandIpv6(bare);
  // WHATWG normalization leaves no unparseable IPv6 on this path; raw callers are gated by isSearchHit
  if (!groups) return false;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if (groups[0]! >= 0xfe80 && groups[0]! <= 0xfebf) return true;
  if (groups[0]! >= 0xfc00 && groups[0]! <= 0xfdff) return true;
  if (groups[0]! >= 0xff00) return true;
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true;
  if (groups[0] === 0x2002) return true;
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return isPrivateIpv4(groups[6]! >> 8, groups[6]! & 0xff) || isPrivateIpv4(groups[7]! >> 8, groups[7]! & 0xff);
  }
  const ffff = groups.indexOf(0xffff);
  if (ffff !== -1 && ffff <= 5) {
    const before = groups.slice(0, ffff);
    const rest = groups.slice(ffff + 1);
    const ipv4 = rest.slice(-2);
    const middle = rest.slice(0, -2);
    if (before.every((group) => group === 0) && middle.every((group) => group === 0)) {
      return isPrivateIpv4(ipv4[0]! >> 8, ipv4[0]! & 0xff) || isPrivateIpv4(ipv4[1]! >> 8, ipv4[1]! & 0xff);
    }
  }
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
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
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
  if (!reader) return (await response.text()).slice(0, MAX_CONTENT_CHARS);
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

function registrableLabels(host: string): string {
  const labels = host.replace(/\.+$/, "").split(".");
  return labels.slice(-2).join(".");
}

function sameSite(from: URL, to: URL): boolean {
  return registrableLabels(from.hostname) === registrableLabels(to.hostname);
}

async function fetchFollowingRedirects(
  startUrl: URL,
  permitHop?: (from: URL, to: URL) => boolean,
): Promise<{ response: Response; url: URL }> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (hop > 0 && permitHop && !permitHop(startUrl, url)) {
      throw new Error(`Blocked redirect target: ${url.hostname}`);
    }
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, url };
      url = validateUrl(new URL(location, url).toString());
      continue;
    }
    return { response, url };
  }
  throw new Error("Too many redirects");
}

export async function fetchPage(
  rawUrl: string,
  mode: "readable" | "raw",
  toMarkdown?: Ai["toMarkdown"],
  permitTarget?: (url: URL) => boolean,
): Promise<FetchOutcome> {
  try {
    const url = validateUrl(rawUrl);
    const { response } = await fetchFollowingRedirects(url, permitTarget ?? ((_from, to) => sameSite(url, to)));
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
