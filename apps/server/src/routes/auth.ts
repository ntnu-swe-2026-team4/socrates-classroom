import { publishClassroom } from "../do/classroom-events";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  AVATAR_IMAGE_VERSION_PATTERN,
  EMAIL_VERIFY_TTL_HOURS,
  PASSWORD_RESET_TTL_MINUTES,
  AvatarTokenSchema,
  BindEmailInputSchema,
  EmailVerifyInputSchema,
  LoginInputSchema,
  OAuthStartInputSchema,
  PasswordForgotInputSchema,
  PasswordResetInputSchema,
  ProfileUpdateInputSchema,
  ReauthPasswordInputSchema,
  RegisterInputSchema,
  SignupInputSchema,
  type BindEmailResult,
  type ErrorCode,
  type IdentitySummary,
  type Lang,
  type OAuthStartResult,
  type Profile,
  type ReauthResult,
  type User,
} from "@socrates/shared";
import { all, batch, one, run } from "../db/d1";
import {
  DUMMY_HASH,
  accountState,
  emailVerifyBinding,
  endReauth,
  endSession,
  hashPassword,
  issueReauth,
  openPayload,
  passwordResetBinding,
  readAccountToken,
  readReauth,
  requireReauth,
  resumeSession,
  sealAccountToken,
  sealPayload,
  startReauth,
  startSession,
  toUser,
  verifyAccountToken,
  verifyPassword,
} from "../auth";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../mail";
import {
  allowIdentifier,
  clearIdentifierLimit,
  enforceIdentifierLimit,
  enforceIpLimit,
  fail,
  langOf,
  newId,
  nowIso,
  rateLimit,
  recordIdentifierHit,
  requireUser,
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
  readOAuthPending,
} from "../oauth";

const OAUTH_COOKIE = "socrates_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
const OAUTH_TTL_SECONDS = 600;
const OAUTH_SUCCESS_PATH = "/home";
const LOGIN_FAIL_SCOPE = "login-fail";
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
const FORGOT_EMAIL_SCOPE = "password-forgot-email";
const FORGOT_EMAIL_COOLDOWN_MS = 5 * 60_000;

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
  email_verified_at: string | null;
  password_hash: string | null;
  is_admin: number;
  disabled_at: string | null;
  has_identity: number;
}

interface VerifyAccount {
  id: string;
  email: string;
  lang: Lang;
}

interface ProfileRow {
  name: string;
  email: string | null;
  lang: Lang;
  avatar: string | null;
}

function profileOf(row: ProfileRow): Profile {
  return {
    name: row.name,
    email: row.email,
    lang: row.lang,
    avatar: AvatarTokenSchema.safeParse(row.avatar).success ? row.avatar : null,
  };
}

const AVATAR_MAX_BYTES = 64 * 1024;
const AVATAR_CACHE_CONTROL = "private, max-age=31536000, immutable";

const avatarKey = (userId: string, version: string) => `avatars/${userId}/${version}.jpg`;

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function avatarVersionOf(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function previousImageKey(userId: string, token: string | null): string | null {
  if (!token?.startsWith("image:")) return null;
  return avatarKey(userId, token.slice("image:".length));
}

function publicBase(c: Ctx): string {
  return c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(c.req.url).origin;
}

/** An unverified account older than the verification TTL never proved email
 * ownership, so the address is free to claim: re-registering overwrites the
 * credentials (and bumps session_version, killing the old sessions). */
function isStaleUnverified(row: { email_verified_at: string | null; created_at: string }): boolean {
  if (row.email_verified_at !== null) return false;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) && created <= Date.now() - EMAIL_VERIFY_TTL_HOURS * 3_600_000;
}

interface EmailClaimRow {
  id: string;
  email_verified_at: string | null;
  created_at: string;
}

async function takeoverStaleUnverified(
  db: Ctx["env"]["DB"],
  email: string,
  next: { name: string; hash: string; lang: Lang },
): Promise<string | null> {
  const row = await one<EmailClaimRow>(db, "SELECT id, email_verified_at, created_at FROM users WHERE email = $email", {
    email,
  });
  if (!row || !isStaleUnverified(row)) return null;
  const result = await run(
    db,
    `UPDATE users SET name = $name, password_hash = $hash, lang = $lang, created_at = $at, session_version = session_version + 1
     WHERE id = $id AND email_verified_at IS NULL`,
    { id: row.id, name: next.name, hash: next.hash, lang: next.lang, at: nowIso() },
  );
  return result.meta.changes ? row.id : null;
}

async function sendVerificationMail(c: Ctx, account: VerifyAccount): Promise<void> {
  const token = await sealAccountToken(
    { env: c.env },
    "email_verify",
    account.id,
    emailVerifyBinding(account.email),
    EMAIL_VERIFY_TTL_HOURS * 3_600_000,
  );
  await sendEmailVerificationEmail(c.env, {
    to: account.email,
    lang: account.lang,
    link: `${publicBase(c)}/verify-email#token=${token}`,
    hours: EMAIL_VERIFY_TTL_HOURS,
  });
}

function queueVerificationMail(c: Ctx, account: VerifyAccount): void {
  c.executionCtx.waitUntil(
    sendVerificationMail(c, account).catch((error: unknown) => {
      console.warn("[auth] email verification mail failed:", error instanceof Error ? error.message : typeof error);
    }),
  );
}

const DEFAULT_RETURN_TO = "/settings";

function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_RETURN_TO;
  return value;
}

function returnToUrl(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "https://socrates.invalid");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

type OAuthPendingDraft = Omit<OAuthPending, "state" | "verifier" | "nonce" | "exp">;

async function beginOAuth(c: Ctx, provider: OAuthProvider, draft: OAuthPendingDraft): Promise<string | null> {
  const runtime = providerRuntime(c, provider);
  if (!runtime) return null;
  const pending: OAuthPending = {
    ...draft,
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
  return runtime.authorizeUrl(pending);
}

async function identityPresence(c: Ctx, userId: string, method: string): Promise<boolean> {
  if (method === "email") {
    const row = await one<{ ok: number }>(
      c.env.DB,
      "SELECT 1 AS ok FROM users WHERE id = $id AND email IS NOT NULL AND password_hash IS NOT NULL",
      { id: userId },
    );
    return row !== null;
  }
  const row = await one<{ ok: number }>(
    c.env.DB,
    "SELECT 1 AS ok FROM user_identities WHERE user_id = $id AND provider = $provider",
    { id: userId, provider: method },
  );
  return row !== null;
}

async function failUnbind(c: Ctx, userId: string, method: string): Promise<never> {
  if (!(await identityPresence(c, userId, method))) fail(404, "identity_not_found");
  if (method !== "email") {
    const fallback = await one<{ ok: number }>(
      c.env.DB,
      "SELECT 1 AS ok FROM users WHERE id = $id AND email IS NOT NULL AND password_hash IS NOT NULL",
      { id: userId },
    );
    if (fallback) fail(409, "last_verified_method");
  }
  fail(409, "last_login_method");
}

export function authRoutes() {
  return new Hono<AppEnv>()
    .get("/auth/providers", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.json({ providers: oauthProviders(c.env) });
    })
    .get("/me", (c) => c.json(c.get("user")))
    .get("/me/profile", async (c) => {
      const user = requireUser(c);
      const row = await one<ProfileRow>(c.env.DB, "SELECT name, email, lang, avatar FROM users WHERE id = $id", {
        id: user.id,
      });
      if (!row) fail(404, "not_found");
      return c.json(profileOf(row));
    })
    .patch("/me", rateLimit("profile-update", 30), validateJson(ProfileUpdateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const sets: string[] = [];
      const params: Record<string, unknown> = { id: user.id };
      if (input.name !== undefined) {
        sets.push("name = $name");
        params.name = input.name;
      }
      if (input.lang !== undefined) {
        sets.push("lang = $lang");
        params.lang = input.lang;
      }
      if (input.avatar !== undefined) {
        sets.push("avatar = $avatar");
        params.avatar = input.avatar;
      }
      await run(c.env.DB, `UPDATE users SET ${sets.join(", ")} WHERE id = $id`, params);
      const row = await one<ProfileRow>(c.env.DB, "SELECT name, email, lang, avatar FROM users WHERE id = $id", {
        id: user.id,
      });
      if (!row) fail(404, "not_found");
      return c.json(profileOf(row));
    })
    .post("/me/avatar", rateLimit("avatar-upload", 20), async (c) => {
      const user = requireUser(c);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES || !isJpeg(bytes)) fail(422, "validation");
      const version = await avatarVersionOf(bytes);
      const key = avatarKey(user.id, version);
      if (!(await c.env.AVATARS.head(key))) {
        await c.env.AVATARS.put(key, bytes, {
          httpMetadata: { contentType: "image/jpeg", cacheControl: AVATAR_CACHE_CONTROL },
        });
      }
      const row = await one<ProfileRow>(c.env.DB, "SELECT name, email, lang, avatar FROM users WHERE id = $id", {
        id: user.id,
      });
      if (!row) fail(404, "not_found");
      const previous = previousImageKey(user.id, row.avatar);
      await run(c.env.DB, "UPDATE users SET avatar = $avatar WHERE id = $id", {
        id: user.id,
        avatar: `image:${version}`,
      });
      if (previous && previous !== key) await c.env.AVATARS.delete(previous);
      return c.json(profileOf({ ...row, avatar: `image:${version}` }));
    })
    .delete("/me/avatar", rateLimit("avatar-remove", 20), async (c) => {
      const user = requireUser(c);
      const row = await one<{ avatar: string | null }>(c.env.DB, "SELECT avatar FROM users WHERE id = $id", {
        id: user.id,
      });
      const previous = previousImageKey(user.id, row?.avatar ?? null);
      await run(c.env.DB, "UPDATE users SET avatar = NULL WHERE id = $id", { id: user.id });
      if (previous) await c.env.AVATARS.delete(previous);
      return c.body(null, 204);
    })
    .get("/avatars/:userId/:version", async (c) => {
      requireUser(c);
      const version = c.req.param("version");
      if (!new RegExp(`^${AVATAR_IMAGE_VERSION_PATTERN}$`).test(version)) fail(404, "not_found");
      const object = await c.env.AVATARS.get(avatarKey(c.req.param("userId"), version));
      if (!object) fail(404, "not_found");
      return new Response(object.body, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": AVATAR_CACHE_CONTROL,
          ETag: object.httpEtag,
        },
      });
    })
    .post("/auth/login", rateLimit("login", 30), validateJson(LoginInputSchema), async (c) => {
      const input = c.req.valid("json");
      await enforceIdentifierLimit(c, LOGIN_FAIL_SCOPE, input.email, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS);
      const row = await one<UserRow>(
        c.env.DB,
        `SELECT *, EXISTS(SELECT 1 FROM user_identities WHERE user_id = users.id) AS has_identity
         FROM users WHERE email = $email`,
        { email: input.email },
      );
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) {
        await recordIdentifierHit(c, LOGIN_FAIL_SCOPE, input.email, LOGIN_FAIL_WINDOW_MS);
        fail(401, "unauthorized");
      }
      if (row.disabled_at !== null) fail(403, "account_disabled");
      if (row.email_verified_at === null && row.has_identity === 1) fail(403, "email_unverified");
      await clearIdentifierLimit(c, LOGIN_FAIL_SCOPE, input.email);
      const user = toUser(row);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/register", rateLimit("register", 10), validateJson(RegisterInputSchema), async (c) => {
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
      const emailTaken = await one<EmailClaimRow>(
        c.env.DB,
        "SELECT id, email_verified_at, created_at FROM users WHERE email = $email",
        {
          email: input.email,
        },
      );
      const reclaiming = emailTaken !== null && isStaleUnverified(emailTaken);
      const clash = await one<{ id: string }>(
        c.env.DB,
        "SELECT user_id AS id FROM members WHERE classroom_id = $cid AND name = $name AND ($exclude IS NULL OR user_id != $exclude)",
        { cid: classroom.id, name: input.name, exclude: reclaiming ? emailTaken.id : null },
      );
      if (clash) fail(409, "name_taken");
      if (emailTaken && !reclaiming) fail(409, "conflict");
      const takenId = reclaiming
        ? await takeoverStaleUnverified(c.env.DB, input.email, { name: input.name, hash, lang: langOf(c) })
        : null;
      if (reclaiming && !takenId) fail(409, "conflict");
      const id = takenId ?? newId("u_");
      const at = nowIso();
      try {
        const statements: Array<{ sql: string; params: Record<string, unknown> }> = [];
        if (!takenId) {
          statements.push({
            sql: "INSERT INTO users (id, name, email, password_hash, lang, created_at) VALUES ($id, $name, $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, at, lang: langOf(c) },
          });
        }
        statements.push({
          sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
          params: { cid: classroom.id, uid: id, name: input.name, at },
        });
        await batch(c.env.DB, statements);
      } catch (error) {
        const pairs = uniqueViolationColumns(error);
        if (pairs.length === 0) throw error;
        if (takenId && pairs.some(([table]) => table === "members")) {
          await run(
            c.env.DB,
            "UPDATE members SET name = $name, tos_accepted_at = $at WHERE classroom_id = $cid AND user_id = $uid",
            { cid: classroom.id, uid: id, name: input.name, at },
          );
        } else if (pairs.some(([table, column]) => table === "members" && column === "name")) {
          fail(409, "name_taken");
        } else {
          fail(409, "conflict");
        }
      }
      await publishClassroom(c.env, classroom.id, "members");
      queueVerificationMail(c, { id, email: input.email, lang: langOf(c) });
      const user: User = { id, name: input.name, isAdmin: false, emailVerified: false };
      await ensureParticipant(c.env.DB, classroom.current_activity_id, user, at);
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/signup", rateLimit("register", 10), validateJson(SignupInputSchema), async (c) => {
      const input = c.req.valid("json");
      if (!input.tosAccepted) fail(422, "tos_required");
      const hash = await hashPassword(input.password);
      let id = newId("u_");
      try {
        await batch(c.env.DB, [
          {
            sql: "INSERT INTO users (id, name, email, password_hash, lang, created_at) VALUES ($id, $name, $email, $hash, $lang, $at)",
            params: { id, name: input.name, email: input.email, hash, lang: langOf(c), at: nowIso() },
          },
        ]);
      } catch (error) {
        if (!uniqueViolationColumns(error).some(([table, column]) => table === "users" && column === "email"))
          throw error;
        const takenId = await takeoverStaleUnverified(c.env.DB, input.email, {
          name: input.name,
          hash,
          lang: langOf(c),
        });
        if (!takenId) fail(409, "email_taken");
        id = takenId;
      }
      const user: User = { id, name: input.name, isAdmin: false, emailVerified: false };
      queueVerificationMail(c, { id, email: input.email, lang: langOf(c) });
      await startSession(c, user);
      return c.json(user);
    })
    .post("/auth/email/verify", rateLimit("email-verify", 30), validateJson(EmailVerifyInputSchema), async (c) => {
      const input = c.req.valid("json");
      const claims = readAccountToken(input.token, "email_verify");
      const row = claims
        ? await one<{ id: string; email: string | null; email_verified_at: string | null; disabled_at: string | null }>(
            c.env.DB,
            "SELECT id, email, email_verified_at, disabled_at FROM users WHERE id = $id",
            { id: claims.uid },
          )
        : null;
      if (!row || row.email === null || row.disabled_at !== null) fail(400, "verify_token_invalid");
      if (!(await verifyAccountToken({ env: c.env }, "email_verify", input.token, emailVerifyBinding(row.email)))) {
        fail(400, "verify_token_invalid");
      }
      if (row.email_verified_at === null) {
        await run(
          c.env.DB,
          "UPDATE users SET email_verified_at = $at WHERE id = $id AND email = $email AND email_verified_at IS NULL",
          { id: row.id, email: row.email, at: nowIso() },
        );
      }
      return c.body(null, 204);
    })
    .post("/auth/email/verify/resend", rateLimit("email-verify-resend", 5), async (c) => {
      const user = requireUser(c);
      const row = await one<{ email: string | null; lang: Lang; email_verified_at: string | null }>(
        c.env.DB,
        "SELECT email, lang, email_verified_at FROM users WHERE id = $id",
        { id: user.id },
      );
      if (!row?.email) fail(409, "email_not_set");
      if (row.email_verified_at === null) {
        queueVerificationMail(c, { id: user.id, email: row.email, lang: row.lang });
      }
      return c.body(null, 204);
    })
    .get("/auth/oauth/:provider/start", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = c.req.param("provider");
      if (!isOAuthProvider(provider)) fail(404, "not_found");
      const url = await beginOAuth(c, provider, { provider, intent: "login" });
      if (!url) return oauthFailure(c, "oauth_unavailable");
      return c.redirect(url, 302);
    })
    .get("/auth/oauth/:provider/callback", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = c.req.param("provider");
      if (!isOAuthProvider(provider)) fail(404, "not_found");
      const pending = readOAuthPending(await openPayload({ env: c.env }, getCookie(c, OAUTH_COOKIE)));
      deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH, secure: true });
      const returnTo = pending && pending.intent !== "login" ? safeReturnTo(pending.returnTo) : undefined;
      const failed = (code: ErrorCode) => oauthFailure(c, code, returnTo);
      const state = c.req.query("state");
      const code = c.req.query("code");
      if (!pending || pending.provider !== provider || pending.exp < Date.now() || !state || state !== pending.state) {
        return failed("oauth_state_invalid");
      }
      if (c.req.query("error") || !code) return failed("oauth_failed");
      const runtime = providerRuntime(c, provider);
      if (!runtime) return failed("oauth_unavailable");
      let profile: OAuthProfile;
      try {
        profile = await runtime.profile(code, pending);
      } catch (error) {
        if (error instanceof OAuthError) return failed(error.code);
        throw error;
      }
      if (pending.intent === "login") {
        const user = await userForIdentity(c, provider, profile);
        if (!user) return failed("account_disabled");
        await startSession(c, user);
        return c.redirect(OAUTH_SUCCESS_PATH, 302);
      }
      const sessionUser = c.get("user");
      const version = c.get("sessionVersion");
      if (!sessionUser || version === null || sessionUser.id !== pending.uid || version !== pending.ver) {
        return failed("reauth_identity_mismatch");
      }
      const bound = await one<{ user_id: string }>(
        c.env.DB,
        "SELECT user_id FROM user_identities WHERE provider = $provider AND provider_user_id = $subject",
        { provider, subject: profile.subject },
      );
      if (pending.intent === "reauth") {
        if (bound?.user_id !== sessionUser.id) return failed("reauth_identity_mismatch");
        await startReauth(c, sessionUser.id, version);
        return c.redirect(returnToUrl(safeReturnTo(returnTo), { reauth: "ok" }), 302);
      }
      if (bound && bound.user_id !== sessionUser.id) return failed("identity_taken");
      if (!bound) {
        const inserted = await run(
          c.env.DB,
          `INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at)
           SELECT $provider, $subject, $uid, $email, $at
           WHERE NOT EXISTS (SELECT 1 FROM user_identities WHERE user_id = $uid AND provider = $provider)`,
          { provider, subject: profile.subject, uid: sessionUser.id, email: profile.email, at: nowIso() },
        ).catch((error: unknown) => {
          if (uniqueViolationColumns(error).some(([table]) => table === "user_identities")) return null;
          throw error;
        });
        if (inserted === null) return failed("identity_taken");
        if (!inserted.meta.changes) return failed("provider_already_linked");
      }
      return c.redirect(returnToUrl(safeReturnTo(returnTo), { linked: provider }), 302);
    })
    .post("/auth/logout", (c) => {
      endSession(c);
      endReauth(c);
      return c.body(null, 204);
    })
    .post("/auth/reauth/password", rateLimit("reauth", 10), validateJson(ReauthPasswordInputSchema), async (c) => {
      const user = requireUser(c);
      const version = c.get("sessionVersion");
      if (version === null) fail(401, "unauthorized");
      const row = await one<{ password_hash: string | null }>(
        c.env.DB,
        "SELECT password_hash FROM users WHERE id = $id",
        { id: user.id },
      );
      if (!row?.password_hash) fail(409, "password_not_set");
      if (!(await verifyPassword(c.req.valid("json").password, row.password_hash))) fail(401, "invalid_credentials");
      const expiresAt = await startReauth(c, user.id, version);
      return c.json({ expiresAt: new Date(expiresAt).toISOString() } satisfies ReauthResult);
    })
    .post(
      "/auth/reauth/oauth/:provider/start",
      rateLimit("oauth", 30),
      validateJson(OAuthStartInputSchema),
      async (c) => {
        const user = requireUser(c);
        const version = c.get("sessionVersion");
        if (version === null) fail(401, "unauthorized");
        const provider = c.req.param("provider");
        if (!isOAuthProvider(provider)) fail(404, "not_found");
        const bound = await one<{ email: string | null }>(
          c.env.DB,
          "SELECT email FROM user_identities WHERE user_id = $id AND provider = $provider",
          { id: user.id, provider },
        );
        if (!bound) fail(404, "identity_not_found");
        const returnTo = safeReturnTo(c.req.valid("json").returnTo);
        const url = await beginOAuth(c, provider, {
          provider,
          intent: "reauth",
          uid: user.id,
          ver: version,
          returnTo,
          hint: bound.email ?? undefined,
        });
        if (!url) fail(409, "oauth_unavailable");
        return c.json({ url } satisfies OAuthStartResult);
      },
    )
    .get("/me/identities", async (c) => {
      const user = requireUser(c);
      const version = c.get("sessionVersion");
      const row = await one<{ email: string | null; email_verified_at: string | null }>(
        c.env.DB,
        "SELECT email, email_verified_at FROM users WHERE id = $id",
        { id: user.id },
      );
      const linked = await all<{ provider: string; email: string | null; created_at: string }>(
        c.env.DB,
        "SELECT provider, email, created_at FROM user_identities WHERE user_id = $id ORDER BY created_at",
        { id: user.id },
      );
      const reauth = await readReauth(c);
      const active = reauth && version !== null && reauth.uid === user.id && reauth.ver === version;
      return c.json({
        email: row?.email ? { email: row.email, verified: row.email_verified_at !== null } : null,
        oauth: linked.flatMap((identity) =>
          isOAuthProvider(identity.provider)
            ? [{ provider: identity.provider, email: identity.email, linkedAt: identity.created_at }]
            : [],
        ),
        reauthExpiresAt: active ? new Date(reauth.exp).toISOString() : null,
      } satisfies IdentitySummary);
    })
    .post(
      "/me/identities/oauth/:provider/start",
      rateLimit("oauth", 30),
      validateJson(OAuthStartInputSchema),
      async (c) => {
        const user = requireUser(c);
        const { version } = await requireReauth(c);
        const provider = c.req.param("provider");
        if (!isOAuthProvider(provider)) fail(404, "not_found");
        if (await identityPresence(c, user.id, provider)) fail(409, "provider_already_linked");
        const returnTo = safeReturnTo(c.req.valid("json").returnTo);
        const url = await beginOAuth(c, provider, { provider, intent: "bind", uid: user.id, ver: version, returnTo });
        if (!url) fail(409, "oauth_unavailable");
        return c.json({ url } satisfies OAuthStartResult);
      },
    )
    .post("/me/identities/email", rateLimit("identity-bind", 10), validateJson(BindEmailInputSchema), async (c) => {
      const user = requireUser(c);
      await requireReauth(c);
      const input = c.req.valid("json");
      const row = await one<{ email: string | null; password_hash: string | null; lang: Lang }>(
        c.env.DB,
        "SELECT email, password_hash, lang FROM users WHERE id = $id",
        { id: user.id },
      );
      if (!row) fail(404, "not_found");
      if (row.email !== null || row.password_hash !== null) fail(409, "email_already_linked");
      const hash = await hashPassword(input.password);
      const updated = await run(
        c.env.DB,
        `UPDATE users SET email = $email, password_hash = $hash, email_verified_at = NULL
         WHERE id = $id AND email IS NULL AND password_hash IS NULL`,
        { id: user.id, email: input.email, hash },
      ).catch((error: unknown) => {
        if (uniqueViolationColumns(error).some(([table, column]) => table === "users" && column === "email")) {
          fail(409, "email_taken");
        }
        throw error;
      });
      if (!updated.meta.changes) fail(409, "email_already_linked");
      queueVerificationMail(c, { id: user.id, email: input.email, lang: row.lang });
      return c.json({ email: input.email, verified: false } satisfies BindEmailResult);
    })
    .delete("/me/identities/:method", rateLimit("identity-unbind", 10), async (c) => {
      const user = requireUser(c);
      const { exp } = await requireReauth(c);
      const method = c.req.param("method");
      if (method === "email") {
        const updated = await run(
          c.env.DB,
          `UPDATE users
           SET email = NULL, password_hash = NULL, email_verified_at = NULL, session_version = session_version + 1
           WHERE id = $id
             AND email IS NOT NULL AND password_hash IS NOT NULL
             AND EXISTS (SELECT 1 FROM user_identities WHERE user_id = $id)`,
          { id: user.id },
        );
        if (!updated.meta.changes) await failUnbind(c, user.id, method);
      } else if (isOAuthProvider(method)) {
        const removed = await run(
          c.env.DB,
          `DELETE FROM user_identities
           WHERE user_id = $id AND provider = $provider
             AND (EXISTS (SELECT 1 FROM users
                          WHERE id = $id AND email IS NOT NULL AND password_hash IS NOT NULL
                            AND email_verified_at IS NOT NULL)
                  OR (SELECT COUNT(*) FROM user_identities WHERE user_id = $id) > 1)`,
          { id: user.id, provider: method },
        );
        if (!removed.meta.changes) await failUnbind(c, user.id, method);
        await run(c.env.DB, "UPDATE users SET session_version = session_version + 1 WHERE id = $id", { id: user.id });
      } else {
        fail(404, "not_found");
      }
      const state = await accountState(c.env.DB, user.id);
      const version = state?.version ?? 0;
      await resumeSession(c, user, version);
      await issueReauth(c, user.id, version, exp);
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
          const allowed = await allowIdentifier(c, FORGOT_EMAIL_SCOPE, account.email, 1, FORGOT_EMAIL_COOLDOWN_MS);
          if (allowed) {
            const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(c.req.url).origin;
            const mail = { to: account.email, lang: account.lang, link: `${base}/reset-password#token=${token}` };
            c.executionCtx.waitUntil(
              sendPasswordResetEmail(c.env, { ...mail, minutes: PASSWORD_RESET_TTL_MINUTES }).catch(
                (error: unknown) => {
                  console.warn(
                    "[auth] password reset mail failed:",
                    error instanceof Error ? error.message : typeof error,
                  );
                },
              ),
            );
          }
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
        await clearIdentifierLimit(c, LOGIN_FAIL_SCOPE, row.email);
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

function oauthFailure(c: Ctx, code: ErrorCode, returnTo?: string): Response {
  if (returnTo === undefined) return c.redirect(`/login?error=${code}`, 302);
  return c.redirect(returnToUrl(returnTo, { error: code }), 302);
}

async function userForIdentity(c: Ctx, provider: OAuthProvider, profile: OAuthProfile): Promise<User | null> {
  const findSql =
    "SELECT u.id, u.name, u.email, u.email_verified_at, u.is_admin, u.disabled_at FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $provider AND i.provider_user_id = $subject";
  const key = { provider, subject: profile.subject };
  const existing = await one<OAuthUserRow>(c.env.DB, findSql, key);
  if (existing) {
    if (existing.disabled_at !== null) return null;
    return toUser({ ...existing, has_identity: 1 });
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
    const raced = await one<OAuthUserRow>(c.env.DB, findSql, key);
    if (!raced || raced.disabled_at !== null) return null;
    return toUser({ ...raced, has_identity: 1 });
  }
  return { id, name: profile.name, isAdmin: false, emailVerified: true };
}

interface OAuthUserRow {
  id: string;
  name: string;
  email: string | null;
  email_verified_at: string | null;
  is_admin: number;
  disabled_at: string | null;
}
