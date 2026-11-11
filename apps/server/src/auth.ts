import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "@socrates/shared";
import type { Ctx } from "./http";
import { timingSafeEqual } from "./auth-crypto";

export const SESSION_COOKIE = "socrates_session";
export const PREVIEW_RETURN_COOKIE = "socrates_preview_return";
const SESSION_DAYS = 30;

interface TokenClaims {
  uid: string;
  name: string;
  g?: 1;
  role?: "student" | "teacher";
  pv?: 1;
  pc?: string;
  exp: number;
}

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

function secretOf(ctx: { env: { AUTH_SECRET?: string } }): string {
  const secret = ctx.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromB64url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64url(new Uint8Array(mac));
}

export async function sealClaims(ctx: { env: { AUTH_SECRET?: string } }, claims: object): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload, secretOf(ctx))}`;
}

export async function openClaims<T>(
  ctx: { env: { AUTH_SECRET?: string } },
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  if (!timingSafeEqual(await sign(payload, secretOf(ctx)), sig)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payload))) as T;
  } catch {
    return null;
  }
}

export async function issueSessionToken(ctx: { env: { AUTH_SECRET?: string } }, user: User): Promise<string> {
  const claims: TokenClaims = {
    uid: user.id,
    name: user.name,
    ...(user.guest ? { g: 1 as const } : {}),
    ...(user.preview ? { pv: 1 as const } : {}),
    ...(user.previewClassroomId ? { pc: user.previewClassroomId } : {}),
    exp: Date.now() + SESSION_DAYS * 864e5,
  };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await sign(payload, secretOf(ctx));
  return `${payload}.${sig}`;
}

export async function userFromSessionToken(
  ctx: { env: { AUTH_SECRET?: string } },
  token: string | undefined,
): Promise<User | null> {
  if (!token) return null;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = await sign(payload, secretOf(ctx));
    if (expected.length !== sig.length) return null;
    const a = fromB64url(sig);
    const b = fromB64url(expected);
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
    if (diff !== 0) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TokenClaims;
    if (claims.exp < Date.now()) return null;
    const guest = claims.g === 1 || (claims.g === undefined && claims.role === "student");
    return {
      id: claims.uid,
      name: claims.name,
      guest,
      ...(claims.pv ? { preview: true } : {}),
      ...(claims.pc ? { previewClassroomId: claims.pc } : {}),
    };
  } catch {
    return null;
  }
}

function setTokenCookie(c: Ctx, name: string, token: string): void {
  setCookie(c, name, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure: true,
  });
}

export async function startSession(c: Ctx, user: User): Promise<void> {
  setTokenCookie(c, SESSION_COOKIE, await issueSessionToken({ env: c.env }, user));
}

export function endSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  deleteCookie(c, PREVIEW_RETURN_COOKIE, { path: "/" });
}

export async function enterPreviewSession(c: Ctx, teacherToken: string | undefined, student: User): Promise<void> {
  if (teacherToken) setTokenCookie(c, PREVIEW_RETURN_COOKIE, teacherToken);
  await startSession(c, student);
}

export async function leavePreviewSession(c: Ctx): Promise<User | null> {
  const token = getCookie(c, PREVIEW_RETURN_COOKIE);
  const teacher = await userFromSessionToken({ env: c.env }, token);
  deleteCookie(c, PREVIEW_RETURN_COOKIE, { path: "/" });
  if (!token || !teacher || teacher.preview) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return null;
  }
  setTokenCookie(c, SESSION_COOKIE, token);
  return teacher;
}

// OWASP recommends 600k PBKDF2-SHA256 iterations; Workers CPU limits make
// that cost prohibitive per login. 100k with per-user salt is the deliberate
// compromise — revisit if Workers CPU budgets change.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return b64url(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${hash}`;
}

export const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64url(salt) as BufferSource, iterations: Number(iterations), hash: "SHA-256" },
    key,
    256,
  );
  const computed = b64url(new Uint8Array(bits));
  return timingSafeEqual(computed, hash);
}
