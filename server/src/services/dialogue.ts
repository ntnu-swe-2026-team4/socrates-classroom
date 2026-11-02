import type { Config, Lang } from "../config";
import { msg } from "../messages";
import { HttpError, fail, langOf, type Ctx } from "../http";
import { EmotionSplitter, LlmError, socraticStream, type HistoryMessage } from "./llm";
import type { Emotion } from "./types";

const locks = new Set<string>();
const rates = new Map<string, number[]>();
const RATE_WINDOW = 60_000;
const RATE_MAX = 20;

export function checkRate(userId: string): void {
  const now = Date.now();
  if (rates.size > 500) {
    // 偶發清掃：視窗外已無紀錄的使用者就移除，避免長時間運行無限增長
    for (const [k, hits] of rates) {
      if (!hits.length || now - hits[hits.length - 1] >= RATE_WINDOW) rates.delete(k);
    }
  }
  const hits = (rates.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) fail(429, "rate_limited");
  hits.push(now);
  rates.set(userId, hits);
}

export function acquireLock(key: string): void {
  if (locks.has(key)) fail(409, "already_streaming");
  locks.add(key);
}

export function releaseLock(key: string): void {
  locks.delete(key);
}

export interface StreamOptions {
  lang: Lang;
  title: string;
  statement: string;
  history: HistoryMessage[];
  extra?: string;
  lockKey: string;
  /** 成功後在同一個交易寫入「使用者訊息 + AI 回覆」；回傳已存的 AI 訊息。 */
  save: (userText: string, assistantText: string, emotion: Emotion) => { message: Record<string, unknown> };
}

function llmStatus(error: LlmError): number {
  if (error.status === 429) return 429;
  return 503;
}

/**
 * 共用的對話 SSE。會先向 LLM 要第一段文字，若在一開始就失敗，回一般 HTTP 錯誤（不是 SSE）；
 * 開始串流後才出錯則送 `event: error`。成功才存進資料庫。
 */
export async function dialogueSse(c: Ctx, config: Config, opts: StreamOptions, text: string): Promise<Response> {
  const lang = langOf(c);
  let gen: AsyncGenerator<string>;
  try {
    gen = socraticStream(
      config,
      { title: opts.title, statement: opts.statement, history: [...opts.history, { role: "user", text }], lang: opts.lang ?? lang, extra: opts.extra },
    );
  } catch (error) {
    releaseLock(opts.lockKey);
    if (error instanceof LlmError) throw new HttpError(llmStatus(error), error.key, {}, error.code);
    throw error;
  }

  let first: IteratorResult<string>;
  try {
    first = await gen.next();
  } catch (error) {
    releaseLock(opts.lockKey);
    if (error instanceof LlmError) {
      throw new HttpError(llmStatus(error), error.key, {}, error.code);
    }
    throw error;
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let closed = false;
  let sentEmotion: Emotion | null = null;
  let acc = "";

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* 連線已關閉 */
        }
      }, 15_000);

      const splitter = new EmotionSplitter();
      const handle = (piece: { emotion?: Emotion; text?: string }) => {
        if (piece.emotion && !sentEmotion) {
          sentEmotion = piece.emotion;
          send("emotion", { emotion: piece.emotion });
        }
        if (piece.text) {
          acc += piece.text;
          send("delta", { text: piece.text });
        }
      };

      try {
        if (first.done) {
          handle(splitter.finish());
        } else {
          handle(splitter.push(first.value));
          for (;;) {
            const next = await gen.next();
            if (next.done) break;
            handle(splitter.push(next.value));
          }
          handle(splitter.finish());
        }

        if (!acc.trim()) throw new LlmError(503, "llm_unavailable", "llm_error", true);
        const emotion: Emotion = sentEmotion ?? "neutral";
        if (!sentEmotion) send("emotion", { emotion });
        const saved = opts.save(text, acc, emotion);
        send("done", { message: saved.message });
      } catch (error) {
        const code = error instanceof LlmError ? error.code : "llm_error";
        const key = error instanceof LlmError ? error.key : "llm_error";
        console.error(`[dialogue] stream failed after ${Date.now() - startedAt}ms:`, error);
        send("error", { message: msg(lang, key), code });
      } finally {
        clearInterval(ping);
        closed = true;
        releaseLock(opts.lockKey);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function messageJson(id: string, role: "user" | "assistant", text: string, at: string, emotion?: Emotion) {
  return { id, role, text, at, ...(emotion ? { emotion } : {}) };
}
