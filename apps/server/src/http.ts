import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, type ErrorCode, type Lang, type User } from "@socrates/shared";
import type { Env } from "./env";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: User | null;
    lang: Lang;
  };
}

export type Ctx = Context<AppEnv>;

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replaceAll("-", "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeLang(header: string | undefined): Lang {
  const first = (header ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("zh")) return "zh";
  if (first.startsWith("en")) return "en";
  if (first.startsWith("es")) return "es";
  return "zh";
}

export function langOf(c: Ctx): Lang {
  return c.get("lang");
}

export function fail(status: number, code: ErrorCode, vars: Record<string, string | number> = {}): never {
  throw new ApiError(status, code, vars);
}

export async function parseBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(422, "validation");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(422, "validation");
  return parsed.data;
}

export function requireUser(c: Ctx): User {
  const user = c.get("user");
  if (!user) fail(401, "unauthorized");
  return user;
}

export function requireTeacher(c: Ctx): User {
  const user = requireUser(c);
  if (user.role !== "teacher") fail(403, "forbidden");
  return user;
}

export async function enforceIpLimit(c: Ctx, scope: string, limit = 30): Promise<void> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowIp(ip, scope, limit))) fail(429, "rate_limited");
}

const ipHits = new Map<string, number[]>();
const IP_TRACK_MAX = 10_000;

async function allowIp(ip: string, scope: string, limit: number): Promise<boolean> {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const window = 60_000;
  const hits = (ipHits.get(key) ?? []).filter((t) => now - t < window);
  while (ipHits.size >= IP_TRACK_MAX) {
    let reclaimed = false;
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t >= window)) {
        ipHits.delete(k);
        reclaimed = true;
        if (ipHits.size < IP_TRACK_MAX) break;
      }
    }
    if (!reclaimed) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [k, v] of ipHits) {
        const at = v[0] ?? Number.POSITIVE_INFINITY;
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = k;
        }
      }
      if (oldestKey === null) break;
      ipHits.delete(oldestKey);
    }
  }
  if (hits.length >= limit) {
    ipHits.set(key, hits);
    return false;
  }
  hits.push(now);
  ipHits.set(key, hits);
  return true;
}
