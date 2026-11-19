import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, type ErrorCode, type Lang, type User } from "@socrates/shared";
import type { Env } from "./env";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: User | null;
    lang: Lang;
    sessionIssue: "stale" | "disabled" | null;
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
  if (user) return user;
  if (c.get("sessionIssue") === "disabled") fail(403, "account_disabled");
  fail(401, "unauthorized");
}

export function uniqueViolationColumns(error: unknown): Array<[string, string]> {
  const messages: string[] = [];
  if (error instanceof Error) {
    messages.push(error.message);
    if (error.cause instanceof Error) messages.push(error.cause.message);
  }
  for (const message of messages) {
    // Miniflare/D1 envelopes the raw SQLite message: `D1_ERROR: UNIQUE constraint failed: t.c, t.c2: SQLITE_CONSTRAINT (extended: …)`
    const normalized = message.replace(/^D1_ERROR:\s*/, "");
    const match = normalized.match(/^UNIQUE constraint failed: (.+?)(?:: SQLITE_CONSTRAINT\b.*)?$/);
    if (!match) continue;
    return match[1]!
      .split(",")
      .map((pair) => pair.trim().split("."))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([table, column]) => [table, column] as [string, string]);
  }
  return [];
}

export function requireAdmin(c: Ctx): User {
  const user = requireUser(c);
  if (!user.isAdmin) fail(403, "forbidden");
  return user;
}

const CAPABILITY_FLAGS = {
  manage_classes: "canManageClasses",
} as const satisfies Record<string, keyof User>;

export type Capability = keyof typeof CAPABILITY_FLAGS;

export function requireCapability(c: Ctx, capability: Capability): User {
  const user = requireUser(c);
  if (!user[CAPABILITY_FLAGS[capability]]) fail(403, "capability_required");
  return user;
}

export function requireAccount(c: Ctx): User {
  const user = requireUser(c);
  if (user.guest || user.preview) fail(403, "account_required");
  return user;
}

export function requireMember(c: Ctx): User {
  const user = requireAccount(c);
  if (user.kind === "student") fail(403, "student_restricted");
  return user;
}

export function requireTeacher(c: Ctx): User {
  const user = requireAccount(c);
  if (!user.canManageClasses) fail(403, "capability_required");
  return user;
}

export function enforceIpLimit(c: Ctx, scope: string, limit = 30): void {
  const ip = c.req.header("CF-Connecting-IP");
  if (!ip) return;
  if (windowHits(`${scope}:${ip}`).length >= limit) fail(429, "rate_limited");
  recordHit(`${scope}:${ip}`);
}

export function keyLimitBlocked(scope: string, key: string, limit: number): boolean {
  return windowHits(`${scope}:${key}`).length >= limit;
}

export function recordKeyHit(scope: string, key: string): void {
  recordHit(`${scope}:${key}`);
}

export function clearKeyHits(scope: string, key: string): void {
  ipHits.delete(`${scope}:${key}`);
}

const ipHits = new Map<string, number[]>();
const IP_TRACK_MAX = 10_000;
const HIT_WINDOW_MS = 60_000;

function windowHits(key: string): number[] {
  const now = Date.now();
  const hits = (ipHits.get(key) ?? []).filter((t) => now - t < HIT_WINDOW_MS);
  ipHits.set(key, hits);
  return hits;
}

function recordHit(key: string): void {
  const hits = windowHits(key);
  hits.push(Date.now());
  trimTrack();
}

function trimTrack(): void {
  const now = Date.now();
  while (ipHits.size >= IP_TRACK_MAX) {
    let reclaimed = false;
    for (const [k, v] of ipHits) {
      if (v.every((t) => now - t >= HIT_WINDOW_MS)) {
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
}
