import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useDialogue } from "@/hooks/useDialogue";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ServerMessage } from "@server/ws/protocol";
import { conversationIdOf, entryIdOf, viewFrame as viewFrameOf } from "../helpers";
import type { AssistantMessage } from "@earendil-works/pi-ai";

type AgentOptions = {
  onOpen?: (event: { target: unknown }) => void;
  onMessage?: (event: { data: unknown }) => void;
};

const agent = vi.hoisted((): { options: AgentOptions | null; sent: string[] } => ({
  options: null,
  sent: [],
}));

vi.mock("agents/react", () => ({
  useAgent: (options: AgentOptions) => {
    agent.options = options;
    const listeners = new Map<string, Set<() => void>>();
    const socket = {
      send: (data: string) => {
        agent.sent.push(data);
      },
      readyState: WebSocket.OPEN,
      OPEN: WebSocket.OPEN,
      addEventListener: (type: string, notify: () => void) => {
        let set = listeners.get(type);
        if (set === undefined) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(notify);
      },
      removeEventListener: (type: string, notify: () => void) => {
        listeners.get(type)?.delete(notify);
      },
    };
    options.onOpen?.({ target: socket });
    return socket;
  },
}));

const calls = vi.hoisted(() => ({ tts: vi.fn() }));
vi.mock("@/api", () => ({ api: { tts: (...args: unknown[]) => calls.tts(...args) } }));

function emit(frame: ServerMessage) {
  act(() => {
    agent.options?.onMessage?.({ data: JSON.stringify(frame) });
  });
}

function viewFrame(entries: EntryRecord[]): ServerMessage {
  return viewFrameOf(entries);
}

function userEntry(id: number, text: string): EntryRecord {
  return {
    id: entryIdOf(id),
    conversationId: conversationIdOf("1"),
    kind: "pi.user",
    model: [{ role: "user", content: text, timestamp: 0 }],
  };
}

function assistantEntry(id: number, text: string): EntryRecord {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openrouter",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: 0,
    stopReason: "stop",
  };
  return { id: entryIdOf(id), conversationId: conversationIdOf("1"), kind: "pi.assistant", model: [message] };
}

function submitId(): string | undefined {
  for (const raw of agent.sent) {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      typeof frame === "object" &&
      frame !== null &&
      Reflect.get(frame, "type") === "submit" &&
      typeof Reflect.get(frame, "id") === "string"
    ) {
      return Reflect.get(frame, "id");
    }
  }
  return undefined;
}

beforeEach(() => {
  agent.options = null;
  agent.sent = [];
  calls.tts.mockReset();
  calls.tts.mockResolvedValue(undefined);
});
afterEach(cleanup);

test("F06: playback failure and retry do not submit another dialogue turn", async () => {
  calls.tts.mockRejectedValueOnce(new Error("decode failed"));
  const { result } = renderHook(() => useDialogue("activity-1", "u_1"));
  emit(viewFrame([]));
  act(() => void result.current.send("My question"));
  emit(viewFrame([userEntry(1, "My question"), assistantEntry(2, "A persisted reply")]));
  emit({ type: "result", id: submitId() ?? "none", result: null });
  await waitFor(() => expect(result.current.phase).toBe("idle"));
  expect(result.current.messages.at(-1)?.text).toBe("A persisted reply");

  await act(async () => {
    result.current.replay();
  });
  await waitFor(() => expect(result.current.phase).toBe("idle"));
  expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  expect(result.current.messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(result.current.messages.at(-1)?.text).toBe("A persisted reply");
});

test("F22: synchronous consecutive sends admit only one request", () => {
  const { result } = renderHook(() => useDialogue("activity-1", "u_1"));
  emit(viewFrame([]));
  act(() => {
    void result.current.send("First question");
    void result.current.send("Second question");
  });
  expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
});

test("control: a successful turn preserves both speakers and returns to idle", async () => {
  const { result } = renderHook(() => useDialogue("activity-1", "u_1"));
  emit(viewFrame([]));
  act(() => void result.current.send("My question"));
  emit(viewFrame([userEntry(1, "My question"), assistantEntry(2, "A persisted reply")]));
  emit({ type: "result", id: submitId() ?? "none", result: null });
  await waitFor(() => expect(result.current.phase).toBe("idle"));
  expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
});
