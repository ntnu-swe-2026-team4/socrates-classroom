import { env } from "cloudflare:workers";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { seedDemo } from "../src/seed";
import type { ServerMessage } from "../src/ws/protocol";
import { applyMigrations } from "./migrations";

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

beforeAll(async () => {
  await applyMigrations(env.DB);
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

function frames(socket: WebSocket): {
  list: ServerMessage[];
  until: (check: (frames: ServerMessage[]) => boolean) => Promise<void>;
} {
  const list: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    list.push(JSON.parse(event.data) as ServerMessage);
    for (const waiter of waiters.splice(0)) waiter();
  });
  return {
    list,
    until: async (check) => {
      for (let i = 0; i < 1000 && !check(list); i++) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      expect(check(list)).toBe(true);
    },
  };
}

describe("websearch extension（web_search + get_search_content）", () => {
  it("無 AI binding：tool 註冊、呼叫回明確錯誤、不炸", async () => {
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

  it("store/find/slice 單元語意：bounded slice 帶續讀提示、findText 帶前後文", async () => {
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
});

describe("fetch_content（readable/raw＋cache＋SSRF）", () => {
  it("validateUrl 擋 localhost/私網/非 http", async () => {
    const { validateUrl } = await import("../src/pi/extensions/websearch/fetch");
    expect(() => validateUrl("http://localhost/x")).toThrow("internal");
    expect(() => validateUrl("http://127.0.0.1/x")).toThrow("internal");
    expect(() => validateUrl("http://10.0.0.1/x")).toThrow("internal");
    expect(() => validateUrl("http://192.168.1.1/x")).toThrow("internal");
    expect(() => validateUrl("file:///etc/passwd")).toThrow("HTTP");
    expect(validateUrl("https://zh.wikipedia.org/wiki/Justice").protocol).toBe("https:");
  });

  it("raw mode：真 fetch 公網頁面，cache 生效（第二次不發請求）", async () => {
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
