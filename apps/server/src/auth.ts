import { deleteCookie, setCookie } from "hono/cookie";
import type { User } from "@socrates/shared";
import type { Ctx } from "./http";

export const SESSION_COOKIE = "socrates_session";
const SESSION_DAYS = 30;

interface TokenClaims {
  uid: string;
  name: string;
  role: User["role"];
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

function secretOf(ctx: { env: { AUTH_SECRET?: string; BYOK_ENC_KEY?: string } }): string {
  return ctx.env.AUTH_SECRET || ctx.env.BYOK_ENC_KEY || "socrates-dev-secret";
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64url(new Uint8Array(mac));
}

export async function issueSessionToken(
  ctx: { env: { AUTH_SECRET?: string; BYOK_ENC_KEY?: string } },
  user: User,
): Promise<string> {
  const claims: TokenClaims = {
    uid: user.id,
    name: user.name,
    role: user.role,
    exp: Date.now() + SESSION_DAYS * 864e5,
  };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await sign(payload, secretOf(ctx));
  return `${payload}.${sig}`;
}

export async function userFromSessionToken(
  ctx: { env: { AUTH_SECRET?: string; BYOK_ENC_KEY?: string } },
  token: string | undefined,
): Promise<User | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload, secretOf(ctx));
  if (expected.length !== sig.length) return null;
  const a = fromB64url(sig);
  const b = fromB64url(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TokenClaims;
    if (claims.exp < Date.now()) return null;
    return { id: claims.uid, name: claims.name, role: claims.role };
  } catch {
    return null;
  }
}

export async function startSession(c: Ctx, user: User): Promise<void> {
  const token = await issueSessionToken({ env: c.env }, user);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure: c.env.COOKIE_SECURE !== "false",
  });
}

export function endSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

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
  return computed.length === hash.length && computed === hash;
}
