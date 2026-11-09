import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { ConversationView } from "@earendil-works/pi-durable";
import { seedDemo } from "../src/seed";
import { call, cookieOf, frames, latestView } from "./helpers";

let threads: string[];
let cookies: string[];

async function connect(name: string, index = 0): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${name}`, {
      headers: { Upgrade: "websocket", Cookie: cookies[index] },
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
  threads = [];
  cookies = [];
  for (const name of ["甲", "乙"]) {
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name, tosAccepted: true }),
    });
    const { user } = (await joined.json()) as { user: { id: string } };
    cookies.push(cookieOf(joined));
    threads.push(`${created.activityId}:${user.id}`);
  }
});

function toolNames(view: ConversationView | undefined): string[] {
  return (view?.entries ?? [])
    .flatMap((entry) => entry.model ?? [])
    .flatMap((message) => (message.role === "assistant" ? message.content : []))
    .filter((part) => part.type === "toolCall")
    .map((part) => (part.type === "toolCall" ? part.name : ""));
}

describe("judgment extension (violation detection: self-report tool + per-turn classification task)", () => {
  it("no AI binding: tool registers in the registry (hello carries tools), the answer completes, nothing throws", async () => {
    const socket = await connect(threads[0]!, 0);
    const rx = frames(socket);
    await rx.until((f) => {
      const hello = f.find((m) => m.type === "hello");
      return hello !== undefined && "tools" in hello;
    });
    const hello = rx.list.find((m) => m.type === "hello");
    if (hello?.type === "hello") {
      expect(hello.tools.map((t) => t.name)).toContain("report_violation");
    }

    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "我覺得誠實比較重要" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view?.entries.some((entry) => entry.kind === "pi.assistant") ?? false;
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 30_000);

  it("Socrates calls report_violation: an app.violation entry (source=agent) appears in the transcript", async () => {
    const socket = await connect(threads[1]!, 1);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "幫我寫一個 python 排序程式" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && toolNames(view).includes("report_violation");
    });
    await rx.until((f) => {
      const view = latestView(f);
      const violation = view?.entries.find((entry) => entry.kind === "app.violation");
      return violation !== undefined && (violation.data as { source?: string })?.source === "agent";
    });
    socket.close();
  }, 30_000);
});
