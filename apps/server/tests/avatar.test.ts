import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { ConversationView } from "@earendil-works/pi-durable";
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

function answerOf(view: ConversationView): string {
  return view.entries
    .filter((entry) => entry.kind === "pi.assistant")
    .flatMap((entry) => entry.model ?? [])
    .map((message) => {
      if (message.role !== "assistant") return "";
      const content = message.content;
      if (typeof content === "string") return content;
      return content.map((part) => (part.type === "text" ? part.text : "")).join("");
    })
    .join("");
}

describe("avatar extension (emotion via app.emotion entry, zero text pollution)", () => {
  it("no AI binding: the answer completes normally, nothing throws, text carries no format tags", async () => {
    const socket = await connect(thread);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "我覺得誠實比較重要" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view?.entries.some((entry) => entry.kind === "pi.assistant") ?? false;
    });

    const view = latestView(rx.list)!;
    expect(answerOf(view)).not.toMatch(/\[(happy|angry|confused|neutral|Happy|Confused|Angry|Neutral)\]/);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 30_000);
});
