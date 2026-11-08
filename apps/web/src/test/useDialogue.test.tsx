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

describe("useDialogue（WS：view/ops 推導）", () => {
  it("watch→submit→ops 串流→result→speaking→idle 全相位", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    expect(JSON.parse(agent.sent[0]!)).toMatchObject({ type: "watch" });

    act(() => result.current.send("正義是什麼？"));
    expect(result.current.phase).toBe("thinking");
    expect(JSON.parse(agent.sent[1]!)).toMatchObject({ type: "submit", input: "正義是什麼？" });

    emit(viewFrame([userEntry(1, "正義是什麼？")]));
    expect(result.current.messages).toEqual([{ id: "e1", role: "user", text: "正義是什麼？" }]);

    emit({
      type: "ops",
      ops: [
        [
          "r",
          {
            conversation: { id: 1 },
            entries: [userEntry(1, "正義是什麼？"), assistantEntry(2, "你的直覺")],
            docs: {},
          },
        ],
      ],
    } as unknown as ServerMessage);
    expect(result.current.phase).toBe("streaming");
    expect(result.current.draft).toBe("你的直覺");

    emit({ type: "result", id: submitId() ?? "none", result: null });
    expect(result.current.phase).toBe("speaking");
    expect(result.current.messages.at(-1)).toEqual({ id: "e2", role: "assistant", text: "你的直覺" });
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(tts).toHaveBeenCalledTimes(1);
  });

  it("F22：同步連發只送出第一個 submit（第二個被客戶端擋下）", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    act(() => {
      void result.current.send("第一");
      void result.current.send("第二");
    });
    expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  });

  it("ConversationBusy：error frame 帶 code → 錯誤狀態、回到 idle", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
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
    act(() => void result.current.send("問題"));
    act(() => result.current.interrupt());
    expect(result.current.phase).toBe("idle");
    expect(agent.sent.some((raw) => raw.includes('"abort"'))).toBe(true);
    emit({ type: "result", id: submitId() ?? "none", result: null });
    expect(result.current.phase).toBe("idle");
    expect(tts).not.toHaveBeenCalled();
  });

  it("emotion：最新 app.emotion entry 暴露", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), emotionEntry(3)]));
    expect(result.current.emotion).toMatchObject({ emotion: "curious", confidence: 0.9 });
  });

  it("retryLast：重送失敗的輸入（非 scraping view——孤兒 run 後不重複舊回合）", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
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
    act(() => result.current.send("成功的問題"));
    emit(viewFrame([userEntry(1, "成功的問題"), assistantEntry(2, "回答")]));
    act(() => {
      result.current.retryLast();
    });
    expect(agent.sent.filter((raw) => raw.includes("submit"))).toHaveLength(1);
  });
});
