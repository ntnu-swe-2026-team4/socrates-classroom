import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { routeAgentRequest } from "agents";
import worker from "../src/index";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView } from "@earendil-works/pi-durable";
import type { Env } from "../src/env";
import type { ServerMessage } from "../src/ws/protocol";

export function frames(socket: WebSocket): {
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

export function assistantText(view: ConversationView): string {
  return view.entries
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function latestView(list: ServerMessage[]): ConversationView | undefined {
  let view: ConversationView | undefined;
  for (const frame of list) {
    if (frame.type === "view") view = frame.view;
    if (frame.type === "ops" && view) view = applyImmutable(view, frame.ops);
  }
  return view;
}

export function latestAssistantText(list: ServerMessage[]): string {
  const view = latestView(list);
  return view ? assistantText(view) : "";
}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    env,
    { waitUntil: () => {} },
  );
}

export function scopedEnv(overrides: Partial<Env>): Env {
  return Object.create(env as object, Object.getOwnPropertyDescriptors(overrides)) as Env;
}

export async function callWith(overrides: Partial<Env>, path: string, init: RequestInit = {}): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    scopedEnv(overrides),
    { waitUntil: () => {} },
  );
}

export function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
}

export async function joinGuest(
  code: string,
  name: string,
): Promise<{ cookie: string; participantId: string; activityId: string }> {
  const res = await call("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { activityId: string; participantId: string | null };
  expect(body.participantId).toBeTruthy();
  return { cookie: cookieOf(res), participantId: body.participantId!, activityId: body.activityId };
}

export async function registerStudent(
  code: string,
  name: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  const email = `student-${crypto.randomUUID()}@socrates.tw`;
  const res = await call("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, email, password: "student-pass-1", tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const user = (await res.json()) as { id: string };
  return { cookie: cookieOf(res), userId: user.id, email };
}

export async function participantIdOf(activityId: string, cookie: string): Promise<string> {
  const res = await call(`/api/activities/${activityId}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const { participantId } = (await res.json()) as { participantId: string | null };
  expect(participantId).toBeTruthy();
  return participantId!;
}

export interface StartedActivity {
  classroomId: string;
  code: string;
  activityId: string;
  mode: "live" | "test";
}

export async function createClassroom(
  cookie: string,
  name: string,
): Promise<{ classroomId: string; code: string; url: string }> {
  const res = await call("/api/classrooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { classroomId: string; code: string; url: string };
}

export async function systemTopicId(cookie: string): Promise<string> {
  const res = await call("/api/topics", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const topics = (await res.json()) as Array<{ id: string }>;
  expect(topics.length).toBeGreaterThan(0);
  return topics[0]!.id;
}

export async function startActivity(
  cookie: string,
  classroomId: string,
  topicId: string,
  mode: "live" | "test" = "live",
): Promise<StartedActivity> {
  const res = await call(`/api/classrooms/${classroomId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ topicId, mode }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as StartedActivity;
}

export async function classroomWithActivity(
  cookie: string,
  name: string,
  topicId?: string,
  mode: "live" | "test" = "live",
): Promise<StartedActivity> {
  const classroom = await createClassroom(cookie, name);
  const topic = topicId ?? (await systemTopicId(cookie));
  const started = await startActivity(cookie, classroom.classroomId, topic, mode);
  return { ...started, code: classroom.code };
}

export async function speak(thread: string, cookie: string, question: string): Promise<void> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = response!.webSocket as WebSocket;
  socket.accept();
  const rx = frames(socket);
  await rx.until((f) => f.some((m) => m.type === "hello"));
  socket.send(JSON.stringify({ type: "watch" }));
  await rx.until((f) => f.some((m) => m.type === "view"));
  socket.send(JSON.stringify({ type: "submit", id: "s1", input: question }));
  await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
  await rx.until((f) => latestAssistantText(f).includes("直覺判斷"));
  socket.close();
}
