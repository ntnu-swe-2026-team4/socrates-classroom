import type { z } from "zod";
import type { Env } from "../env";
import { availableProviders, isMockMode, resolveBaseUrl, type ProviderDescriptor } from "./catalog";

export interface OneshotRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  mock: () => T;
  maxTokens?: number;
}

const TIMEOUT_MS = 25_000;

async function callProvider<T>(env: Env, provider: ProviderDescriptor, req: OneshotRequest<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${resolveBaseUrl(env, provider).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "socrates-classroom/1.0",
        ...(provider.apiKeyEnv && env[provider.apiKeyEnv]
          ? { Authorization: `Bearer ${env[provider.apiKeyEnv] as string}` }
          : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`upstream_${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = req.schema.safeParse(JSON.parse(content));
    if (!parsed.success) throw new Error("schema_mismatch");
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function oneshot<T>(env: Env, req: OneshotRequest<T>): Promise<T> {
  if (isMockMode(env)) return req.mock();
  for (const provider of availableProviders(env)) {
    if (provider.id === "mock") continue;
    try {
      return await callProvider(env, provider, req);
    } catch {}
  }
  return req.mock();
}
