import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useDialogue } from "@/hooks/useDialogue";

const calls = vi.hoisted(() => ({ send: vi.fn(), tts: vi.fn() }));
vi.mock("@/api", () => ({ api: { sendDialogue: calls.send, tts: calls.tts } }));
const INITIAL: Array<{ id?: string; role: "user" | "assistant"; text: string }> = [];
const REPLY = { id: "reply-1", role: "assistant", text: "A persisted reply", at: "2026-11-05T00:00:00Z" };

beforeEach(() => {
  calls.send.mockReset();
  calls.tts.mockReset();
  calls.send.mockResolvedValue(REPLY);
  calls.tts.mockResolvedValue(undefined);
});
afterEach(cleanup);

test("F06: playback failure and retry do not submit another dialogue turn", async () => {
  calls.tts.mockRejectedValueOnce(new Error("decode failed"));
  const { result } = renderHook(() => useDialogue("activity-1", INITIAL));
  await act(async () => {
    await result.current.send("My question");
  });
  expect(result.current.messages.at(-1)?.text).toBe(REPLY.text);
  await act(async () => {
    result.current.replay();
  });
  await waitFor(() => expect(result.current.phase).toBe("idle"));
  expect(calls.send).toHaveBeenCalledTimes(1);
  expect(result.current.messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(result.current.messages.at(-1)?.text).toBe(REPLY.text);
});

test("F22: synchronous consecutive sends admit only one request", async () => {
  calls.send.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useDialogue("activity-1", INITIAL));
  await act(async () => {
    void result.current.send("First question");
    void result.current.send("Second question");
  });
  expect(calls.send).toHaveBeenCalledTimes(1);
  expect(result.current.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test("control: a successful turn preserves both speakers and returns to idle", async () => {
  const { result } = renderHook(() => useDialogue("activity-1", INITIAL));
  await act(async () => {
    await result.current.send("My question");
  });
  expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(result.current.messages.at(-1)?.text).toBe(REPLY.text);
  expect(result.current.phase).toBe("idle");
  expect(result.current.error).toBeNull();
});
