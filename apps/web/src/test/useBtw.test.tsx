import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBtw } from "@/hooks/useBtw";
import type { ServerMessage } from "@server/ws/protocol";
import { must } from "./helpers";

type AgentOptions = {
  enabled?: boolean;
  onOpen?: (event: { target: unknown }) => void;
  onMessage?: (event: { data: unknown }) => void;
};

const agent = vi.hoisted((): { options: AgentOptions | null; sent: string[] } => ({ options: null, sent: [] }));

vi.mock("agents/react", () => ({
  useAgent: (options: AgentOptions) => {
    const first = agent.options === null;
    agent.options = options;
    const socket = {
      send: (data: string) => agent.sent.push(data),
      readyState: WebSocket.OPEN,
      OPEN: WebSocket.OPEN,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    if (first && options.enabled !== false) options.onOpen?.({ target: socket });
    return socket;
  },
}));

function emit(frame: object) {
  act(() => {
    agent.options?.onMessage?.({ data: JSON.stringify(frame) });
  });
}

function sent(): Array<{ type: string; id?: string; session?: string; input?: string }> {
  return agent.sent.map((raw) => JSON.parse(raw));
}

const user = (id: number, text: string) => ({ id, kind: "pi.user", model: [{ role: "user", content: text }] });
const assistant = (id: number, text: string) => ({
  id,
  kind: "pi.assistant",
  model: [{ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }],
});
const view = (entries: object[]) => ({ type: "view", view: { conversation: { id: 2 }, entries, docs: {} } });
const ops = (entries: object[]) => ({ type: "ops", ops: [["r", { conversation: { id: 2 }, entries, docs: {} }]] });

const root = [user(1, "主對話問題"), assistant(2, "蘇格拉底的追問")];

beforeEach(() => {
  agent.options = null;
  agent.sent = [];
  sessionStorage.clear();
});

describe("useBtw (side session over its own socket)", () => {
  it("opens a fresh fork, hides the inherited root entries, and completes a side exchange", () => {
    const { result } = renderHook(() => useBtw("a_1", "u_1", true));
    const open = must(sent()[0], "btw open frame");
    expect(open).toMatchObject({ type: "btw" });
    expect(open.session).toBeUndefined();

    emit(view(root));
    if (open.id === undefined) throw new Error("btw frame missing id");
    emit({ type: "result", id: open.id, result: { session: "7" } } satisfies ServerMessage);
    expect(result.current.ready).toBe(true);
    expect(result.current.messages).toEqual([]);
    const stored = sessionStorage.getItem("btw:a_1:u_1");
    if (stored === null) throw new Error("missing btw storage entry");
    expect(JSON.parse(stored)).toEqual({ session: "7", forkHead: 2 });

    act(() => {
      expect(result.current.ask("電車難題是什麼？")).toBe(true);
    });
    expect(result.current.phase).toBe("thinking");
    expect(must(sent().at(-1), "last sent frame")).toMatchObject({ type: "submit", input: "電車難題是什麼？" });

    emit(ops([...root, user(3, "電車難題是什麼？"), assistant(4, "**電車難題**是一個思想實驗。")]));
    expect(result.current.phase).toBe("idle");
    expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("a question asked before binding (the /btw command) is sent once the session is bound", () => {
    const { result } = renderHook(() => useBtw("a_1", "u_1", true));
    act(() => {
      expect(result.current.ask("功利主義是什麼？")).toBe(true);
    });
    expect(sent().some((frame) => frame.type === "submit")).toBe(false);
    emit(view(root));
    emit({ type: "result", id: must(sent()[0], "btw open frame").id, result: { session: "7" } });
    expect(must(sent().at(-1), "last sent frame")).toMatchObject({ type: "submit", input: "功利主義是什麼？" });
  });

  it("re-attaches to the stored session; an UnknownSession reply falls back to a fresh fork", () => {
    sessionStorage.setItem("btw:a_1:u_1", JSON.stringify({ session: "9", forkHead: 2 }));
    renderHook(() => useBtw("a_1", "u_1", true));
    const attach = must(sent()[0], "attach frame");
    expect(attach).toMatchObject({ type: "btw", session: "9" });
    emit({ type: "error", id: attach.id, message: "gone", code: "UnknownSession" });
    const retry = must(sent()[1], "retry frame");
    expect(retry).toMatchObject({ type: "btw" });
    expect(retry.session).toBeUndefined();
    expect(sessionStorage.getItem("btw:a_1:u_1")).toBeNull();
  });

  it("NothingToFork surfaces as an error and leaves the panel unbound", () => {
    const { result } = renderHook(() => useBtw("a_1", "u_1", true));
    emit({ type: "error", id: must(sent()[0], "attach frame").id, message: "empty", code: "NothingToFork" });
    expect(result.current.error).toEqual({ code: "NothingToFork" });
    expect(result.current.ready).toBe(false);
  });
});
