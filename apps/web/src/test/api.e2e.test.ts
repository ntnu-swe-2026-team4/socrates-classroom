import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { httpApi } from "@/api/http";
import { ApiError } from "@/api";
import type { DialogueMessage } from "@/api";

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;
const handler = vi.fn<Handler>();

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  handler.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
      return handler(path, init ?? {});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpApi 契約（瀏覽器端實際代碼）", () => {
  test("me：GET /api/me 帶 cookie 與 Accept-Language", async () => {
    handler.mockReturnValue(json({ id: "u1", name: "小明", role: "student" }));
    document.documentElement.lang = "zh-TW";
    const user = await httpApi.me();
    expect(user?.name).toBe("小明");
    const [path, init] = handler.mock.calls[0]!;
    expect(path).toBe("/api/me");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Accept-Language")).toBe("zh");
  });

  test("joinAsGuest：POST /api/join 契約形狀＋活動 id 持久化", async () => {
    handler.mockReturnValue(json({ user: { id: "u9", name: "小明", role: "student" }, activityId: "a_1" }));
    const payload = await httpApi.joinAsGuest("socrat", "小明");
    expect(payload.activityId).toBe("a_1");
    const [path, init] = handler.mock.calls[0]!;
    expect(path).toBe("/api/join");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ code: "socrat", name: "小明", tosAccepted: true });
    expect(localStorage.getItem("socrates_activity")).toBe("a_1");
  });

  test("錯誤映射：422 tos_required → ApiError.code", async () => {
    handler.mockImplementation(() => json({ message: "需要同意使用條款才能進入。", code: "tos_required" }, 422));
    await expect(httpApi.joinAsGuest("socrat", "小明")).rejects.toMatchObject({
      code: "tos_required",
      message: "需要同意使用條款才能進入。",
    });
    try {
      await httpApi.joinAsGuest("socrat", "小明");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("tos_required");
    }
  });

  test("sendDialogue：delta 順序累積、done 回完整訊息", async () => {
    handler.mockReturnValue(
      sse([
        'event: delta\ndata: {"text":"你把判準放在"}\n\n',
        'event: delta\ndata: {"text":"數量上。"}\n\n',
        'event: done\ndata: {"message":{"id":"m1","role":"assistant","text":"你把判準放在數量上。","at":"2026-11-05T00:00:00Z"}}\n\n',
      ]),
    );
    const deltas: string[] = [];
    const message = await httpApi.sendDialogue("a_1", "我覺得應該拉桿。", (delta) => deltas.push(delta));
    expect(deltas).toEqual(["你把判準放在", "數量上。"]);
    expect(message.text).toBe("你把判準放在數量上。");
    const [path, init] = handler.mock.calls[0]!;
    expect(path).toBe("/api/activities/a_1/dialogue");
    expect(JSON.parse(init.body as string)).toEqual({ text: "我覺得應該拉桿。" });
  });

  test("sendDialogue：串流中 error 事件 → ApiError 帶契約碼", async () => {
    handler.mockReturnValue(
      sse([
        'event: delta\ndata: {"text":"部分"}\n\n',
        'event: error\ndata: {"message":"太忙碌了。","code":"llm_rate_limited"}\n\n',
      ]),
    );
    await expect(httpApi.sendDialogue("a_1", "x", () => {})).rejects.toMatchObject({ code: "llm_rate_limited" });
  });

  test("sendDialogue：容忍未知事件（emotion 過渡期）", async () => {
    handler.mockReturnValue(
      sse([
        'event: emotion\ndata: {"emotion":"happy"}\n\n',
        'event: delta\ndata: {"text":"ok"}\n\n',
        'event: done\ndata: {"message":{"id":"m2","role":"assistant","text":"ok","at":"2026-11-05T00:00:00Z"}}\n\n',
      ]),
    );
    const message = await httpApi.sendDialogue("a_1", "x", () => {});
    expect((message as DialogueMessage).text).toBe("ok");
  });

  test("stt：multipart 上傳、回 {text}", async () => {
    handler.mockReturnValue(json({ text: "我認為應該拉桿" }));
    const text = await httpApi.stt(new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    expect(text).toBe("我認為應該拉桿");
    const [path] = handler.mock.calls[0]!;
    expect(path).toBe("/api/stt");
  });

  test("byokSet：PUT /api/settings/byok 回 last4", async () => {
    handler.mockReturnValue(json({ provider: "openrouter", last4: "efgh" }));
    const status = await httpApi.byokSet("openrouter", "sk-or-v1-abcdefgh");
    expect(status?.last4).toBe("efgh");
    const [path, init] = handler.mock.calls[0]!;
    expect(path).toBe("/api/settings/byok");
    expect(init.method).toBe("PUT");
  });

  test("finishActivity：POST 204 無 body", async () => {
    handler.mockReturnValue(new Response(null, { status: 204 }));
    await expect(httpApi.finishActivity("a_1")).resolves.toBeUndefined();
    const [path, init] = handler.mock.calls[0]!;
    expect(path).toBe("/api/activities/a_1/finish");
    expect(init.method).toBe("POST");
  });
});
