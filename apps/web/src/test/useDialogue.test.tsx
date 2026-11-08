import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogue } from "@/hooks/useDialogue";

const sendDialogue = vi.fn();
const tts = vi.fn();

vi.mock("@/api", () => ({
  api: {
    sendDialogue: (...args: unknown[]) => sendDialogue(...args),
    tts: (...args: unknown[]) => tts(...args),
  },
}));

const INITIAL: Array<{ id?: string; role: "user" | "assistant"; text: string }> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  sendDialogue.mockReset();
  tts.mockReset();
  tts.mockResolvedValue(undefined);
});

describe("useDialogue phase machine", () => {
  it("goes thinking → streaming → idle and appends the final message", async () => {
    const pending = deferred<{ id: string; role: "assistant"; text: string; at: string }>();
    let onDelta!: (delta: string) => void;
    sendDialogue.mockImplementation((_activityId: string, _text: string, delta: (d: string) => void) => {
      onDelta = delta;
      return pending.promise;
    });

    const { result } = renderHook(() => useDialogue("a-1", INITIAL));
    expect(result.current.phase).toBe("idle");

    await act(async () => {
      void result.current.send("我會拉桿");
    });
    expect(result.current.phase).toBe("thinking");
    expect(result.current.messages.at(-1)).toMatchObject({ role: "user", text: "我會拉桿" });

    await act(async () => {
      onDelta("五條命");
    });
    expect(result.current.phase).toBe("streaming");
    expect(result.current.draft).toBe("五條命");

    await act(async () => {
      pending.resolve({ id: "m1", role: "assistant", text: "五條命比一條命重要", at: "t" });
    });
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.messages.at(-1)).toMatchObject({ id: "m1", text: "五條命比一條命重要" });
    expect(result.current.error).toBeNull();
  });

  it("guards double submit while busy", async () => {
    sendDialogue.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDialogue("a-1", INITIAL));
    await act(async () => {
      void result.current.send("第一句");
    });
    await act(async () => {
      await result.current.send("第二句");
    });
    const userMessages = result.current.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(result.current.phase).toBe("thinking");
  });

  it("surfaces errors, keeps the failed user message, and retries last sent", async () => {
    sendDialogue.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useDialogue("a-1", INITIAL));

    await act(async () => {
      await result.current.send("觸發錯誤");
    });
    expect(result.current.error).toEqual({ code: "llm_unavailable" });
    expect(result.current.messages.at(-1)).toMatchObject({ role: "user", text: "觸發錯誤" });
    expect(result.current.phase).toBe("idle");

    sendDialogue.mockResolvedValueOnce({ id: "m2", role: "assistant", text: "ok", at: "t" });
    await act(async () => {
      result.current.retryLast();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(sendDialogue).toHaveBeenLastCalledWith("a-1", "觸發錯誤", expect.any(Function), expect.anything());
    expect(result.current.messages.at(-1)).toMatchObject({ text: "ok" });
  });

  it("treats abort as interruption, not error", async () => {
    sendDialogue.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useDialogue("a-1", INITIAL));
    await act(async () => {
      await result.current.send("中斷我");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("idle");
  });
});
