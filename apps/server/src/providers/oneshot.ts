import { normalizeContext } from "@earendil-works/pi-ai";
import type { z } from "zod";
import type { Env } from "../env";
import { buildModels, type ModelsBundle } from "./models";
import { availableProviders, isMockMode } from "./catalog";

const TIMEOUT_MS = 25_000;

export interface OneshotRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  mock: () => T;
  maxTokens?: number;
}

function extractJson(raw: string): string {
  let content = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < content.length - 1)) content = content.slice(start, end + 1);
  return content;
}

async function generateViaModel<T>(bundle: ModelsBundle, providerId: string, req: OneshotRequest<T>): Promise<T> {
  const model = bundle.byId.get(providerId as never) as
    | import("@earendil-works/pi-ai").Model<"openai-completions">
    | undefined;
  if (!model) throw new Error("model_missing");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const context = normalizeContext({
      systemPrompt: req.system,
      messages: [{ role: "user", content: req.user, timestamp: Date.now() }],
    });
    const stream = bundle.models.streamSimple(model, context, {
      maxTokens: req.maxTokens ?? 1024,
      signal: controller.signal,
      samplingParams: { response_format: { type: "json_object" } },
    } as never);
    let text = "";
    for await (const event of stream) {
      if (event.type === "text_delta") text += event.delta;
    }
    if (!text.trim()) throw new Error("empty_response");
    const parsed = req.schema.safeParse(JSON.parse(extractJson(text)));
    if (!parsed.success) throw new Error(`schema_mismatch: ${text.slice(0, 160)}`);
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

let bundleCache: { key: string; bundle: ModelsBundle } | undefined;

function bundleKey(env: Env): string {
  return [env.LLM_PROVIDER, env.DGX_BASE_URL, env.OPENCODE_API_KEY, env.OPENROUTER_API_KEY].join("\u0000");
}

export function getOneshotBundle(env: Env): ModelsBundle {
  const key = bundleKey(env);
  if (bundleCache?.key === key) return bundleCache.bundle;
  const bundle = buildModels(env, "oneshot");
  bundleCache = { key, bundle };
  return bundle;
}

export async function oneshot<T>(env: Env, bundle: ModelsBundle, req: OneshotRequest<T>): Promise<T> {
  if (isMockMode(env)) return req.mock();
  const ordered = availableProviders(env).sort((a, b) => a.priority - b.priority);
  for (const provider of ordered) {
    if (provider.id === "mock") continue;
    try {
      return await generateViaModel(bundle, provider.id, req);
    } catch (error) {
      console.warn("[oneshot] provider failed", provider.id, error instanceof Error ? error.message : error);
    }
  }
  return req.mock();
}
