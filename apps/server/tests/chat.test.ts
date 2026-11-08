import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
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
      for (let i = 0; i < 500 && !check(list); i++) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      expect(check(list)).toBe(true);
    },
  };
}

function assistantText(view: ConversationView): string {
  return view.entries
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function latestView(list: ServerMessage[]): ConversationView | undefined {
  let view: ConversationView | undefined;
  for (const frame of list) {
    if (frame.type === "view") view = frame.view;
    if (frame.type === "ops" && view) view = applyImmutable(view, frame.ops);
  }
  return view;
}

describe("chat core（真 DO＋真 WebSocket＋faux）", () => {
  it("WS 升級→hello→watch→submit→回答進 transcript", async () => {
    const socket = await connect("t-basic");
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "正義是什麼？" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("正義是什麼");
    });

    const view = latestView(rx.list)!;
    const roles = view.entries.map((entry) => entry.model?.[0]?.role ?? entry.kind);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(assistantText(view)).toContain("直覺判斷");
    socket.close();
  });

  it("中斷後重連：transcript 從 pi storage 持久恢復", async () => {
    const socket = await connect("t-resume");
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "第一個問題" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("第一個問題");
    });
    socket.close();

    await evictDurableObject(env.Chat.get(env.Chat.idFromName("t-resume")));

    const again = await connect("t-resume");
    const rx2 = frames(again);
    await rx2.until((f) => f.some((m) => m.type === "hello"));
    again.send(JSON.stringify({ type: "watch" }));
    await rx2.until((f) => f.some((m) => m.type === "view"));
    const view = latestView(rx2.list)!;
    expect(assistantText(view)).toContain("第一個問題");
    again.close();
  });

  it("run 進行中第二發被拒（ConversationBusy error frame），連線不受影響", async () => {
    const socket = await connect("t-busy");
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "a", input: "問題 A" }));
    socket.send(JSON.stringify({ type: "submit", id: "b", input: "問題 B", whenBusy: "reject" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "b"));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "a"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);
});
