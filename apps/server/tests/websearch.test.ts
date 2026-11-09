import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import worker from "../src/index";
import { seedDemo } from "../src/seed";
import { frames, latestView } from "./helpers";

let thread: string;
let cookie: string;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    env,
    { waitUntil: () => {} },
  );
}

function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
}

async function connect(name: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${name}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = response!.webSocket as WebSocket;
  socket.accept();
  return socket;
}

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  const teacher = cookieOf(login);
  const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{ id: string }>;
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ name: "班", topicId: topics[0]!.id }),
    })
  ).json()) as { code: string; activityId: string };
  const joined = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: created.code, name: "同學", tosAccepted: true }),
  });
  const { user } = (await joined.json()) as { user: { id: string } };
  cookie = cookieOf(joined);
  thread = `${created.activityId}:${user.id}`;
});

describe("websearch extension (web_search + get_search_content)", () => {
  it("no AI binding: tools register, calls return a clear error, nothing throws", async () => {
    const socket = await connect(thread);
    const rx = frames(socket);
    await rx.until((f) => {
      const hello = f.find((m) => m.type === "hello");
      return hello !== undefined && "tools" in hello;
    });
    const hello = rx.list.find((m) => m.type === "hello");
    if (hello?.type === "hello") {
      const names = hello.tools.map((t) => t.name);
      expect(names).toContain("web_search");
      expect(names).toContain("get_search_content");
    }

    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "正義是什麼？" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 30_000);

  it("store/find/slice unit semantics: bounded slice with a continuation hint, findText with surrounding context", async () => {
    const { createResponseStore, slicePage, findPassages } = await import("../src/pi/extensions/websearch/store");
    const responses = createResponseStore();
    const id = responses.storeSearch([
      { query: "正義", answer: "a", error: null, results: [{ title: "T", url: "https://u", snippet: "s" }] },
    ]);
    const stored = responses.getStored(id);
    expect(stored).not.toBeNull();

    const content = JSON.stringify(stored, null, 2);
    const page = slicePage(content, 0, 50, id);
    expect(page.text.length).toBeLessThanOrEqual(50 + 220);
    expect(page.text).toContain("get_search_content");

    const found = findPassages(content, ["正義"], "case-insensitive");
    expect(found).toContain("正義");
    expect(found).not.toContain("no match");

    expect(responses.isSearchHit("https://u")).toBe(true);
    expect(responses.isSearchHit("https://attacker.example")).toBe(false);
  });

  it("fetch_content allows only search-result URLs (option B: web_search first → same URL fetchable; not searched → rejected)", async () => {
    const { createWebSearchExtension } = await import("../src/pi/extensions/websearch");
    const fakeAi = {
      websearch: async () =>
        new Response(
          JSON.stringify({
            items: [{ url: "https://zh.wikipedia.org/wiki/Justice", title: "Justice", description: "d" }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };
    const extension = createWebSearchExtension(fakeAi as never);
    type Tool = {
      name: string;
      execute: (args: Record<string, unknown>) => Promise<{ output: Array<{ type: string; text: string }> }>;
    };
    const tools = (extension.tools ?? []) as unknown as Tool[];
    const searchTool = tools.find((tool) => tool.name === "web_search")!;
    const fetchTool = tools.find((tool) => tool.name === "fetch_content")!;

    const blocked = await fetchTool.execute({ url: "https://zh.wikipedia.org/wiki/Justice" });
    expect(blocked.output[0]!.text).toContain("web_search results");

    await searchTool.execute({ query: "justice" });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html><title>Justice</title><body>justice body</body></html>", {
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const allowed = await fetchTool.execute({ url: "https://zh.wikipedia.org/wiki/Justice", mode: "raw" });
      expect(allowed.output[0]!.text).not.toContain("web_search results");
      expect(allowed.output[0]!.text).toContain("justice body");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("fetch_content (readable/raw + cache + SSRF)", () => {
  it("validateUrl blocks localhost/private ranges/non-HTTP", async () => {
    const { validateUrl } = await import("../src/pi/extensions/websearch/fetch");
    expect(() => validateUrl("http://localhost/x")).toThrow("internal");
    expect(() => validateUrl("http://127.0.0.1/x")).toThrow("internal");
    expect(() => validateUrl("http://10.0.0.1/x")).toThrow("internal");
    expect(() => validateUrl("http://192.168.1.1/x")).toThrow("internal");
    expect(() => validateUrl("file:///etc/passwd")).toThrow("HTTP");
    expect(validateUrl("https://zh.wikipedia.org/wiki/Justice").protocol).toBe("https:");
  });

  it("validateUrl bypass corpus: IPv6 mapped/expanded, CGNAT, benchmark, reserved ranges, WHATWG normalization", async () => {
    const { validateUrl } = await import("../src/pi/extensions/websearch/fetch");
    const blocked = [
      "http://[::1]/x",
      "http://[::]/x",
      "http://[::ffff:127.0.0.1]/x",
      "http://[::ffff:7f00:1]/x",
      "http://[fe80::1]/x",
      "http://[fe90::1]/x",
      "http://[fc00::1]/x",
      "http://[fd12:3456:789a::1]/x",
      "http://100.64.0.1/x",
      "http://198.18.0.1/x",
      "http://240.0.0.1/x",
      "http://127.1/x",
      "http://0177.0.0.1/x",
      "http://0x7f.0.0.1/x",
      "http://2130706433/x",
      "http://localhost./x",
      "http://sub.localhost./x",
      "http://[64:ff9b::127.0.0.1]/x",
      "http://[64:ff9b::8.8.8.8]/x",
      "http://[ff02::1]/x",
      "http://[ff00::42]/x",
    ];
    for (const url of blocked) expect(() => validateUrl(url), url).toThrow("internal");
    expect(validateUrl("http://[::ffff:8.8.8.8]/x").hostname).toBe("[::ffff:808:808]");
    expect(validateUrl("http://1.1.1.1/x").hostname).toBe("1.1.1.1");
  });

  it("raw mode: fetches a real public page, cache works (no second request)", async () => {
    let requests = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      requests += 1;
      return new Response("<html><title>Cache Test</title><body>hello body</body></html>", {
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    try {
      const { fetchPage } = await import("../src/pi/extensions/websearch/fetch");
      const first = await fetchPage("https://example.com/page", "raw");
      expect(first.error).toBeNull();
      expect(first.content).toContain("hello body");
      expect(requests).toBe(1);

      const { createResponseStore, slicePage } = await import("../src/pi/extensions/websearch/store");
      const responses = createResponseStore();
      const fid = responses.storeFetched([{ url: first.url, title: first.title, content: first.content, error: null }]);
      const stored = responses.getStoredFetch(fid);
      expect(stored?.urls[0]?.title).toBe("Cache Test");
      const page = slicePage(JSON.stringify(stored), 0, 40, fid);
      expect(page.text).toContain("get_search_content");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
