import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useDialogue } from "@/hooks/useDialogue";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ServerMessage } from "@server/ws/protocol";

type AgentOptions = {
  onOpen?: (event: { target: unknown }) => void;
  onMessage?: (event: { data: unknown }) => void;
};

const agent = vi.hoisted(() => ({
  options: null as AgentOptions | null,
  sent: [] as string[],
}));

vi.mock("agents/react", () => ({
  useAgent: (options: AgentOptions) => {
    agent.options = options;
    const socket = {
      send: (data: string) => {
        agent.sent.push(data);
      },
      readyState: WebSocket.OPEN,
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
  return { type: "view", view: { conversation: { id: 1 }, entries, docs: {} } } as unknown as ServerMessage;
}

const asEntry = (entry: object): EntryRecord => entry as unknown as EntryRecord;

function userEntry(id: number, text: string): EntryRecord {
  return asEntry({ id, conversationId: "c1", kind: "pi.user", model: [{ role: "user", content: text }] });
}

function assistantEntry(id: number, text: string): EntryRecord {
  return asEntry({
    id,
    conversationId: "c1",
    kind: "pi.assistant",
    model: [{ role: "assistant", content: [{ type: "text", text }] }],
  });
}

function submitId(): string | undefined {
  const frame = agent.sent
    .map((raw) => JSON.parse(raw) as { type: string; id?: string })
    .find((f) => f.type === "submit");
  return frame?.id;
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
