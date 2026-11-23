import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogue } from "@/hooks/useDialogue";
import { companion } from "@/lib/companion";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ClientMessage, ServerMessage } from "@server/ws/protocol";
import { must } from "./helpers";
import { clientFrames, entryIdOf, conversationIdOf, opsFrame as opsFrameOf, viewFrame as viewFrameOf } from "./helpers";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";

function clientFrame(raw: string): ClientMessage | null {
  return clientFrames([raw])[0] ?? null;
}
type AgentOptions = {
  onOpen?: (event: { target: unknown }) => void;
  onMessage?: (event: { data: unknown }) => void;
  onClose?: () => void;
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

const tts = vi.fn();
vi.mock("@/api", () => ({ api: { tts: (...args: unknown[]) => tts(...args) } }));

function emit(frame: ServerMessage) {
  act(() => {
    agent.options?.onMessage?.({ data: JSON.stringify(frame) });
  });
}

function userEntry(id: number, text: string): EntryRecord {
  return {
    id: entryIdOf(id),
    conversationId: conversationIdOf("1"),
    kind: "pi.user",
    model: [{ role: "user", content: text, timestamp: 0 }],
  };
}

function assistantEntry(id: number, text: string, stopReason?: AssistantMessage["stopReason"]): EntryRecord {
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
    stopReason: stopReason ?? "stop",
  };
  return { id: entryIdOf(id), conversationId: conversationIdOf("1"), kind: "pi.assistant", model: [message] };
}

function emotionEntry(id: number): EntryRecord {
  return {
    id: entryIdOf(id),
    conversationId: conversationIdOf("1"),
    kind: "app.emotion",
    data: { emotion: "curious", confidence: 0.9, probabilities: { curious: 0.9 } },
  };
}

function happyEntry(id: number): EntryRecord {
  return {
    id: entryIdOf(id),
    conversationId: conversationIdOf("1"),
    kind: "app.emotion",
    data: { emotion: "happy", confidence: 0.9, probabilities: { happy: 0.9 } },
  };
}

function viewFrame(entries: EntryRecord[], before?: number): ServerMessage {
  return viewFrameOf(entries, before);
}

function opsFrame(entries: EntryRecord[], docs: JsonObject = {}): ServerMessage {
  return opsFrameOf(entries, docs);
}

function submitId(): string | undefined {
  const frame = agent.sent.map((raw) => clientFrame(raw)).find((frame) => frame?.type === "submit");
  return frame?.type === "submit" ? frame.id : undefined;
}

beforeEach(() => {
  agent.options = null;
  agent.sent = [];
  tts.mockReset();
  tts.mockResolvedValue(undefined);
});

describe("useDialogue (WS: view/ops derivation + baseline arbitration)", () => {
  it("subscribes to the conversation once when the socket opens", () => {
    renderHook(() => useDialogue("a_1", "u_1"));
    expect(agent.sent.map((raw) => JSON.parse(raw)).filter((frame) => frame.type === "watch")).toHaveLength(1);
  });

  it("main flow: result=admission does not complete; the assistant entry landing moves speaking → idle", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    expect(JSON.parse(must(agent.sent[0], "first frame"))).toMatchObject({ type: "watch" });

    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));

    act(() => {
      expect(result.current.send("正義是什麼？")).toBe(true);
    });
    expect(result.current.phase).toBe("thinking");

    emit({ type: "result", id: submitId() ?? "none", result: null });
    expect(result.current.phase).toBe("thinking");

    emit(opsFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "正義是什麼？")]));
    expect(result.current.phase).toBe("thinking");
    expect(result.current.pending).toBe(true);

    emit(
      opsFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "正義是什麼？")], {
        "pi.live": { generation: { message: { role: "assistant", content: [{ type: "text", text: "先從你" }] } } },
      } satisfies JsonObject),
    );
    expect(result.current.phase).toBe("streaming");
    expect(result.current.draft).toBe("先從你");

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
    expect(must(tts.mock.calls[0], "tts call")[0]).toBe("你的直覺");
  });

  it("F2: a tool-round assistant entry does not complete pending, speak, or unlock input", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));

    act(() => {
      expect(result.current.send("幫我查資料")).toBe(true);
    });

    emit(
      opsFrame([
        userEntry(1, "舊問題"),
        assistantEntry(2, "舊回答"),
        userEntry(3, "幫我查資料"),
        {
          id: entryIdOf(4),
          conversationId: conversationIdOf("1"),
          kind: "pi.assistant",
          model: [
            {
              role: "assistant",
              content: [
                { type: "text", text: "Let me search." },
                { type: "toolCall", id: "call_1", name: "web_search", arguments: {} },
              ],
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
              stopReason: "toolUse",
            } satisfies AssistantMessage,
          ],
        },
      ]),
    );
    expect(result.current.pending).toBe(true);
    expect(result.current.phase).toBe("thinking");
    expect(result.current.draft).toBe("");
    expect(tts).not.toHaveBeenCalled();

    emit(
      opsFrame([
        userEntry(1, "舊問題"),
        assistantEntry(2, "舊回答"),
        userEntry(3, "幫我查資料"),
        assistantEntry(4, "你的直覺"),
      ]),
    );
    expect(result.current.phase).toBe("speaking");
    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });

  it("load earlier: sends the entries op, prepends the page, clears the earlier marker", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")], 3));
    expect(result.current.canLoadEarlier).toBe(true);

    act(() => {
      void result.current.loadEarlier();
    });
    await act(async () => {});
    const op = agent.sent.map((raw) => clientFrame(raw)).find((frame) => frame?.type === "entries");
    expect(op).toMatchObject({ type: "entries", query: { maxEntryId: 3 } });

    if (op?.type !== "entries") throw new Error("entries frame missing");
    emit({ type: "result", id: op.id, result: { items: [userEntry(0, "更早")] } } satisfies ServerMessage);
    await waitFor(() => expect(result.current.messages[0]).toEqual({ id: "e0", role: "user", text: "更早" }));
    expect(result.current.canLoadEarlier).toBe(false);
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
    const firstSignal = must(tts.mock.calls[0], "tts call")[2];
    if (!(firstSignal instanceof AbortSignal)) throw new Error("tts call did not receive an AbortSignal");

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

  it("a watch snapshot from before submit does not fail a pending answer", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => {
      expect(result.current.send("契約是什麼？")).toBe(true);
    });

    emit(viewFrame([]));
    expect(result.current.pending).toBe(true);
    expect(result.current.error).toBeNull();

    emit(opsFrame([userEntry(1, "契約是什麼？"), assistantEntry(2, "先談雙方的承諾。")]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("C2: reconnect view without this round's user entry waits for an explicit failure", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("斷線前的問題"));
    emit(viewFrame([]));
    expect(result.current.phase).toBe("thinking");
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(true);

    emit({ type: "error", id: submitId(), message: "Request failed" });
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
    expect(must(tts.mock.calls[0], "tts call")[0]).toBe("孤兒的答案");
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

  it("does not replay the emotion expression when a reconnect redelivers the same entry", async () => {
    const playExpression = vi.spyOn(companion, "playExpression").mockImplementation(() => {});
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("問題"));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答")]));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), happyEntry(3)]));
    await waitFor(() => expect(playExpression).toHaveBeenCalledTimes(1));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), happyEntry(3)]));
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "回答"), happyEntry(3)]));
    expect(playExpression).toHaveBeenCalledTimes(1);
    playExpression.mockRestore();
  });

  it("retryLast: resends the failed input", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => result.current.send("被打拒的問題"));
    const submitted = agent.sent.filter((raw) => raw.includes("submit"));
    expect(submitted).toHaveLength(1);
    emit({ type: "error", id: JSON.parse(must(submitted[0], "submit frame")).id, message: "ConversationBusy" });
    act(() => result.current.retryLast());
    const resent = agent.sent.filter((raw) => raw.includes("submit"));
    expect(resent).toHaveLength(2);
    expect(JSON.parse(must(resent[1], "resent frame"))).toMatchObject({ input: "被打拒的問題" });
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
    expect(must(tts.mock.calls[0], "tts call")[0]).toBe("跨過 splice 的回答");
  });

  it("sliding window: a view past the baseline keeps waiting for the missing turn", () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));
    act(() => result.current.send("未被受理的問題"));
    emit(viewFrame([emotionEntry(3)]));
    expect(result.current.phase).toBe("thinking");
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(true);
    emit(opsFrame([emotionEntry(3), userEntry(4, "未被受理的問題"), assistantEntry(5, "現在回答")]));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
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
    emit(
      opsFrame([
        userEntry(1, "舊問題"),
        assistantEntry(2, "舊回答"),
        userEntry(3, "新問題"),
        assistantEntry(4, "新回答"),
      ]),
    );
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

  it("reconnect full view with a trailing empty assistant entry completes the round (idle, no TTS)", async () => {
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => {
      result.current.send("問題");
    });
    emit(viewFrame([userEntry(1, "問題"), assistantEntry(2, "")]));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.phase).toBe("idle");
    expect(tts).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});

describe("useDialogue (autoSend: queued first question)", () => {
  it("auto-sends once the first view arrives and never resends on later frames", () => {
    const onAutoSent = vi.fn();
    const { result } = renderHook(() => useDialogue("a_1", "u_1", { autoSend: "什麼是正義？", onAutoSent }));

    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答")]));

    const submits = () =>
      agent.sent
        .map((raw) => clientFrame(raw))
        .filter((frame): frame is Extract<ClientMessage, { type: "submit" }> => frame?.type === "submit");
    expect(submits()).toHaveLength(1);
    expect(must(submits()[0], "first submit").input).toBe("什麼是正義？");
    expect(result.current.pending).toBe(true);
    expect(onAutoSent).toHaveBeenCalledTimes(1);

    emit(opsFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "什麼是正義？")]));
    emit(viewFrame([userEntry(1, "舊問題"), assistantEntry(2, "舊回答"), userEntry(3, "什麼是正義？")]));
    expect(submits()).toHaveLength(1);
    expect(onAutoSent).toHaveBeenCalledTimes(1);
  });

  it("resends the same question after the autoSend prop clears and returns", async () => {
    let autoSend: string | undefined = "什麼是正義？";
    const { result, rerender } = renderHook(() => useDialogue("a_1", "u_1", { autoSend }));

    emit(viewFrame([]));
    const submits = () =>
      agent.sent
        .map((raw) => clientFrame(raw))
        .filter((frame): frame is Extract<ClientMessage, { type: "submit" }> => frame?.type === "submit");
    expect(submits()).toHaveLength(1);

    emit(opsFrame([userEntry(1, "什麼是正義？"), assistantEntry(2, "先想想看")]));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    autoSend = undefined;
    rerender();
    emit(viewFrame([]));
    expect(submits()).toHaveLength(1);

    autoSend = "什麼是正義？";
    rerender();
    emit(viewFrame([]));
    expect(submits()).toHaveLength(2);
  });

  it("defers autoSend while TTS is speaking and sends once the round ends", async () => {
    let releaseTts: (() => void) | null = null;
    tts.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseTts = resolve;
        }),
    );
    let autoSend: string | undefined;
    const { result, rerender } = renderHook(() => useDialogue("a_1", "u_1", { autoSend }));

    emit(viewFrame([]));
    act(() => {
      result.current.send("第一題");
    });
    emit(opsFrame([userEntry(1, "第一題"), assistantEntry(2, "第一答")]));
    await waitFor(() => expect(result.current.phase).toBe("speaking"));

    autoSend = "第二題";
    rerender();
    emit(viewFrame([userEntry(1, "第一題"), assistantEntry(2, "第一答")]));
    const submits = () =>
      agent.sent
        .map((raw) => clientFrame(raw))
        .filter((frame): frame is Extract<ClientMessage, { type: "submit" }> => frame?.type === "submit");
    expect(submits()).toHaveLength(1);

    act(() => {
      releaseTts?.();
    });
    await waitFor(() => expect(submits()).toHaveLength(2));
    expect(must(submits()[1], "second submit").input).toBe("第二題");
  });
});

describe("useDialogue (session callbacks)", () => {
  it("invokes onDisconnect when the socket closes", () => {
    const onDisconnect = vi.fn();
    renderHook(() => useDialogue("a_1", "u_1", { onDisconnect }));
    act(() => {
      agent.options?.onClose?.();
    });
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("reports onActivityFinished when the run fails with ActivityFinished", async () => {
    const onActivityFinished = vi.fn();
    const { result } = renderHook(() => useDialogue("a_1", "u_1", { onActivityFinished }));
    emit(viewFrame([]));
    act(() => {
      expect(result.current.send("問題")).toBe(true);
    });
    emit({ type: "error", message: "activity finished", code: "ActivityFinished" } satisfies ServerMessage);
    expect(onActivityFinished).toHaveBeenCalledTimes(1);
    expect(result.current.error?.code).toBe("ActivityFinished");
  });

  it("marks tts skipped when a higher-priority playback preempts the answer", async () => {
    const { markIntent, speak } = await import("@/lib/speech");
    const { result } = renderHook(() => useDialogue("a_1", "u_1"));
    emit(viewFrame([]));
    act(() => {
      result.current.send("問題");
    });
    markIntent("assistant");
    tts.mockImplementationOnce(() => new Promise<void>(() => {}));
    void speak("assistant", "佔用中的播報");

    emit(opsFrame([userEntry(1, "問題"), assistantEntry(2, "回答")]));
    await waitFor(() => expect(result.current.ttsSkipped).toBe(true));
    expect(result.current.ttsFailed).toBe(false);
  });
});
