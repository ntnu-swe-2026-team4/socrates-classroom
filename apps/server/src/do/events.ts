import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

type Listener = (payload: string) => void;

export class ActivityEvents extends DurableObject<Env> {
  private listeners = new Map<number, Listener>();
  private seq = 0;

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
          } catch {}
        }, 15_000);
        // @ts-expect-error — signal is not typed on the Workers ReadableStream controller
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

  broadcast(event: unknown): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const listener of [...this.listeners.values()]) {
      try {
        listener(payload);
      } catch {}
    }
  }

  count(): number {
    return this.listeners.size;
  }
}

let bus: { getByName(name: string): { broadcast(event: unknown): void } } | null = null;

export function configureEventBus(namespace: { getByName(name: string): { broadcast(event: unknown): void } }): void {
  bus = namespace;
}

export function publish(activityId: string, event: Record<string, unknown>): void {
  if (!bus) return;
  try {
    void bus.getByName(activityId).broadcast(event);
  } catch {}
}
