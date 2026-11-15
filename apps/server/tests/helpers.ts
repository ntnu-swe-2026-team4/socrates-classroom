import { env } from "cloudflare:workers";
import { expect } from "vitest";
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

export async function callWith(overrides: Partial<Env>, path: string, init: RequestInit = {}): Promise<Response> {
  const scoped = Object.assign(Object.create(env as object), overrides) as unknown as Env;
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    scoped,
    { waitUntil: () => {} },
  );
}

export function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.()[0] ?? "").split(";")[0]!;
}

export async function participantIdOf(activityId: string, cookie: string): Promise<string> {
  const res = await call(`/api/activities/${activityId}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const { participantId } = (await res.json()) as { participantId: string | null };
  expect(participantId).toBeTruthy();
  return participantId!;
}
