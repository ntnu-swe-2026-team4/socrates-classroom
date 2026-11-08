import { env } from "cloudflare:workers";
import { routeAgentRequest } from "agents";
import { applyImmutable } from "@earendil-works/chord/delta";
import { describe, expect, it } from "vitest";
import type { ConversationView } from "@earendil-works/pi-durable";
import type { ServerMessage } from "../src/ws/protocol";

async function connect(name: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${name}`, { headers: { Upgrade: "websocket" } }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = response!.webSocket as WebSocket;
  socket.accept();
  return socket;
}

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

function latestView(list: ServerMessage[]): ConversationView | undefined {
  let view: ConversationView | undefined;
  for (const frame of list) {
    if (frame.type === "view") view = frame.view;
    if (frame.type === "ops" && view) view = applyImmutable(view, frame.ops);
  }
  return view;
}

function toolNames(view: ConversationView | undefined): string[] {
  return (view?.entries ?? [])
    .flatMap((entry) => entry.model ?? [])
    .flatMap((message) => (message.role === "assistant" ? message.content : []))
    .filter((part) => part.type === "toolCall")
    .map((part) => (part.type === "toolCall" ? part.name : ""));
}

describe("judgment extension（違規偵測：自報 tool＋逐輪分類 task）", () => {
  it("無 AI binding：tool 註冊進 registry（hello 帶 tools）、回答正常、不炸", async () => {
    const socket = await connect("t-judgment");
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

  it("Socrates 使用 report_violation tool：app.violation entry（source=agent）出現在 transcript", async () => {
    const socket = await connect("t-report");
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
