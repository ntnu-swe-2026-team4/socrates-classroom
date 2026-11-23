import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { routeAgentRequest } from "agents";
import worker from "../src/index";
import { applyImmutable } from "@earendil-works/chord/delta";
import {
  ROOT_CONVERSATION_ID,
  type EntryRecord,
  type ConversationView,
  type PromptSection,
} from "@earendil-works/pi-durable";
import { conversationIdOf, entryIdOf } from "../src/ws/protocol";
import {
  ACTIVITY_MODES,
  type ActivityMode,
  type Lang,
  ThinkingIndicatorsSchema,
  type ThinkingIndicators,
} from "@socrates/shared";
import { SUBMIT_STUDENT_INDICATORS } from "../src/pi/extensions/report-submit";
import type { Env } from "../src/env";
import type { Ai } from "@cloudflare/workers-types";
import type { ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable";
import { sealAccountToken, type AccountTokenPurpose } from "../src/auth";
import { parseServerMessage, type ServerMessage } from "../src/ws/protocol";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Harness } from "@earendil-works/pi-durable";
import type { Registry } from "@earendil-works/pi-durable";
import type { ReportRunner } from "../src/do/report-runner";
import type { TeacherLeg } from "../src/pi/credentials";

export function frames(socket: WebSocket): {
  list: ServerMessage[];
  until: (check: (frames: ServerMessage[]) => boolean) => Promise<void>;
} {
  const list: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = parseServerMessage(event.data);
    if (frame === null) return;
    if (process.env.DEBUG_FRAMES) console.log("[frame]", JSON.stringify(frame).slice(0, 140));
    list.push(frame);
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

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined;
}

export function str(value: unknown, key: string): string {
  const found = field(value, key);
  if (typeof found !== "string") throw new Error(`expected string field: ${key}`);
  return found;
}

export function optStr(value: unknown, key: string): string | null {
  const found = field(value, key);
  if (found === undefined || found === null) return null;
  if (typeof found !== "string") throw new Error(`expected string or null field: ${key}`);
  return found;
}

export function num(value: unknown, key: string): number {
  const found = field(value, key);
  if (typeof found !== "number") throw new Error(`expected number field: ${key}`);
  return found;
}

export function optNum(value: unknown, key: string): number | null {
  const found = field(value, key);
  if (found === undefined || found === null) return null;
  if (typeof found !== "number") throw new Error(`expected number or null field: ${key}`);
  return found;
}

export function bool(value: unknown, key: string): boolean {
  const found = field(value, key);
  if (typeof found !== "boolean") throw new Error(`expected boolean field: ${key}`);
  return found;
}

export function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected a JSON array");
  return value;
}

export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`fixture missing: ${what}`);
  return value;
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

// The worker entry's fetch signature (env injected by the vitest pool) behind
// one cast for every test-side harness.
export function workerFetch(
  env: unknown,
  request: Request,
  onWait?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    request,
    env,
    {
      waitUntil: (promise: Promise<unknown>) => {
        onWait?.(promise);
      },
    },
  );
}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return workerFetch(env, new Request(`http://worker.test${path}`, init));
}

export function scopedEnv(overrides: Record<string, unknown>): Env {
  return Object.create(env as object, Object.getOwnPropertyDescriptors(overrides)) as Env;
}

export async function callWith(overrides: Partial<Env>, path: string, init: RequestInit = {}): Promise<Response> {
  return workerFetch(scopedEnv(overrides), new Request(`http://worker.test${path}`, init));
}

export function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0] ?? "";
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
  const body = await res.json();
  return {
    cookie: cookieOf(res),
    participantId: str(body, "participantId"),
    activityId: str(body, "activityId"),
  };
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
  return { cookie: cookieOf(res), userId: str(await res.json(), "id"), email };
}

export async function participantIdOf(activityId: string, cookie: string): Promise<string> {
  const res = await call(`/api/activities/${activityId}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return str(await res.json(), "participantId");
}

export interface StartedActivity {
  classroomId: string;
  code: string;
  activityId: string;
  mode: ActivityMode;
}

function parseActivityMode(value: string): ActivityMode {
  const mode = ACTIVITY_MODES.find((candidate) => candidate === value);
  return must(mode, `activity mode: ${value}`);
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
  const created = await res.json();
  return { classroomId: str(created, "classroomId"), code: str(created, "code"), url: str(created, "url") };
}

export async function systemTopicId(cookie: string): Promise<string> {
  const res = await call("/api/topics", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const topics = rows(await res.json());
  expect(topics.length).toBeGreaterThan(0);
  return str(topics[0], "id");
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
  const started = await res.json();
  return {
    classroomId: str(started, "classroomId"),
    code: str(started, "code"),
    activityId: str(started, "activityId"),
    mode: parseActivityMode(str(started, "mode")),
  };
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
  const socket = must(response?.webSocket, "chat websocket");
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

// agents' MODEL_OPTIONS symbol: fallback legs are bound on the model object
export function modelFallbackOf(model: unknown): string[] | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const OPTIONS = Symbol.for("agents.models.pi-ai.options");
  const options: unknown = Reflect.get(model, OPTIONS);
  if (typeof options !== "object" || options === null) return undefined;
  const fallback: unknown = Reflect.get(options, "fallback");
  if (!Array.isArray(fallback)) return undefined;
  return fallback.filter((entry): entry is string => typeof entry === "string");
}

// Memory-only EntryRecord fixture for pure-function tests: pi's branded ids
// mint through the protocol helpers so the fixture carries no assertions.
export function entryFixture(fields: {
  id: number;
  kind: string;
  data?: Record<string, unknown>;
  text?: string;
}): EntryRecord {
  const base: EntryRecord = {
    id: entryIdOf(fields.id),
    conversationId: conversationIdOf("1"),
    kind: fields.kind,
  };
  if (fields.text !== undefined) {
    return { ...base, model: [{ role: "user", content: fields.text, timestamp: 0 }] };
  }
  if (fields.data !== undefined) {
    return { ...base, data: JSON.parse(JSON.stringify(fields.data)) };
  }
  return base;
}

export function toolTextOf(result: { output?: ToolResultMessage["content"] }): string {
  const parts: string[] = [];
  for (const part of result.output ?? []) {
    if (part.type === "text") parts.push(part.text);
  }
  return parts.join("");
}

// Narrow executor for tools whose execute() reads neither the api nor the
// context (websearch family): ToolRegistration<Record<string, unknown>> types execute.s args as
// unknown, so the call carries the tool's own args contract without assertions.
export function executeToolDirectly(
  tool: ToolRegistration<Record<string, unknown>>,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  return tool.execute(args, undefined as never, undefined as never);
}

// pi sections render against a full PromptInput (agent, registry reads); unit
// probes exercise the section's own closure, which reads none of it.
export function promptInputOf(): Parameters<PromptSection["render"]>[0] {
  return { conversationId: ROOT_CONVERSATION_ID } as unknown as Parameters<PromptSection["render"]>[0];
}

export type ResultFrame = Extract<ServerMessage, { type: "result" }>;

export function resultFrameOf(list: ServerMessage[], id: string): ResultFrame | undefined {
  return list.find((message): message is ResultFrame => message.type === "result" && message.id === id);
}

export function symbolValue<T>(obj: object, key: symbol): T | undefined {
  return (obj as Record<symbol, unknown>)[key] as T | undefined;
}

// Tests only ever touch the fields a case exercises; a Proxy Env keeps the
// partial-object shape without per-case `as never` on the full Env contract.
export function fakeEnv(fields: Record<string, unknown>): Env {
  return new Proxy({} as Env, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return fields[prop];
    },
    has(_target, prop: string | symbol) {
      return typeof prop === "string" && prop in fields;
    },
  });
}

// Same proxying for the workers Ai binding: fixtures declare only the
// capability under test (websearch, run, …) and the rest stays undefined.
export function fakeAiOf(fields: Record<string, unknown>): Ai {
  return new Proxy({} as Ai, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return fields[prop];
    },
    has(_target, prop: string | symbol) {
      return typeof prop === "string" && prop in fields;
    },
  });
}

export function failingAi(): Ai {
  return fakeAiOf({
    run: async () => {
      throw new Error("upstream down");
    },
  });
}

// ReportRunner's indicator pipeline is private; the empty-transcript probe
// drives it through the same methods the alarm path uses.
export async function probeOpenHarness(runner: object): Promise<Harness> {
  const openHarness = Reflect.get(runner, "openHarness") as ReportRunner["openHarness"] | undefined;
  if (typeof openHarness !== "function") throw new Error("runner has no openHarness");
  const registry: Registry = Reflect.get(runner, "indicatorsRegistry");
  return openHarness.call(runner, registry);
}

export function probeStudentIndicators(
  runner: object,
  harness: Harness,
  activity: { title: string; statement: string },
  transcript: string,
  spokenLines: number,
  legs: TeacherLeg[],
  lang: Lang,
): Promise<ThinkingIndicators | null> {
  const studentJudgment = Reflect.get(runner, "studentJudgment") as ReportRunner["studentJudgment"] | undefined;
  if (typeof studentJudgment !== "function") throw new Error("runner has no studentJudgment");
  return studentJudgment.call(
    runner,
    { profile: "student-indicators", submitTool: SUBMIT_STUDENT_INDICATORS, schema: ThinkingIndicatorsSchema },
    harness,
    runner as unknown as Registry,
    activity,
    transcript,
    spokenLines,
    legs,
    lang,
  ) as Promise<ThinkingIndicators | null>;
}

// The purpose-mismatch probe signs a claim outside the AccountTokenPurpose
// union — the whole point is that no legitimate caller can mint it.
export function foreignPurposeToken(uid: string, ttlMs: number): Promise<string> {
  const foreign = "email_verify" as AccountTokenPurpose;
  return sealAccountToken({ env }, foreign, uid, "binding", ttlMs);
}
