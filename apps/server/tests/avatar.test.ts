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

describe("avatar extension（情緒走 app.emotion entry，文字零污染）", () => {
  it("無 AI binding：回答正常完成、不炸、文字不含任何格式 tag", async () => {
    const socket = await connect("t-avatar");
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
