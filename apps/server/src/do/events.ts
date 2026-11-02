import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

type Listener = (payload: string) => void;

/**
 * 活動事件的跨 isolate 廣播。原 events.ts 是 in-memory Map——Workers 上
 * publish 與 subscribe 常在不同 isolate，必須經 DO。
 * SSE 連線掛在這個 DO 上（每個 activity 一個 instance）。
 */
export class ActivityEvents extends DurableObject<Env> {
  private listeners = new Map<number, Listener>();
  private seq = 0;

  /** SSE 端點：路由層直接回傳這個 Response。 */
  stream(): Response {
    const id = ++this.seq;
    const encoder = new TextEncoder();
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (payload: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            closed = true;
          }
        };
        this.listeners.set(id, write);
        const ping = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* 已關閉 */
          }
        }, 15_000);
        // 斷線清理
        // @ts-expect-error — signal 在 Workers 的 ReadableStream 上可用
        controller.signal?.addEventListener("abort", () => {
          closed = true;
          clearInterval(ping);
          this.listeners.delete(id);
        });
      },
      cancel: () => {
        closed = true;
        this.listeners.delete(id);
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
  }

  /** 服務層經 RPC 呼叫；扇出到所有連線。 */
  broadcast(event: unknown): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const listener of [...this.listeners.values()]) {
      try {
        listener(payload);
      } catch {
        /* 斷線的訂閱者會在 cancel 時移除 */
      }
    }
  }

  count(): number {
    return this.listeners.size;
  }
}

// ---- 服務層用的 sink：publish(activityId, event) 經 DO 廣播 ----

let bus: { getByName(name: string): { broadcast(event: unknown): void } } | null = null;

/** 結構化型別：避免 workers-types 與 runtime 型別雙頭衝突 */
export function configureEventBus(namespace: { getByName(name: string): { broadcast(event: unknown): void } }): void {
  bus = namespace;
}

export function publish(activityId: string, event: Record<string, unknown>): void {
  if (!bus) return;
  try {
    void bus.getByName(activityId).broadcast(event);
  } catch {
    /* 事件是 best-effort */
  }
}
