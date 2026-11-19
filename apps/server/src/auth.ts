import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "@socrates/shared";
import type { Ctx } from "./http";
import { timingSafeEqual } from "./auth-crypto";
import { one, type Db } from "./db/d1";

export const SESSION_COOKIE = "socrates_session";
export const PREVIEW_RETURN_COOKIE = "socrates_preview_return";
export const PARTICIPANT_COOKIE = "socrates_participant";
const SESSION_DAYS = 30;
const PARTICIPANT_DAYS = 7;

interface TokenClaims {
  uid: string;
  ver: number;
  exp: number;
}

export interface Session {
  user: User;
  version: number;
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
  can_manage_classes: number;
  is_admin: number;
  disabled_at: string | null;
  session_version: number;
  teacher_plan: "trial" | "school" | null;
  teacher_mode: number;
  teacher_request_at: string | null;
  school_name: string | null;
  username: string | null;
  student_classroom_id: string | null;
  preview_classroom_id: string | null;
}

const USER_COLUMNS = `u.id, u.name, u.can_manage_classes, u.is_admin, u.disabled_at, u.session_version,
  u.teacher_plan, u.teacher_mode, u.teacher_request_at, s.name AS school_name, u.username,
  u.student_classroom_id, u.preview_classroom_id`;

const USER_JOIN = "FROM users u LEFT JOIN schools s ON s.id = u.school_id";

export type AccountRow = Pick<UserRow, "id" | "name" | "can_manage_classes" | "is_admin"> & Partial<UserRow>;

export function toUser(row: AccountRow): User {
  const kind = row.student_classroom_id ? "student" : "member";
  return {
    id: row.id,
    name: row.name,
    canManageClasses: row.can_manage_classes === 1,
    isAdmin: row.is_admin === 1,
    guest: false,
    kind,
    teacherPlan: row.teacher_plan,
    teacherMode: row.can_manage_classes === 1 && row.teacher_mode === 1,
    teacherRequested: row.teacher_plan === null && row.teacher_request_at !== null,
    schoolName: row.school_name,
    username: row.username,
    classroomId: row.student_classroom_id,
    ...(row.preview_classroom_id ? { preview: true, previewClassroomId: row.preview_classroom_id } : {}),
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

export async function openPayload<T>(
  ctx: { env: { AUTH_SECRET?: string } },
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await sign(payload, secretOf(ctx));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payload))) as T;
  } catch {
    return null;
  }
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
    if (expected.length !== sig.length) return null;
    const a = fromB64url(sig);
    const b = fromB64url(expected);
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
    if (diff !== 0) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as TokenClaims;
    if (claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function lookupSession(env: SessionEnv, token: string | undefined): Promise<SessionLookup> {
  const claims = await tokenClaims({ env }, token);
  if (!claims) return { kind: "missing" };
  const row = await one<UserRow>(env.DB, `SELECT ${USER_COLUMNS} ${USER_JOIN} WHERE u.id = $id`, { id: claims.uid });
  if (!row) return { kind: "missing" };
  if (row.disabled_at !== null) return { kind: "disabled" };
  if (row.session_version !== claims.ver) return { kind: "stale" };
  return { kind: "ok", session: { user: toUser(row), version: row.session_version } };
}

export async function loadAccount(db: Db, id: string): Promise<User | null> {
  const row = await one<UserRow>(db, `SELECT ${USER_COLUMNS} ${USER_JOIN} WHERE u.id = $id`, { id });
  return row ? toUser(row) : null;
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

export async function startSession(c: Ctx, user: User): Promise<void> {
  const state = await accountState(c.env.DB, user.id);
  const token = await issueSessionToken({ env: c.env }, user, state?.version ?? 0);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure: true,
  });
}

export function endSession(c: Ctx): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  deleteCookie(c, PREVIEW_RETURN_COOKIE, { path: "/" });
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

export async function enterPreviewSession(c: Ctx, teacherToken: string | undefined, student: User): Promise<void> {
  if (teacherToken) setTokenCookie(c, PREVIEW_RETURN_COOKIE, teacherToken);
  await startSession(c, student);
}

export async function leavePreviewSession(c: Ctx): Promise<User | null> {
  const token = getCookie(c, PREVIEW_RETURN_COOKIE);
  deleteCookie(c, PREVIEW_RETURN_COOKIE, { path: "/" });
  if (!token) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return null;
  }
  const lookup = await lookupSession(c.env, token);
  if (lookup.kind !== "ok") {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return null;
  }
  setTokenCookie(c, SESSION_COOKIE, token);
  return lookup.session.user;
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
    if (expected.length !== sig.length) return null;
    const a = fromB64url(sig);
    const b = fromB64url(expected);
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
    if (diff !== 0) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as ParticipantClaims;
    if (claims.exp < Date.now()) return null;
    if (typeof claims.aid !== "string" || typeof claims.pid !== "string") return null;
    return { activityId: claims.aid, participantId: claims.pid };
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
