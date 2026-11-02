import type { Context } from "hono";
import type { Lang } from "@socrates/shared";
import type { Env } from "./env";
import { languageOf } from "./messages";

export interface UserRow {
  id: string;
  name: string;
  role: "student" | "teacher";
  avatar_url: string | null;
  created_at: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: UserRow;
    lang: Lang;
  };
}

export type Ctx = Context<AppEnv>;

/** 帶有給使用者看的訊息與錯誤碼；由 app.onError 轉成 { message, code }。 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public key: string,
    public vars: Record<string, string | number> = {},
    public code?: string,
  ) {
    super(key);
  }
}

export function fail(status: number, key: string, vars: Record<string, string | number> = {}, code?: string): never {
  throw new HttpError(status, key, vars, code);
}

export function langOf(c: Ctx): Lang {
  return c.get("lang") ?? languageOf(c.req.header("Accept-Language"));
}

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replaceAll("-", "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function bodyOf(c: Ctx): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    fail(400, "invalid_request");
  }
  if (!isObject(body)) fail(400, "invalid_request");
  return body;
}

export function str(value: unknown, key: string, opts: { trim?: boolean; min?: number; max?: number } = {}): string {
  if (typeof value !== "string") fail(422, key);
  const out = opts.trim === false ? value : value.trim();
  if (opts.min !== undefined && out.length < opts.min) fail(422, key);
  if (opts.max !== undefined && out.length > opts.max) fail(422, "text_too_long", { n: opts.max });
  return out;
}

export function optionalStr(value: unknown, key: string, opts: { trim?: boolean; max?: number } = {}): string | undefined {
  if (value === undefined) return undefined;
  return str(value, key, opts);
}

export function boolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

export function number(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) fail(422, "validation");
  return [...new Set(value as string[])];
}
