import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "@socrates/shared";
import { REAUTH_TTL_SECONDS } from "@socrates/shared";
import { fail, type Ctx } from "./http";
import { timingSafeEqual } from "./auth-crypto";
import { one, type Db } from "./db/d1";

export const SESSION_COOKIE = "socrates_session";
export const REAUTH_COOKIE = "socrates_reauth";
export const PARTICIPANT_COOKIE = "socrates_participant";
const SESSION_DAYS = 30;
const PARTICIPANT_DAYS = 7;
const REAUTH_PATH = "/api";

export function cookieValue(header: string, name: string): string | undefined {
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

interface TokenClaims {
  uid: string;
  ver: number;
  exp: number;
}

export interface Session {
  user: User;
  version: number;
  expiresAt: number;
}

export type SessionLookup =
  | { kind: "ok"; session: Session }
  | { kind: "missing" }
  | { kind: "stale" }
  | { kind: "disabled" };

export interface SessionEnv {
  AUTH_SECRET?: string;
  DB: Db;
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  email_verified_at: string | null;
  is_admin: number;
  disabled_at: string | null;
  session_version: number;
}

export function toUser(row: {
  id: string;
  name: string;
  email: string | null;
  email_verified_at: string | null;
  is_admin: number;
}): User {
  return {
    id: row.id,
    name: row.name,
    isAdmin: row.is_admin === 1,
    emailVerified: row.email === null || row.email_verified_at !== null,
  };
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

export function secretOf(ctx: { env: { AUTH_SECRET?: string } }): string {
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

export async function sealPayload(ctx: { env: { AUTH_SECRET?: string } }, data: unknown): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(data)));
  return `${payload}.${await sign(payload, secretOf(ctx))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function openPayload(ctx: { env: { AUTH_SECRET?: string } }, token: string | undefined): Promise<unknown> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload, secretOf(ctx));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export type AccountTokenPurpose = "password_reset" | "email_verify";
type SignedPurpose = AccountTokenPurpose | "reauth";

interface AccountTokenClaims {
  purpose: AccountTokenPurpose;
  uid: string;
  exp: number;
}

function purposeSecret(ctx: { env: { AUTH_SECRET?: string } }, purpose: SignedPurpose): Promise<string> {
  return sign(`socrates:${purpose}`, secretOf(ctx));
}

interface ReauthClaims {
  purpose: "reauth";
  uid: string;
  ver: number;
  exp: number;
}

export async function issueReauth(c: Ctx, userId: string, version: number, expiresAt: number): Promise<void> {
  const claims: ReauthClaims = { purpose: "reauth", uid: userId, ver: version, exp: expiresAt };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await sign(payload, await purposeSecret({ env: c.env }, "reauth"));
  const maxAge = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  setCookie(c, REAUTH_COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    sameSite: "Lax",
    path: REAUTH_PATH,
    maxAge,
    secure: true,
  });
}

export async function startReauth(c: Ctx, userId: string, version: number): Promise<number> {
  const expiresAt = Date.now() + REAUTH_TTL_SECONDS * 1000;
  await issueReauth(c, userId, version, expiresAt);
  return expiresAt;
}

export function endReauth(c: Ctx): void {
  deleteCookie(c, REAUTH_COOKIE, { path: REAUTH_PATH });
}

export async function readReauth(c: Ctx): Promise<{ uid: string; ver: number; exp: number } | null> {
  const token = getCookie(c, REAUTH_COOKIE);
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = await sign(payload, await purposeSecret({ env: c.env }, "reauth"));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!isRecord(decoded)) return null;
    if (decoded.purpose !== "reauth" || typeof decoded.uid !== "string" || typeof decoded.ver !== "number") {
      return null;
    }
    if (typeof decoded.exp !== "number" || decoded.exp <= Date.now()) return null;
    return { uid: decoded.uid, ver: decoded.ver, exp: decoded.exp };
  } catch {
    return null;
  }
}

export async function requireReauth(c: Ctx): Promise<{ exp: number; version: number }> {
  const user = c.get("user");
  const version = c.get("sessionVersion");
  const claims = await readReauth(c);
  if (!user || version === null || !claims || claims.uid !== user.id || claims.ver !== version) {
    fail(403, "reauth_required");
  }
  return { exp: claims.exp, version };
}

export function passwordResetBinding(passwordHash: string, email: string | null): string {
  return `${passwordHash}\n${email ?? ""}`;
}

export function emailVerifyBinding(email: string): string {
  return `email_verify\n${email}`;
}

export async function sealAccountToken(
  ctx: { env: { AUTH_SECRET?: string } },
  purpose: AccountTokenPurpose,
  uid: string,
  binding: string,
  ttlMs: number,
): Promise<string> {
  const claims: AccountTokenClaims = { purpose, uid, exp: Date.now() + ttlMs };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(`${payload}.${binding}`, await purposeSecret(ctx, purpose))}`;
}

export function readAccountToken(token: string, purpose: AccountTokenPurpose): { uid: string } | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!isRecord(decoded)) return null;
    if (decoded.purpose !== purpose || typeof decoded.uid !== "string" || typeof decoded.exp !== "number") {
      return null;
    }
    if (decoded.exp <= Date.now()) return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

export async function verifyAccountToken(
  ctx: { env: { AUTH_SECRET?: string } },
  purpose: AccountTokenPurpose,
  token: string,
  binding: string,
): Promise<boolean> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await sign(`${payload}.${binding}`, await purposeSecret(ctx, purpose));
  return timingSafeEqual(expected, sig);
}

export async function issueSessionToken(
  ctx: { env: { AUTH_SECRET?: string } },
  user: User,
  version: number,
): Promise<string> {
  const claims: TokenClaims = {
    uid: user.id,
    ver: version,
    exp: Date.now() + SESSION_DAYS * 864e5,
  };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await sign(payload, secretOf(ctx));
  return `${payload}.${sig}`;
}

async function tokenClaims(
  ctx: { env: { AUTH_SECRET?: string } },
  token: string | undefined,
): Promise<TokenClaims | null> {
  if (!token) return null;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = await sign(payload, secretOf(ctx));
    if (!timingSafeEqual(expected, sig)) return null;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!isRecord(decoded)) return null;
    if (typeof decoded.uid !== "string" || typeof decoded.ver !== "number" || typeof decoded.exp !== "number") {
      return null;
    }
    const claims: TokenClaims = { uid: decoded.uid, ver: decoded.ver, exp: decoded.exp };
    if (claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function lookupSession(env: SessionEnv, token: string | undefined): Promise<SessionLookup> {
  const claims = await tokenClaims({ env }, token);
  if (!claims) return { kind: "missing" };
  const row = await one<UserRow>(
    env.DB,
    "SELECT id, name, email, email_verified_at, is_admin, disabled_at, session_version FROM users WHERE id = $id",
    { id: claims.uid },
  );
  if (!row) return { kind: "missing" };
  if (row.disabled_at !== null) return { kind: "disabled" };
  if (row.session_version !== claims.ver) return { kind: "stale" };
  return { kind: "ok", session: { user: toUser(row), version: row.session_version, expiresAt: claims.exp } };
}

export interface AccountState {
  disabled: boolean;
  version: number;
}

export async function accountState(db: Db, userId: string): Promise<AccountState | null> {
  const row = await one<{ disabled_at: string | null; session_version: number }>(
    db,
    "SELECT disabled_at, session_version FROM users WHERE id = $id",
    { id: userId },
  );
  return row ? { disabled: row.disabled_at !== null, version: row.session_version } : null;
}

export async function resumeSession(c: Ctx, user: User, version: number): Promise<void> {
  const token = await issueSessionToken({ env: c.env }, user, version);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure: true,
  });
}

export async function startSession(c: Ctx, user: User): Promise<void> {
  const state = await accountState(c.env.DB, user.id);
  await resumeSession(c, user, state?.version ?? 0);
}

export function endSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

interface ParticipantClaims {
  aid: string;
  pid: string;
  exp: number;
}

export interface ParticipantIdentity {
  activityId: string;
  participantId: string;
}

export async function startParticipantSession(c: Ctx, activityId: string, participantId: string): Promise<void> {
  const claims: ParticipantClaims = {
    aid: activityId,
    pid: participantId,
    exp: Date.now() + PARTICIPANT_DAYS * 864e5,
  };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await sign(payload, secretOf(c));
  setCookie(c, PARTICIPANT_COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: PARTICIPANT_DAYS * 86400,
    secure: true,
  });
}

export async function lookupParticipant(
  env: { AUTH_SECRET?: string },
  token: string | undefined,
): Promise<ParticipantIdentity | null> {
  if (!token) return null;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = await sign(payload, secretOf({ env }));
    if (!timingSafeEqual(expected, sig)) return null;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!isRecord(decoded)) return null;
    if (typeof decoded.aid !== "string" || typeof decoded.pid !== "string" || typeof decoded.exp !== "number") {
      return null;
    }
    if (decoded.exp < Date.now()) return null;
    return { activityId: decoded.aid, participantId: decoded.pid };
  } catch {
    return null;
  }
}

// OWASP recommends 600k PBKDF2-SHA256 iterations; Workers CPU limits make
// that cost prohibitive per login. 100k with per-user salt is the deliberate
// compromise — revisit if Workers CPU budgets change.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
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
    { name: "PBKDF2", salt: fromB64url(salt), iterations: Number(iterations), hash: "SHA-256" },
    key,
    256,
  );
  const computed = b64url(new Uint8Array(bits));
  return timingSafeEqual(computed, hash);
}
