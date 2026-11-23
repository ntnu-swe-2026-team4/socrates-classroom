import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedFixture } from "../src/seed";
import {
  call,
  classroomWithActivity,
  cookieOf,
  executeToolDirectly,
  fakeAiOf,
  frames,
  must,
  participantIdOf,
  toolTextOf,
} from "./helpers";

let thread: string;
let cookie: string;

async function connect(name: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${name}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = must(response?.webSocket, "websearch websocket");
  socket.accept();
  return socket;
}

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  const teacher = cookieOf(login);
  const created = await classroomWithActivity(teacher, "班");
  const joined = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: created.code, name: "同學", tosAccepted: true }),
  });
  cookie = cookieOf(joined);
  thread = `${created.activityId}:${await participantIdOf(created.activityId, cookie)}`;
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
  });

  it("fetch_content fetches any URL directly (no search-first gate; web is fully open)", async () => {
    const { createWebSearchExtension } = await import("../src/pi/extensions/websearch");
    const fakeAi = {
      websearch: async () =>
        new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }),
    };
    const extension = createWebSearchExtension(fakeAiOf(fakeAi));
    const tools = extension.tools ?? [];
    const fetchTool = must(
      tools.find((tool) => tool.name === "fetch_content"),
      "fetch_content tool",
    );

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<html><title>Justice</title><body>justice body</body></html>", {
        headers: { "content-type": "text/html" },
      });
    try {
      const fetched = await executeToolDirectly(fetchTool, { url: "https://example.org/wiki/Anything", mode: "raw" });
      expect(toolTextOf(fetched)).toContain("justice body");
      expect(toolTextOf(fetched)).not.toContain("web_search results");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("redirect hops must stay same-site (302 cross-site rejected; same-site allowed)", async () => {
    const { createWebSearchExtension } = await import("../src/pi/extensions/websearch");
    const fakeAi = {
      websearch: async () =>
        new Response(
          JSON.stringify({
            items: [
              { url: "https://zh.wikipedia.org/wiki/Justice", title: "Justice", description: "d" },
              { url: "https://en.wikipedia.org/wiki/Contract", title: "Contract", description: "d" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };
    const extension = createWebSearchExtension(fakeAiOf(fakeAi));
    const tools = extension.tools ?? [];
    await executeToolDirectly(
      must(
        tools.find((tool) => tool.name === "web_search"),
        "web_search tool",
      ),
      { query: "justice" },
    );
    const fetchTool = must(
      tools.find((tool) => tool.name === "fetch_content"),
      "fetch_content tool",
    );

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "attacker.example") throw new Error("attacker host must never be fetched");
      if (url.pathname === "/wiki/Justice") {
        return new Response(null, { status: 302, headers: { location: "https://attacker.example/evil" } });
      }
      if (url.hostname === "en.wikipedia.org") {
        return new Response("<html><body>contract body</body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<html><body>justice body</body></html>", { headers: { "content-type": "text/html" } });
    };
    try {
      const hijack = await executeToolDirectly(fetchTool, {
        url: "https://zh.wikipedia.org/wiki/Justice",
        mode: "raw",
      });
      expect(toolTextOf(hijack)).toContain("Blocked redirect target");
      expect(toolTextOf(hijack)).toContain("attacker.example");

      const chain = await executeToolDirectly(fetchTool, {
        url: "https://en.wikipedia.org/wiki/Contract",
        mode: "raw",
      });
      expect(toolTextOf(chain)).toContain("contract body");
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
      "http://[::ffff:192.168.1.1]/x",
      "http://[::ffff:172.16.0.1]/x",
      "http://[::ffff:169.254.169.254]/x",
      "http://[::ffff:10.0.0.1]/x",
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
      "http://[64:ff9b:1::127.0.0.1]/x",
      "http://[64:ff9b:1::8.8.8.8]/x",
      "http://[::ffff:0:127.0.0.1]/x",
      "http://[::ffff:0:192.168.1.1]/x",
      "http://[::ffff:0:0:127.0.0.1]/x",
      "http://[::127.0.0.1]/x",
      "http://[2002::7f00:1]/x",
      "http://224.0.0.1/x",
      "http://239.255.255.250/x",
      "http://[ff02::1]/x",
      "http://[ff00::42]/x",
    ];
    for (const url of blocked) expect(() => validateUrl(url), url).toThrow("internal");
    expect(validateUrl("http://[::ffff:8.8.8.8]/x").hostname).toBe("[::ffff:808:808]");
    expect(validateUrl("http://[2001:db8:ffff::1]/x").hostname).toBe("[2001:db8:ffff::1]");
    expect(validateUrl("http://[2001:db8:0:ffff::1]/x").hostname).toBe("[2001:db8:0:ffff::1]");
    expect(validateUrl("http://1.1.1.1/x").hostname).toBe("1.1.1.1");
  });

  it("raw mode: fetches a real public page, cache works (no second request)", async () => {
    let requests = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL) => {
      requests += 1;
      return new Response("<html><title>Cache Test</title><body>hello body</body></html>", {
        headers: { "content-type": "text/html" },
      });
    };
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

describe("get_search_content for fetch records + paging continuity", () => {
  it("a fetch_content responseId is readable via get_search_content beyond the inline preview", async () => {
    const { createWebSearchExtension } = await import("../src/pi/extensions/websearch");
    const longBody = `<html><body>${"y".repeat(25_000)}</body></html>`;
    const fakeAi = {
      websearch: async () =>
        new Response(
          JSON.stringify({
            items: [{ url: "https://en.wikipedia.org/wiki/Contract", title: "Contract", description: "d" }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };
    const extension = createWebSearchExtension(fakeAiOf(fakeAi));
    const tools = extension.tools ?? [];
    await executeToolDirectly(
      must(
        tools.find((tool) => tool.name === "web_search"),
        "web_search tool",
      ),
      { query: "contract" },
    );
    const fetchTool = must(
      tools.find((tool) => tool.name === "fetch_content"),
      "fetch_content tool",
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(longBody, { headers: { "content-type": "text/html" } });
    try {
      const fetched = await executeToolDirectly(fetchTool, {
        url: "https://en.wikipedia.org/wiki/Contract",
        mode: "raw",
      });
      const responseId = /responseId: ([\w-]+)/.exec(toolTextOf(fetched))?.[1];
      expect(responseId).toBeDefined();

      const retrieval = must(
        tools.find((tool) => tool.name === "get_search_content"),
        "get_search_content tool",
      );
      const tail = await executeToolDirectly(retrieval, { responseId, offset: 8_000, limit: 20_000 });
      expect(toolTextOf(tail)).toContain("yyyy");
      const head = await executeToolDirectly(retrieval, { responseId, offset: 0, limit: 20_000 });
      expect(toolTextOf(head)).toContain("responseId");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("slicePage hint offsets follow the delivered length — concatenating pages reproduces the original", async () => {
    const { slicePage } = await import("../src/pi/extensions/websearch/store");
    const content = "x".repeat(30_000);
    let offset = 0;
    const delivered: string[] = [];
    for (let guard = 0; offset < content.length && guard < 10; guard += 1) {
      const page = slicePage(content, offset, 20_000, "example");
      const chunk = must(page.text.split("\n\n---\n")[0], "delivered chunk");
      delivered.push(chunk);
      expect(page.endOffset).toBe(offset + chunk.length);
      offset = page.endOffset;
    }
    expect(delivered.join("")).toBe(content);
  });
});
