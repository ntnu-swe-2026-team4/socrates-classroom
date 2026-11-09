import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const tts = vi.fn();
vi.mock("@/api", () => ({ api: { tts: (...args: unknown[]) => tts(...args) } }));

function emit(frame: ServerMessage) {
  act(() => {
    agent.options?.onMessage?.({ data: JSON.stringify(frame) });
  });
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

function emotionEntry(id: number): EntryRecord {
  return asEntry({
    id,
    conversationId: "c1",
    kind: "app.emotion",
    data: { emotion: "curious", confidence: 0.9, probabilities: { curious: 0.9 }, text: "回答" },
  });
}

function viewFrame(entries: EntryRecord[], before?: number): ServerMessage {
  return {
    type: "view",
    view: { conversation: { id: 1 }, entries, docs: {}, ...(before !== undefined ? { before } : {}) },
  } as unknown as ServerMessage;
}

function opsFrame(entries: EntryRecord[]): ServerMessage {
  return {
    type: "ops",
    ops: [["r", { conversation: { id: 1 }, entries, docs: {} }]],
  } as unknown as ServerMessage;
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
  tts.mockReset();
  tts.mockResolvedValue(undefined);
});

describe("useDialogue (WS: view/ops derivation + baseline arbitration)", () => {
  it("main flow: result=admission does not complete; the assistant entry landing moves speaking → idle", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    expect(JSON.parse(agent.sent[0]!)).toMatchObject({ type: "watch" });

    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));

    act(() => {
      expect(result.current.send("正義是什麼？")).toBe(true);
    });
    expect(result.current.phase).toBe("thinking");

    emit({ type: "result", id: submitId() ?? "none", result: null });
    expect(result.current.phase).toBe("thinking");

    emit(opsFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "正義是什麼？")]));
    expect(result.current.phase).toBe("streaming");
    expect(result.current.pending).toBe(true);

    emit(
      opsFrame([
        userEntry(1, "舊問題"),
        assistantEntry(2, "舊回答"),
        userEntry(3, "正義是什麼？"),
        assistantEntry(4, "你的直覺"),
      ]),
    );
    expect(result.current.phase).toBe("speaking");
    expect(result.current.messages.at(-1)).toEqual({ id: "e4", role: "assistant", text: "你的直覺" });
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(tts).toHaveBeenCalledTimes(1);
    expect(tts.mock.calls[0]![0]).toBe("你的直覺");
  });

  it("F22: synchronous consecutive sends admit only one submit (the second returns false)", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    let first = false;
    let second = false;
    act(() => {
      first = result.current.send("第一");
      second = result.current.send("第二");
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  });

  it("C1: sending a new message while TTS plays — the old TTS aborts and the phase is not clobbered", () => {
    tts.mockReturnValue(new Promise<void>(() => {}));
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("第一問"));
    emit(opsFrame([userEntry(1, "第一問"), assistantEntry(2, "第一答")]));
    expect(result.current.phase).toBe("speaking");
    const firstSignal = tts.mock.calls[0]![2] as AbortSignal;

    act(() => result.current.send("第二問"));
    expect(firstSignal.aborted).toBe(true);
    expect(result.current.phase).toBe("thinking");
  });

  it("C2: reconnect view has this round's user entry but no answer yet — pending kept, old text not spoken", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => result.current.send("新問題"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "新問題")]));
    expect(result.current.phase).toBe("thinking");
    expect(result.current.pending).toBe(true);
    expect(tts).not.toHaveBeenCalled();
  });

  it("C2: reconnect view lacks this round's user entry (not admitted) — pending cleared with an error", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("斷線前的問題"));
    emit(viewFrame([]));
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
    expect(result.current.pending).toBe(false);
  });

  it("C2: reconnect view contains the new answer — completes and speaks", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("孤兒 run 的問題"));
    emit(viewFrame([userEntry(1, "孤兒 run 的問題"), assistantEntry(2, "孤兒的答案")]));
    expect(result.current.phase).toBe("speaking");
    expect(tts.mock.calls[0]![0]).toBe("孤兒的答案");
  });

  it("run failure broadcast: id-less error clears pending; ignored when none is pending", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    emit({ type: "error", message: "The model run failed", code: "llm_unavailable" });
    expect(result.current.error).toBeNull();

    act(() => result.current.send("問題"));
    emit({ type: "error", message: "The model run failed", code: "llm_unavailable" });
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
  });

  it("someone else's error id: leaves the in-flight pending untouched", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("我的問題"));
    emit({ type: "error", id: "別的操作", message: "x", code: "internal" });
    expect(result.current.phase).toBe("thinking");
    expect(result.current.pending).toBe(true);
  });

  it("ConversationBusy: error frame carries a code → error state, back to idle", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => void result.current.send("問題"));
    emit({
      type: "error",
      id: submitId(),
      message: "Conversation is busy",
      code: "ConversationBusy",
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "ConversationBusy" });
  });

  it("interrupt: sends abort, clears the phase, stops speaking", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => void result.current.send("問題"));
    act(() => result.current.interrupt());
    expect(result.current.phase).toBe("idle");
    expect(agent.sent.some((raw) => raw.includes('"abort"'))).toBe(true);
    emit(opsFrame([userEntry(1, "問題"), assistantEntry(2, "回答")]));
    expect(result.current.phase).toBe("idle");
    expect(tts).not.toHaveBeenCalled();
  });

  it("emotion: the latest app.emotion entry is exposed", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), emotionEntry(3)]));
    expect(result.current.emotion).toMatchObject({ emotion: "curious", confidence: 0.9 });
  });

  it("retryLast: resends the failed input", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("被打拒的問題"));
    const submitted = agent.sent.filter((raw) => raw.includes("submit"));
    expect(submitted).toHaveLength(1);
    emit({ type: "error", id: JSON.parse(submitted[0]!).id, message: "ConversationBusy" });
    act(() => result.current.retryLast());
    const resent = agent.sent.filter((raw) => raw.includes("submit"));
    expect(resent).toHaveLength(2);
    expect(JSON.parse(resent[1]!)).toMatchObject({ input: "被打拒的問題" });
  });

  it("retryLast: cleared after a successful answer — no stale input remains", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("成功的問題"));
    emit(viewFrame([userEntry(1, "成功的問題"), assistantEntry(2, "回答")]));
    act(() => {
      result.current.retryLast();
    });
    expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  });

  it("sliding window: the baseline entry is spliced out mid-run — the answer still completes", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => result.current.send("長對話中的問題"));
    emit(opsFrame([userEntry(3, "長對話中的問題")]));
    expect(result.current.phase).toBe("thinking");
    emit(opsFrame([userEntry(3, "長對話中的問題"), assistantEntry(4, "跨過 splice 的回答")]));
    expect(result.current.phase).toBe("speaking");
    expect(tts.mock.calls[0]![0]).toBe("跨過 splice 的回答");
  });

  it("sliding window: reconnect view spliced past the baseline — not-admitted verdict still works", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => result.current.send("未被受理的問題"));
    emit(viewFrame([emotionEntry(3)]));
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
  });
});

describe("lain round-3: reconnect rollover + empty assistant entries", () => {
  it("view window rolled past the baseline (user entry in the unobserved gap) — pending kept, later ops complete it", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => {
      result.current.send("新問題");
    });
    emit(viewFrame([], 3));
    expect(result.current.pending).toBe(true);
    expect(result.current.error).toBeNull();
    expect(tts).not.toHaveBeenCalled();
    emit(opsFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "新問題"), assistantEntry(4, "新回答")]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(tts).toHaveBeenCalledWith("新回答", expect.anything(), expect.anything());
  });

  it("assistant entry with empty text does not complete the round; the real answer later does", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => {
      result.current.send("問題");
    });
    emit(opsFrame([userEntry(1, "問題"), assistantEntry(2, "")]));
    expect(result.current.pending).toBe(true);
    emit(opsFrame([userEntry(1, "問題"), assistantEntry(2, ""), assistantEntry(3, "真正的回答")]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(tts).toHaveBeenCalledWith("真正的回答", expect.anything(), expect.anything());
  });
});
