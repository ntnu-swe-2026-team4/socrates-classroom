import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { LoginInputSchema, RegisterInputSchema, SignupInputSchema, type ErrorCode, type User } from "@socrates/shared";
import { batch, one } from "../db/d1";
import {
  DUMMY_HASH,
  endSession,
  hashPassword,
  openPayload,
  sealPayload,
  startSession,
  toUser,
  verifyPassword,
} from "../auth";
import {
  enforceIpLimit,
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  uniqueViolationColumns,
  type AppEnv,
  type Ctx,
} from "../http";
import { ensureParticipant } from "../services/members";
import {
  OAuthError,
  googleAuthorizeUrl,
  googleProfile,
  isOAuthProvider,
  randomToken,
  type GoogleConfig,
  type OAuthPending,
  type OAuthProfile,
  type OAuthProvider,
} from "../oauth";

const OAUTH_COOKIE = "socrates_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
const OAUTH_TTL_SECONDS = 600;
const OAUTH_SUCCESS_PATH = "/home";

interface UserRow {
  id: string;
  name: string;
  role: "student" | "teacher";
  email: string | null;
  password_hash: string | null;
  can_manage_classes: number;
  is_admin: number;
  disabled_at: string | null;
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/me", (c) => c.json(c.get("user")))
    .post("/auth/login", async (c) => {
      await enforceIpLimit(c, "login", 30);
      const input = await parseBody(c, LoginInputSchema);
      const row = await one<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = $email", {
        email: input.email,
      });
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) fail(401, "unauthorized");
      if (row.disabled_at !== null) fail(403, "account_disabled");
      const user = toUser(row);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, RegisterInputSchema);
      if (!input.tosAccepted) fail(422, "tos_required");
      const classroom = await one<{ id: string; current_activity_id: string | null }>(
        c.env.DB,
        "SELECT id, current_activity_id FROM classrooms WHERE join_code = $code",
        { code: input.code },
      );
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const activity = await one<{ finished_at: string | null }>(
        c.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: classroom.current_activity_id },
      );
      if (activity?.finished_at) fail(409, "activity_finished");
      const hash = await hashPassword(input.password);
      const clash = await one<{ id: string }>(
        c.env.DB,
        "SELECT user_id AS id FROM members WHERE classroom_id = $cid AND name = $name",
        { cid: classroom.id, name: input.name },
      );
      if (clash) fail(409, "name_taken");
      const emailTaken = await one<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE email = $email", {
        email: input.email,
      });
      if (emailTaken) fail(409, "conflict");
      const id = newId("u_");
      const at = nowIso();
      try {
        await batch(c.env.DB, [
          {
            sql: "INSERT INTO users (id, name, role, email, password_hash, lang, created_at) VALUES ($id, $name, 'student', $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, at, lang: langOf(c) },
          },
          {
            sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
            params: { cid: classroom.id, uid: id, name: input.name, at },
          },
        ]);
      } catch (error) {
        const pairs = uniqueViolationColumns(error);
        if (pairs.length === 0) throw error;
        if (pairs.some(([table, column]) => table === "members" && column === "name")) fail(409, "name_taken");
        fail(409, "conflict");
      }
      const user = { id, name: input.name, canManageClasses: false, isAdmin: false };
      await ensureParticipant(c.env.DB, classroom.current_activity_id, user, at);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/signup", async (c) => {
      await enforceIpLimit(c, "register", 30);
      const input = await parseBody(c, SignupInputSchema);
      if (!input.tosAccepted) fail(422, "tos_required");
      const hash = await hashPassword(input.password);
      const id = newId("u_");
      try {
        await batch(c.env.DB, [
          {
            sql: "INSERT INTO users (id, name, role, email, password_hash, lang, created_at) VALUES ($id, $name, 'student', $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, lang: langOf(c), at: nowIso() },
          },
        ]);
      } catch (error) {
        const pairs = uniqueViolationColumns(error);
        if (pairs.some(([table, column]) => table === "users" && column === "email")) fail(409, "email_taken");
        throw error;
      }
      const user: User = { id, name: input.name, canManageClasses: false, isAdmin: false };
      await startSession(c, user);
      return c.json(user);
    })
    .get("/auth/oauth/:provider/start", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = c.req.param("provider");
      if (!isOAuthProvider(provider)) fail(404, "not_found");
      const config = googleConfig(c);
      if (!config) return oauthFailure(c, "oauth_unavailable");
      const pending: OAuthPending = {
        provider,
        state: randomToken(),
        verifier: randomToken(48),
        nonce: randomToken(),
        exp: Date.now() + OAUTH_TTL_SECONDS * 1000,
      };
      setCookie(c, OAUTH_COOKIE, await sealPayload({ env: c.env }, pending), {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: OAUTH_COOKIE_PATH,
        maxAge: OAUTH_TTL_SECONDS,
      });
      return c.redirect(await googleAuthorizeUrl(config, pending), 302);
    })
    .get("/auth/oauth/:provider/callback", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = c.req.param("provider");
      if (!isOAuthProvider(provider)) fail(404, "not_found");
      const pending = await openPayload<OAuthPending>({ env: c.env }, getCookie(c, OAUTH_COOKIE));
      deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH, secure: true });
      const state = c.req.query("state");
      const code = c.req.query("code");
      if (!pending || pending.provider !== provider || pending.exp < Date.now() || !state || state !== pending.state) {
        return oauthFailure(c, "oauth_state_invalid");
      }
      if (c.req.query("error") || !code) return oauthFailure(c, "oauth_failed");
      const config = googleConfig(c);
      if (!config) return oauthFailure(c, "oauth_unavailable");
      let profile: OAuthProfile;
      try {
        profile = await googleProfile(config, code, pending);
      } catch (error) {
        if (error instanceof OAuthError) return oauthFailure(c, error.code);
        throw error;
      }
      const user = await userForIdentity(c, provider, profile);
      await startSession(c, user);
      return c.redirect(OAUTH_SUCCESS_PATH, 302);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    });
}

function googleConfig(c: Ctx): GoogleConfig | null {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(c.req.url).origin;
  return { clientId, clientSecret, redirectUri: `${base}/api/auth/oauth/google/callback` };
}

function oauthFailure(c: Ctx, code: ErrorCode): Response {
  return c.redirect(`/login?error=${code}`, 302);
}

async function userForIdentity(c: Ctx, provider: OAuthProvider, profile: OAuthProfile): Promise<User> {
  const findSql =
    "SELECT u.id, u.name, u.can_manage_classes, u.is_admin FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $provider AND i.provider_user_id = $subject";
  const key = { provider, subject: profile.subject };
  const existing = await one<{ id: string; name: string; can_manage_classes: number; is_admin: number }>(
    c.env.DB,
    findSql,
    key,
  );
  if (existing) return toUser(existing);
  const id = newId("u_");
  const at = nowIso();
  try {
    await batch(c.env.DB, [
      {
        sql: "INSERT INTO users (id, name, role, lang, created_at) VALUES ($id, $name, 'student', $lang, $at)",
        params: { id, name: profile.name, lang: langOf(c), at },
      },
      {
        sql: "INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES ($provider, $subject, $id, $email, $at)",
        params: { ...key, id, email: profile.email, at },
      },
    ]);
  } catch (error) {
    if (!uniqueViolationColumns(error).some(([table]) => table === "user_identities")) throw error;
    const raced = await one<{ id: string; name: string; can_manage_classes: number; is_admin: number }>(
      c.env.DB,
      findSql,
      key,
    );
    if (!raced) throw error;
    return toUser(raced);
  }
  return { id, name: profile.name, canManageClasses: false, isAdmin: false };
}
