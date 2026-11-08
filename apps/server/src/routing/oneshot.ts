import type { Model } from "@earendil-works/pi-ai";
import type { Env } from "../env";
import { Router, type TrafficClass } from "./router";

export interface OneshotRequest<T> {
  system: string;
  user: string;
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } };
  mock: () => T;
  maxTokens?: number;
  prose?: boolean;
  trafficClass?: TrafficClass;
}

const TIMEOUT_MS = 25_000;

export async function oneshot<T>(env: Env, req: OneshotRequest<T>): Promise<T> {
  if (env.LLM_PROVIDER === "mock") return req.mock();
  const router = new Router(env);
  const decision = router.pick(req.trafficClass ?? "batch");
  if (!decision) return req.mock();
  const models = router.modelsFor(decision);
  if (!models) {
    router.settle(decision, "error");
    return req.mock();
  }
  const model = models.getModel(decision.entry.provider, decision.model) as Model<"openai-completions"> | undefined;
  if (!model) {
    router.settle(decision, "error");
    return req.mock();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const stream = models.streamSimple(
      model as never,
      {
        systemPrompt: req.system,
        messages: [{ role: "user", content: req.user, timestamp: Date.now() }],
      } as never,
      {
        maxTokens: req.maxTokens ?? 1024,
        signal: controller.signal,
        samplingParams: req.prose ? {} : { response_format: { type: "json_object" } },
      } as never,
    );
    let text = "";
    for await (const event of stream) {
      if (event.type === "text_delta") text += event.delta;
    }
    let parsed: { success: true; data: T } | { success: false; error: unknown };
    try {
      parsed = req.schema.safeParse(req.prose ? text.trim() : JSON.parse(text));
    } catch (cause) {
      router.settle(decision, "error");
      throw cause;
    }
    if (!parsed.success) {
      router.settle(decision, "error");
      throw new Error(`schema_mismatch: ${text.slice(0, 160)}`);
    }
    router.settle(decision, "ok");
    return parsed.data;
  } catch (cause) {
    if (controller.signal.aborted) router.settle(decision, "timeout");
    else router.settle(decision, "error");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
