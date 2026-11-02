import { DurableObject } from "cloudflare:workers";
import { createRegistry, Harness, type SnapshotEvent } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import type { AnyModel } from "@earendil-works/pi-ai";
import type { Emotion } from "@socrates/shared";
import PREAMBLE_RAW from "../../../../packages/llm/prompts/socrates.md?raw";
import { d1 } from "../db/d1";
import type { Env } from "../env";
import { EmotionSplitter } from "../providers/emotion";
import { buildPool, isHealthy, markDegraded, type Pool } from "../providers/pool";
import { loadHistory, saveTurn } from "../services/dialogue-save";

/**
 * 一個對話執行緒 = 一個 PiAgent DO instance（idFromName(`${scope}:${id}`)）。
 * pi 擁有 transcript、inbox、重試與恢復（存在 DO 自己的 SQLite，pi_* 表）；
 * 本 DO 另負責：SSE 轉換（現有前端契約）、D1 寫回、provider 健康選擇。
 */
export class PiAgent extends DurableObject<Env> {
  readonly pool: Pool = buildPool(this.env);
  readonly registry = createRegistry();

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install({
        name: "socrates",
        sections: [{ key: "preamble", render: () => PREAMBLE_RAW.trim(), tag: false }],
      });
      return Harness.open(
        storage,
        {
          models: this.pool.models,
          registry: this.registry,
          onWake,
          settings: {
            // 指數退避：1、2、4、8、16 秒
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
            afterFailedRun: "continue",
          },
          onReport: (error) => console.warn("[pi] report", error),
        },
        context,
      );
    },
    defaults: { model: this.chainHead(), thinkingLevel: "low" },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  /** 同一執行緒一次只跑一個對話請求（前端契約：409 already_streaming）。 */
  private busy = false;

  private chainHead(): AnyModel | undefined {
    return this.pool.chain[0]?.model;
  }

  /**
   * 對話一輪：送出使用者輸入，把 pi events 轉成現有 SSE 契約。
   * 回傳 SSE Response；一開始就失敗則丟錯（訊息 key），路由層轉成 HTTP 錯誤。
   */
  async dialogue(input: {
    scope: "archive" | "activity" | "discussion";
    scopeId: string;
    userId: string;
    userText: string;
    lang: string;
    title: string;
    statement?: string;
    extra?: string;
  }): Promise<Response> {
    if (this.busy) throw new Error("already_streaming");
    const entry = this.pool.chain.find((e) => isHealthy(e.provider)) ?? this.pool.chain[0];
    if (!entry) throw new Error("llm_not_configured");

    const session = this.harness.session();
    try {
      // 健康優先：每輪把 session 指到當前健康的 provider
      await session.setModel(entry.model as never);
    } catch {
      /* 舊 session 無法換模型時沿用 defaults */
    }

    // pi transcript 是空的（DO 剛建立）但 D1 已有歷史（舊對話遷移）→ 首輪注入上下文
    let userText = input.userText;
    try {
      const existing = await session.messages();
      if (!existing.length) {
        const history = await loadHistory(d1(this.env.DB), input.scope, input.scopeId, input.userId);
        if (history.length) userText = `${digest(history)}\n\n【學生剛剛說】${input.userText}`;
      }
    } catch {
      /* 讀不到歷史就照常送出 */
    }

    this.busy = true;
    try {
      const stream = await session.events();
      const encoder = new TextEncoder();
      let closed = false;
      let sentEmotion: Emotion | null = null;
      let acc = "";
      const splitter = new EmotionSplitter();

      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch {
              closed = true;
            }
          };
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

          const pump = async () => {
            const ping = setInterval(() => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                /* 已關閉 */
              }
            }, 15_000);
            try {
              send("meta", { provider: entry.provider });
              // 先訂閱事件（snapshot + 每 commit 一批），再送出——順序顛倒會漏掉瞬時完成的 run
              const snap = (stream as { snapshot?: SnapshotEvent }).snapshot;
              if (snap?.generation?.message) handle(splitter.push(partialText(snap.generation.message)));
              const _consuming = stream.start(async (events) => {
                for (const event of events) {
                  if (event.type === "message_update") {
                    for (const change of event.changes) {
                      if (change.type === "text_delta") handle(splitter.push(change.delta));
                    }
                  }
                }
              });
              const receipt = await session.submit(userText);
              const result = (await session.wait(receipt.operationId).catch((error: unknown) => ({ error }))) as
                | { status: string; reason?: string }
                | { error: unknown };
              if ("error" in result) throw result.error;
              if (result.status === "unanswered") throw new Error(`llm_unavailable:${result.reason ?? ""}`);
              // 讓最後一批事件送達，再以 transcript 為準（delta 只是串流 UX）
              await new Promise((r) => setTimeout(r, 30));
              if (!acc.trim()) {
                const lastText = lastAssistantText((await session.messages()) as never);
                if (lastText) handle(splitter.push(lastText));
              }
              const final = splitter.finish();
              handle({ emotion: final.emotion, text: final.text });
              const emotion = (sentEmotion ?? "neutral") as Emotion;
              if (!sentEmotion) send("emotion", { emotion });
              if (!acc.trim()) throw new Error("llm_unavailable");

              const saved = await saveTurn(d1(this.env.DB), {
                scope: input.scope,
                scopeId: input.scopeId,
                userId: input.userId,
                userText: input.userText,
                assistantText: acc,
                emotion,
              });
              send("done", { message: { id: saved.id, role: "assistant", text: acc, at: saved.at, emotion } });
            } catch (error) {
              markDegraded(entry.provider);
              const raw = error instanceof Error ? error.message : String(error);
              const rate = /rate|429|concurren/i.test(raw);
              send("error", { message: raw, code: rate ? "llm_rate_limited" : "llm_unavailable" });
            } finally {
              clearInterval(ping);
              this.busy = false;
              closed = true;
              try {
                await stream.stop();
              } catch {
                /* stream 已結束 */
              }
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          };
          void pump();
        },
        cancel: () => {
          // 客戶端斷線：pi 的工作照跑（durable），不浪費已產生的內容
          closed = true;
        },
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }

  /** 管理端點：pool 健康。 */
  status() {
    return {
      busy: this.busy,
      chain: this.pool.chain.map((e) => ({ provider: e.provider, healthy: isHealthy(e.provider) })),
    };
  }
}

/** 把 D1 歷史壓成緊湊上下文（只在新 pi session 接舊對話時用）。 */
function digest(history: Array<{ role: "user" | "assistant"; text: string }>): string {
  const recent = history.slice(-12);
  const lines = recent.map((m) => `${m.role === "user" ? "學生" : "蘇格拉底"}：${m.text.slice(0, 160)}`);
  return `（這是延續先前的對話。到目前為止：\n${lines.join("\n")}\n）`;
}

/** 從 pi transcript 取最後一則助理訊息的文字（EntryRecord.kind/model 結構）。 */
function lastAssistantText(
  entries: ReadonlyArray<{
    kind: string;
    model?: ReadonlyArray<{ role: string; content?: ReadonlyArray<{ type: string; text?: string }> }>;
  }>,
): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (!entry.kind.startsWith("pi.assistant")) continue;
    const message = entry.model?.find((m) => m.role === "assistant");
    if (!message?.content) continue;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function partialText(message: unknown): string {
  const content = (message as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}
