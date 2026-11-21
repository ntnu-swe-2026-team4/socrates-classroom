import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  PASSWORD_RESET_TTL_MINUTES,
  LoginInputSchema,
  PasswordForgotInputSchema,
  PasswordResetInputSchema,
  RegisterInputSchema,
  SignupInputSchema,
  type ErrorCode,
  type Lang,
  type User,
} from "@socrates/shared";
import { batch, one, run } from "../db/d1";
import {
  DUMMY_HASH,
  endSession,
  hashPassword,
  openPayload,
  passwordResetBinding,
  readAccountToken,
  sealAccountToken,
  sealPayload,
  startSession,
  toUser,
  verifyAccountToken,
  verifyPassword,
} from "../auth";
import { sendPasswordResetEmail } from "../mail";
import {
  enforceIpLimit,
  fail,
  langOf,
  newId,
  nowIso,
  rateLimit,
  validateJson,
  uniqueViolationColumns,
  type AppEnv,
  type Ctx,
} from "../http";
import { ensureParticipant } from "../services/members";
import {
  OAuthError,
  facebookAuthorizeUrl,
  facebookProfile,
  googleAuthorizeUrl,
  googleProfile,
  isOAuthProvider,
  oauthProviders,
  randomToken,
  type FacebookConfig,
  type GoogleConfig,
  type OAuthPending,
  type OAuthProfile,
  type OAuthProvider,
} from "../oauth";

const OAUTH_COOKIE = "socrates_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
const OAUTH_TTL_SECONDS = 600;
const OAUTH_SUCCESS_PATH = "/home";

interface ResetAccountRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  lang: Lang;
  disabled_at: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  password_hash: string | null;
  is_admin: number;
  disabled_at: string | null;
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/auth/providers", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.json({ providers: oauthProviders(c.env) });
    })
    .get("/me", (c) => c.json(c.get("user")))
    .post("/auth/login", rateLimit("login", 30), validateJson(LoginInputSchema), async (c) => {
      const input = c.req.valid("json");
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
    .post("/auth/register", rateLimit("register", 30), validateJson(RegisterInputSchema), async (c) => {
      const input = c.req.valid("json");
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
            sql: "INSERT INTO users (id, name, email, password_hash, lang, created_at) VALUES ($id, $name, $email, $hash, $lang, $at)",
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
      const user = { id, name: input.name, isAdmin: false };
      await ensureParticipant(c.env.DB, classroom.current_activity_id, user, at);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/signup", rateLimit("register", 30), validateJson(SignupInputSchema), async (c) => {
      const input = c.req.valid("json");
      if (!input.tosAccepted) fail(422, "tos_required");
      const hash = await hashPassword(input.password);
      const id = newId("u_");
      try {
        await batch(c.env.DB, [
          {
            sql: "INSERT INTO users (id, name, email, password_hash, lang, created_at) VALUES ($id, $name, $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, lang: langOf(c), at: nowIso() },
          },
        ]);
      } catch (error) {
        const pairs = uniqueViolationColumns(error);
        if (pairs.some(([table, column]) => table === "users" && column === "email")) fail(409, "email_taken");
        throw error;
      }
      const user: User = { id, name: input.name, isAdmin: false };
      await startSession(c, user);
      return c.json(user);
    })
    .get("/auth/oauth/:provider/start", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = c.req.param("provider");
      if (!isOAuthProvider(provider)) fail(404, "not_found");
      const runtime = providerRuntime(c, provider);
      if (!runtime) return oauthFailure(c, "oauth_unavailable");
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
      return c.redirect(await runtime.authorizeUrl(pending), 302);
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
      const runtime = providerRuntime(c, provider);
      if (!runtime) return oauthFailure(c, "oauth_unavailable");
      let profile: OAuthProfile;
      try {
        profile = await runtime.profile(code, pending);
      } catch (error) {
        if (error instanceof OAuthError) return oauthFailure(c, error.code);
        throw error;
      }
      const user = await userForIdentity(c, provider, profile);
      if (!user) return oauthFailure(c, "account_disabled");
      await startSession(c, user);
      return c.redirect(OAUTH_SUCCESS_PATH, 302);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      return c.body(null, 204);
    })
    .post(
      "/auth/password/forgot",
      rateLimit("password-forgot", 5),
      validateJson(PasswordForgotInputSchema),
      async (c) => {
        const input = c.req.valid("json");
        const row = await one<ResetAccountRow>(
          c.env.DB,
          "SELECT id, email, password_hash, lang, disabled_at FROM users WHERE email = $email",
          { email: input.email },
        );
        const account = row?.password_hash && row.email && row.disabled_at === null ? row : null;
        const token = await sealAccountToken(
          { env: c.env },
          "password_reset",
          account?.id ?? "",
          passwordResetBinding(account?.password_hash ?? DUMMY_HASH, account?.email ?? null),
          PASSWORD_RESET_TTL_MINUTES * 60_000,
        );
        if (account?.email) {
          const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(c.req.url).origin;
          const mail = { to: account.email, lang: account.lang, link: `${base}/reset-password#token=${token}` };
          c.executionCtx.waitUntil(
            sendPasswordResetEmail(c.env, { ...mail, minutes: PASSWORD_RESET_TTL_MINUTES }).catch((error: unknown) => {
              console.warn("[auth] password reset mail failed:", error instanceof Error ? error.message : typeof error);
            }),
          );
        }
        return c.body(null, 204);
      },
    )
    .post(
      "/auth/password/reset",
      rateLimit("password-reset", 10),
      validateJson(PasswordResetInputSchema),
      async (c) => {
        const input = c.req.valid("json");
        const claims = readAccountToken(input.token, "password_reset");
        const row = claims
          ? await one<ResetAccountRow>(
              c.env.DB,
              "SELECT id, email, password_hash, lang, disabled_at FROM users WHERE id = $id",
              { id: claims.uid },
            )
          : null;
        const valid =
          row?.password_hash &&
          row.email &&
          row.disabled_at === null &&
          (await verifyAccountToken(
            { env: c.env },
            "password_reset",
            input.token,
            passwordResetBinding(row.password_hash, row.email),
          ));
        if (!row?.password_hash || !row.email || !valid) fail(400, "reset_token_invalid");
        const result = await run(
          c.env.DB,
          `UPDATE users SET password_hash = $next, session_version = session_version + 1
         WHERE id = $id AND password_hash = $current AND email = $email`,
          { id: row.id, next: await hashPassword(input.password), current: row.password_hash, email: row.email },
        );
        if (!result.meta.changes) fail(400, "reset_token_invalid");
        return c.body(null, 204);
      },
    );
}

interface ProviderRuntime {
  authorizeUrl: (pending: OAuthPending) => Promise<string>;
  profile: (code: string, pending: OAuthPending) => Promise<OAuthProfile>;
}

function providerRuntime(c: Ctx, provider: OAuthProvider): ProviderRuntime | null {
  const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(c.req.url).origin;
  if (provider === "google") {
    const clientId = c.env.GOOGLE_CLIENT_ID;
    const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const config: GoogleConfig = { clientId, clientSecret, redirectUri: `${base}/api/auth/oauth/google/callback` };
    return {
      authorizeUrl: (pending) => googleAuthorizeUrl(config, pending),
      profile: (code, pending) => googleProfile(config, code, pending),
    };
  }
  const appId = c.env.FACEBOOK_APP_ID;
  const appSecret = c.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  const config: FacebookConfig = { appId, appSecret, redirectUri: `${base}/api/auth/oauth/facebook/callback` };
  return {
    authorizeUrl: (pending) => Promise.resolve(facebookAuthorizeUrl(config, pending)),
    profile: (code) => facebookProfile(config, code),
  };
}

function oauthFailure(c: Ctx, code: ErrorCode): Response {
  return c.redirect(`/login?error=${code}`, 302);
}

async function userForIdentity(c: Ctx, provider: OAuthProvider, profile: OAuthProfile): Promise<User | null> {
  const findSql =
    "SELECT u.id, u.name, u.is_admin, u.disabled_at FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $provider AND i.provider_user_id = $subject";
  const key = { provider, subject: profile.subject };
  const existing = await one<{ id: string; name: string; is_admin: number; disabled_at: string | null }>(
    c.env.DB,
    findSql,
    key,
  );
  if (existing) {
    if (existing.disabled_at !== null) return null;
    return toUser(existing);
  }
  const id = newId("u_");
  const at = nowIso();
  try {
    await batch(c.env.DB, [
      {
        sql: "INSERT INTO users (id, name, lang, created_at) VALUES ($id, $name, $lang, $at)",
        params: { id, name: profile.name, lang: langOf(c), at },
      },
      {
        sql: "INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES ($provider, $subject, $id, $email, $at)",
        params: { ...key, id, email: profile.email, at },
      },
    ]);
  } catch (error) {
    if (!uniqueViolationColumns(error).some(([table]) => table === "user_identities")) throw error;
    const raced = await one<{ id: string; name: string; is_admin: number; disabled_at: string | null }>(
      c.env.DB,
      findSql,
      key,
    );
    if (!raced || raced.disabled_at !== null) return null;
    return toUser(raced);
  }
  return { id, name: profile.name, isAdmin: false };
}
