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
