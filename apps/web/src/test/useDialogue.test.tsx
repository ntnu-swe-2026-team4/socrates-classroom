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
      readyState: 0,
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

function viewFrame(entries: EntryRecord[]): ServerMessage {
  return { type: "view", view: { conversation: { id: 1 }, entries, docs: {} } } as unknown as ServerMessage;
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

describe("useDialogue（WS：view/ops 推導＋baseline 仲裁）", () => {
  it("黃金流程：result=admission 不完成；assistant entry 落地才 speaking→idle", async () => {
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

  it("F22：同步連發只送出第一個 submit（第二個回 false）", () => {
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

  it("C1：TTS 播放中送新訊息——舊 TTS 被 abort、phase 不被蓋掉", () => {
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

  it("C2：reconnect view 含本輪 user entry 但向未回答——pending 保留、不朗讀舊文", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => result.current.send("新問題"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "新問題")]));
    expect(result.current.phase).toBe("thinking");
    expect(result.current.pending).toBe(true);
    expect(tts).not.toHaveBeenCalled();
  });

  it("C2：reconnect view 缺本輪 user entry（未被 admission）——清 pending 報錯", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("斷線前的問題"));
    emit(viewFrame([]));
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
    expect(result.current.pending).toBe(false);
  });

  it("C2：reconnect view 含新答案——完成並朗讀", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("孤兒 run 的問題"));
    emit(viewFrame([userEntry(1, "孤兒 run 的問題"), assistantEntry(2, "孤兒的答案")]));
    expect(result.current.phase).toBe("speaking");
    expect(tts.mock.calls[0]![0]).toBe("孤兒的答案");
  });

  it("run 失敗廣播：id-less error 清 pending；無 pending 時忽略", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    emit({ type: "error", message: "The model run failed", code: "llm_unavailable" });
    expect(result.current.error).toBeNull();

    act(() => result.current.send("問題"));
    emit({ type: "error", message: "The model run failed", code: "llm_unavailable" });
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
  });

  it("別人的 error id：不動 in-flight pending", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("我的問題"));
    emit({ type: "error", id: "別的操作", message: "x", code: "internal" });
    expect(result.current.phase).toBe("thinking");
    expect(result.current.pending).toBe(true);
  });

  it("ConversationBusy：error frame 帶 code → 錯誤狀態、回到 idle", () => {
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

  it("interrupt：送 abort、清 phase、不再說話", () => {
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

  it("emotion：最新 app.emotion entry 暴露", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), emotionEntry(3)]));
    expect(result.current.emotion).toMatchObject({ emotion: "curious", confidence: 0.9 });
  });

  it("retryLast：重送失敗的輸入", () => {
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

  it("retryLast：成功回答後清空——不再殘留舊輸入", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("成功的問題"));
    emit(viewFrame([userEntry(1, "成功的問題"), assistantEntry(2, "回答")]));
    act(() => {
      result.current.retryLast();
    });
    expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  });
});
