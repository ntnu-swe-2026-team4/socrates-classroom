import { env } from "cloudflare:workers";
import { applyD1Migrations, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { routeAgentRequest } from "agents";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createApp } from "../src/app";
import { seedFixture } from "../src/seed";
import type { ClientMessage, ServerMessage } from "../src/ws/protocol";
import type { SoloThread } from "@socrates/shared";
import { all, batch } from "../src/db/d1";
import type { SoloChat } from "../src/do/solo-chat";
import { frames, latestView } from "./helpers";

const migrations = inject("d1Migrations");

let userCookie: string;
let userId: string;
let otherCookie: string;
let otherUserId: string;

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function cookieOf(response: Response): string {
  return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `https://example.com${path}`;
  return createApp().fetch(new Request(url, init), env);
}

async function connectSolo(thread: string, cookie?: string, lang?: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/solo-chat/${thread}${lang ? `?lang=${lang}` : ""}`, {
      headers: { Upgrade: "websocket", ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = must(response?.webSocket, "solo chat websocket");
  socket.accept();
  return socket;
}

function waitMessage<T extends ServerMessage>(
  socket: WebSocket,
  predicate: (message: ServerMessage) => message is T,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeoutMs);
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as ServerMessage;
        if (predicate(parsed)) {
          clearTimeout(timer);
          resolve(parsed);
        }
      } catch {
        // ignore parse error
      }
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket closed with code ${event.code}: ${event.reason}`));
    });
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);

  const login1 = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login1.status).toBe(200);
  userCookie = cookieOf(login1);
  const me1 = (await (await call("/api/me", { headers: { Cookie: userCookie } })).json()) as { id: string };
  userId = me1.id;

  const login2 = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "student-a@socrates.tw", password: "demo-demo" }),
  });
  expect(login2.status).toBe(200);
  otherCookie = cookieOf(login2);
  const me2 = (await (await call("/api/me", { headers: { Cookie: otherCookie } })).json()) as { id: string };
  otherUserId = me2.id;
});

describe("Solo chat REST API", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const list = await call("/api/solo/threads");
    expect(list.status).toBe(401);

    const create = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "test" }),
    });
    expect(create.status).toBe(401);
  });

  it("creates, reads, renames, and deletes a thread", async () => {
    const createRes = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ title: "我的自由思考" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as SoloThread;
    expect(created.id).toMatch(/^solo_/);
    expect(created.title).toBe("我的自由思考");
    expect(created.createdAt).toBeDefined();

    const listRes = await call("/api/solo/threads", { headers: { Cookie: userCookie } });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as SoloThread[];
    expect(list.some((t) => t.id === created.id && t.title === "我的自由思考")).toBe(true);

    const getRes = await call(`/api/solo/threads/${created.id}`, { headers: { Cookie: userCookie } });
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as SoloThread;
    expect(got.id).toBe(created.id);

    const otherGet = await call(`/api/solo/threads/${created.id}`, { headers: { Cookie: otherCookie } });
    expect(otherGet.status).toBe(404);

    const patchRes = await call(`/api/solo/threads/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ title: "改名後的辯題" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as SoloThread;
    expect(patched.title).toBe("改名後的辯題");

    const deleteRes = await call(`/api/solo/threads/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: userCookie },
    });
    expect(deleteRes.status).toBe(204);

    const afterGet = await call(`/api/solo/threads/${created.id}`, { headers: { Cookie: userCookie } });
    expect(afterGet.status).toBe(404);
  });

  it("cascades deletion when user is deleted", async () => {
    const createRes = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: otherCookie },
      body: JSON.stringify({ title: "即將被刪除的對話" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as SoloThread;

    const before = await all<{ n: number }>(env.DB, "SELECT COUNT(*) as n FROM solo_threads WHERE id = $id", {
      id: created.id,
    });
    expect(before[0]?.n).toBe(1);

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(otherUserId).run();

    const after = await all<{ n: number }>(env.DB, "SELECT COUNT(*) as n FROM solo_threads WHERE id = $id", {
      id: created.id,
    });
    expect(after[0]?.n).toBe(0);
  });
});

describe("Solo chat WebSocket communication", () => {
  it("refuses to open a thread that has no record owned by the signed-in user", async () => {
    const socket = await connectSolo(`${userId}:solo_missing`, userCookie);
    try {
      const firstEvent = await new Promise<string | number>((resolve) => {
        socket.addEventListener("message", (event) => {
          if ((JSON.parse(event.data as string) as ServerMessage).type === "hello") resolve("hello");
        });
        socket.addEventListener("close", (event) => resolve(event.code), { once: true });
      });
      expect(firstEvent).toBe(1008);
    } finally {
      socket.close();
    }
  });

  it("refuses subsequent requests on an open socket after the thread is deleted", async () => {
    const created = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ title: "Deleted thread" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as SoloThread;
    const socket = await connectSolo(`${userId}:${id}`, userCookie);
    try {
      await waitMessage(socket, (message): message is ServerMessage & { type: "hello" } => message.type === "hello");
      const removed = await call(`/api/solo/threads/${id}`, { method: "DELETE", headers: { Cookie: userCookie } });
      expect(removed.status).toBe(204);
      const firstEvent = new Promise<string | number>((resolve) => {
        socket.addEventListener("message", () => resolve("message"), { once: true });
        socket.addEventListener("close", (event) => resolve(event.code), { once: true });
      });
      socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
      expect(await firstEvent).toBe(1008);
    } finally {
      socket.close();
    }
  });

  it("rejects unauthorized connection with 1008", async () => {
    const thread = `${userId}:solo_test1`;
    const res = await routeAgentRequest(
      new Request(`https://example.com/agents/solo-chat/${thread}`, {
        headers: { Upgrade: "websocket" },
      }),
      env,
    );
    expect(res?.status).toBe(101);
    const socket = must(res?.webSocket, "ws");
    socket.accept();

    const closeCode = await new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code));
    });
    expect(closeCode).toBe(1008);
  });

  it("rejects connection if userId in path does not match cookie", async () => {
    const thread = `u_someone_else:solo_test2`;
    const res = await routeAgentRequest(
      new Request(`https://example.com/agents/solo-chat/${thread}`, {
        headers: { Upgrade: "websocket", Cookie: userCookie },
      }),
      env,
    );
    expect(res?.status).toBe(101);
    const socket = must(res?.webSocket, "ws");
    socket.accept();

    const closeCode = await new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code));
    });
    expect(closeCode).toBe(1008);
  });

  it("establishes connection and handles Socratic dialogue roundtrip", async () => {
    const createRes = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userCookie },
      body: JSON.stringify({ title: "自由意志是否存在？" }),
    });
    const threadInfo = (await createRes.json()) as SoloThread;
    const threadName = `${userId}:${threadInfo.id}`;

    const socket = await connectSolo(threadName, userCookie);

    const hello = await waitMessage(socket, (msg): msg is ServerMessage & { type: "hello" } => msg.type === "hello");
    expect(hello.type).toBe("hello");

    socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
    const view = await waitMessage(socket, (msg): msg is ServerMessage & { type: "view" } => msg.type === "view");
    expect(view.type).toBe("view");

    socket.send(
      JSON.stringify({
        type: "submit",
        id: "req-1",
        input: "我認為人有完全的自由意志。",
      } satisfies ClientMessage),
    );

    const result = await waitMessage(
      socket,
      (msg): msg is ServerMessage & { type: "result" } => msg.type === "result" && msg.id === "req-1",
    );
    expect(result.type).toBe("result");

    const ops = await waitMessage(socket, (msg): msg is ServerMessage & { type: "ops" } => msg.type === "ops");
    expect(ops.type).toBe("ops");
    expect(ops.ops.length).toBeGreaterThan(0);

    socket.close();
  });

  it("routes solo dialogue through the thread owner's gateway and records usage for that account", async () => {
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student-b@socrates.tw", password: "demo-demo" }),
    });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    const { id: ownerId } = (await login.json()) as { id: string };
    const created = await call("/api/solo/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as SoloThread;
    const thread = `${ownerId}:${id}`;
    const provider = "account-gateway";
    const params = { owner: ownerId, other: userId, provider, now: new Date().toISOString() };
    await batch(env.DB, [
      {
        sql: `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
              VALUES ($owner, $provider, 'enc', 'xxxx', 0, $now), ($other, $provider, 'enc', 'xxxx', 0, $now)`,
        params,
      },
      {
        sql: `INSERT INTO teacher_key_models (user_id, provider_id, model, sort_order, updated_at)
              VALUES ($owner, $provider, 'owner-model', 0, $now), ($other, $provider, 'other-model', 0, $now)`,
        params,
      },
    ]);
    const stub = env.SoloChat.get(env.SoloChat.idFromName(thread));
    await runInDurableObject(stub, (instance) => {
      const faux = fauxProvider({ provider, models: [{ id: "owner-model" }, { id: "other-model" }] });
      faux.setResponses([fauxAssistantMessage("Why?")]);
      (instance as SoloChat).models.models.setProvider(faux.provider);
    });

    const socket = await connectSolo(thread, cookie);
    try {
      const rx = frames(socket);
      await rx.until((messages) => messages.some((message) => message.type === "hello"));
      socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
      await rx.until((messages) => messages.some((message) => message.type === "view"));
      socket.send(JSON.stringify({ type: "submit", id: "gateway", input: "What is justice?" } satisfies ClientMessage));
      const assistant = (messages: ServerMessage[]) =>
        latestView(messages)
          ?.entries.flatMap((entry) => entry.model ?? [])
          .find((message) => message.role === "assistant");
      await rx.until((messages) => assistant(messages) !== undefined);
      expect(assistant(rx.list)).toMatchObject({ provider, model: "owner-model" });
      await expect
        .poll(() =>
          all(env.DB, "SELECT user_id, model FROM teacher_key_usage WHERE provider_id = $provider", { provider }),
        )
        .toEqual([{ user_id: ownerId, model: "owner-model" }]);
    } finally {
      socket.close();
    }
  });
});
