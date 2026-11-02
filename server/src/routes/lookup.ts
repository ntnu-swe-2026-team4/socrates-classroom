import { Hono } from "hono";
import type { Config } from "../config";
import { requireUser } from "../auth";
import { bodyOf, type AppEnv } from "../http";
import { SSE_HEADERS, checkRate } from "../services/dialogue";
import { lookupTerm, normalizeTerm, type LookupResult } from "../services/lookup";

/**
 * POST /api/lookup { term } → SSE：event: sources → event: delta … → event: done { result }。
 * 查詢本身的失敗放在 result.status；只有未登入（401）、太頻繁（429）用 HTTP 狀態碼。用戶端斷線時中止查詢。
 */
export function lookupRoutes(config: Config) {
  const r = new Hono<AppEnv>();

  r.post("/lookup", async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(c);
    // 和對話分開計算頻率
    checkRate(`lookup:${user.id}`);
    const input = typeof body.term === "string" ? body.term : "";

    const abort = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
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

        try {
          const result = await lookupTerm(config, input, (e) => {
            if (e.type === "sources") send("sources", { term: e.term, sources: e.sources });
            else send("delta", { text: e.text });
          }, abort.signal);
          send("done", { result });
        } catch (error) {
          if (!abort.signal.aborted) {
            console.error("[lookup] unexpected error:", error);
            const result: LookupResult = {
              term: normalizeTerm(input),
              status: "llm_error",
              summary: "",
              sources: [],
              error: { title: "查詢失敗", reason: "伺服器發生錯誤，請稍後再試。" },
            };
            send("done", { result });
          }
        } finally {
          clearInterval(ping);
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  });

  return r;
}
