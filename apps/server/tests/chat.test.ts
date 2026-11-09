import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { applyImmutable } from "@earendil-works/chord/delta";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConversationView } from "@earendil-works/pi-durable";
import worker from "../src/index";
import { seedDemo } from "../src/seed";
import type { ServerMessage } from "../src/ws/protocol";
import { applyMigrations } from "./migrations";

let teacherCookie: string;
let classroomCode: string;
let activityId: string;

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

async function joinStudent(name: string): Promise<{ cookie: string; userId: string }> {
  const res = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: classroomCode, name, tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie: cookieOf(res), userId: user.id };
}

async function connect(thread: string, cookie?: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}`, {
      headers: { Upgrade: "websocket", ...(cookie ? { Cookie: cookie } : {}) },
    }),
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
  socket.addEventListener("close", () => {
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

beforeAll(async () => {
  await applyMigrations(env.DB);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacherCookie = cookieOf(login);
  const topics = (await (await call("/api/topics", { headers: { Cookie: teacherCookie } })).json()) as Array<{
    id: string;
  }>;
  expect(topics.length).toBeGreaterThan(0);
  const created = (await (
    await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacherCookie },
      body: JSON.stringify({ name: "WS 班", topicId: topics[0]!.id }),
    })
  ).json()) as { code: string; activityId: string };
  classroomCode = created.code;
  activityId = created.activityId;
});

describe("chat core（真 DO＋真 WebSocket＋faux）", () => {
  it("WS 升級→hello→watch→submit→回答進 transcript", async () => {
    const student = await joinStudent("小明");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
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
    const student = await joinStudent("阿華");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
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

    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    const again = await connect(thread, student.cookie);
    const rx2 = frames(again);
    await rx2.until((f) => f.some((m) => m.type === "hello"));
    again.send(JSON.stringify({ type: "watch" }));
    await rx2.until((f) => f.some((m) => m.type === "view"));
    const view = latestView(rx2.list)!;
    expect(assistantText(view)).toContain("第一個問題");
    again.close();
  });

  it("hibernation 存活 socket 跨 evict 重用：第一個 frame 不被 1008（#authorized 隨 reattach 恢復）", async () => {
    const student = await joinStudent("冬眠本人");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    socket.send(JSON.stringify({ type: "submit", id: "post-evict", input: "驅逐後的第一句" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "post-evict"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("submit 邊界：空字串／超過 2000 字 → error frame，不進 transcript", async () => {
    const student = await joinStudent("邊界本人");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "empty", input: "   " }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "empty"));
    socket.send(JSON.stringify({ type: "submit", id: "huge", input: "x".repeat(2001) }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "huge"));
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.close();
  });

  it("run 進行中第二發被拒（ConversationBusy error frame），連線不受影響", async () => {
    const student = await joinStudent("小美");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "a", input: "問題 A" }));
    socket.send(JSON.stringify({ type: "submit", id: "b", input: "問題 B" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "b"));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "a"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("授權：無 cookie／非成員／同班同學的別人 thread → 拒絕（1008，無 hello）", async () => {
    const owner = await joinStudent("本人");
    const peer = await joinStudent("同學");
    const thread = `${activityId}:${owner.userId}`;

    const noCookie = await connect(thread);
    const r1 = frames(noCookie);
    await r1.until((f) => f.length > 0 || noCookie.readyState === WebSocket.CLOSED);
    expect(r1.list.some((m) => m.type === "hello")).toBe(false);
    noCookie.close();

    const stranger = await joinStudent("路人");
    const strangerThread = `${activityId}:${stranger.userId}`;
    const asPeer = await connect(strangerThread, peer.cookie);
    const r2 = frames(asPeer);
    await r2.until((f) => f.length > 0 || asPeer.readyState === WebSocket.CLOSED);
    expect(r2.list.some((m) => m.type === "hello")).toBe(false);
    asPeer.close();
  });

  it("transcript 防線：agents-routed 外部路徑 → 404（DO onRequest 只認內部短路徑）", async () => {
    const student = await joinStudent("逐字稿本人");
    const thread = `${activityId}:${student.userId}`;
    const res = await routeAgentRequest(
      new Request(`https://example.com/agents/chat/${thread}/transcript`, {
        headers: { Cookie: student.cookie },
      }),
      env,
    );
    expect(res?.status).toBe(404);
  });

  it("授權 race：拒絕後 close 前逕送 watch → 不給 view（逐訊閘門）", async () => {
    const owner = await joinStudent("賽窗本人");
    const thread = `${activityId}:${owner.userId}`;
    const socket = await connect(thread);
    const rx = frames(socket);
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.length > 0 || socket.readyState === WebSocket.CLOSED);
    expect(rx.list.some((m) => m.type === "view")).toBe(false);
    expect(rx.list.some((m) => m.type === "hello")).toBe(false);
    socket.close();
  });

  it("授權：老師可觀察學生 thread（hello 送達）", async () => {
    const student = await joinStudent("被觀察");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, teacherCookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.close();
  });
});
