import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { evictDurableObject } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedDemo } from "../src/seed";
import { run } from "../src/db/d1";
import { assistantText, call, cookieOf, frames, latestView } from "./helpers";

let teacherCookie: string;
let classroomCode: string;
let activityId: string;

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

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
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

describe("chat core (real DO + real WebSocket + faux model)", () => {
  it("WS upgrade → hello → watch → submit → answer lands in transcript", async () => {
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

  it("reconnect after disconnect: transcript restored persistently from pi storage", async () => {
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

  it("hibernated socket survives eviction and is reused: first frame is not 1008 (#authorized restored on reattach)", async () => {
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

  it("revoked member is refused after hibernation wake (membership re-verified, not trusted from connect time)", async () => {
    const student = await joinStudent("被移出的學生");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    await run(
      env.DB,
      "DELETE FROM members WHERE user_id = $uid AND classroom_id = (SELECT classroom_id FROM activities WHERE id = $aid)",
      { uid: student.userId, aid: activityId },
    );
    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    socket.send(JSON.stringify({ type: "submit", id: "revoked", input: "還能送嗎" }));
    const closed = await new Promise<{ code: number; reason: string; wasClean: boolean } | null>((resolve) => {
      socket.addEventListener("close", (event) =>
        resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean }),
      );
      setTimeout(() => resolve(null), 8000);
    });
    expect(closed?.code).toBe(1008);
    expect(rx.list.some((m) => m.type === "result" && m.id === "revoked")).toBe(false);
  }, 20_000);

  it("submit bounds: empty string / over 2000 chars → error frame, nothing enters the transcript", async () => {
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

  it("a second submit during a run is rejected (ConversationBusy error frame); the connection is unaffected", async () => {
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
    const busy = rx.list.find((m) => m.type === "error" && m.id === "b");
    expect(busy).toMatchObject({ code: "ConversationBusy" });
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "a"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("abort op: replies with a result (one of the three values); connection unaffected", async () => {
    const student = await joinStudent("阿捷");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "q", input: "長問題" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "q"));
    socket.send(JSON.stringify({ type: "abort", id: "ab" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "ab"));
    const abortResult = rx.list.find((m) => m.type === "result" && m.id === "ab") as unknown as {
      result: unknown;
    };
    expect(typeof abortResult.result).toBe("boolean");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("entries op: replies with paged items; limit takes effect", async () => {
    const student = await joinStudent("阿查");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "q", input: "正義是什麼？" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view?.entries.some((entry) => entry.kind === "pi.assistant" && assistantText(view).length > 0) ?? false;
    });
    socket.send(JSON.stringify({ type: "entries", id: "e1", query: { order: "ascending" }, limit: 100 }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "e1"));
    const page = rx.list.find((m) => m.type === "result" && m.id === "e1") as unknown as {
      result: { items: Array<{ kind: string }> };
    };
    const kinds = page.result.items.map((entry) => entry.kind);
    expect(kinds).toContain("pi.user");
    expect(kinds).toContain("pi.assistant");
    socket.send(JSON.stringify({ type: "entries", id: "e2", query: { order: "ascending" }, limit: 1 }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "e2"));
    const single = rx.list.find((m) => m.type === "result" && m.id === "e2") as unknown as {
      result: { items: unknown[] };
    };
    expect(single.result.items.length).toBeLessThanOrEqual(1);
    socket.close();
  }, 20_000);

  it("authorization: no cookie / non-member / another student's thread → rejected (1008, no hello)", async () => {
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

  it("transcript guard: externally agents-routed path → 404 (the DO's onRequest only accepts internal shortcuts)", async () => {
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

  it("authorization race: watch sent after rejection but before close → no view (per-message gate)", async () => {
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

  it("authorization: a teacher may observe a student thread (hello arrives)", async () => {
    const student = await joinStudent("被觀察");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, teacherCookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.close();
  });
});

describe("teacher thread access: observe and abort yes, submit no (SubmitForbidden)", () => {
  it("teacher submit on a student thread is rejected with code SubmitForbidden; abort still allowed", async () => {
    const student = await joinStudent("代打對象");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, teacherCookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "t1", input: "老師代打" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "t1"));
    const forbidden = rx.list.find((m) => m.type === "error" && m.id === "t1");
    expect(forbidden).toMatchObject({ code: "SubmitForbidden" });
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.send(JSON.stringify({ type: "abort", id: "t2" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "t2"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);
});

describe("activity_finished reaches the client as a named error code", () => {
  it("submit after finish → error frame code ActivityFinished (not generic Request failed)", async () => {
    const student = await joinStudent("下課本人");
    const thread = `${activityId}:${student.userId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    const finish = await call(`/api/activities/${activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie },
    });
    expect(finish.status).toBe(204);
    socket.send(JSON.stringify({ type: "submit", id: "late", input: "遲來的訊息" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "late"));
    const frame = rx.list.find((m) => m.type === "error" && m.id === "late");
    expect(frame).toMatchObject({ code: "ActivityFinished", message: "activity_finished" });
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.close();
  }, 20_000);
});
