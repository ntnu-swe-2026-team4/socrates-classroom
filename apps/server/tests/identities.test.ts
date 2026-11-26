import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, inject, test, vi } from "vitest";
import { seedFixture } from "../src/seed";
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, resetGoogleKeyCache } from "../src/oauth";
import { call, cookieOf, field, must, rows, str, verifyUserEmail } from "./helpers";
import { run } from "../src/db/d1";

const migrations = inject("d1Migrations");
const CLIENT_ID = "test-google-client-id";
const json = { "Content-Type": "application/json" };

let signingKey: CryptoKeyPair;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function isCryptoKeyPair(pair: object): pair is CryptoKeyPair {
  return "privateKey" in pair && "publicKey" in pair;
}

async function rsaPair(): Promise<CryptoKeyPair> {
  const pair: unknown = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (pair instanceof CryptoKey || typeof pair !== "object" || pair === null || !isCryptoKeyPair(pair)) {
    throw new Error("RSASSA-PKCS1-v1_5 did not produce a key pair");
  }
  return pair;
}

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const head = encodeJson({ alg: "RS256", kid: "kid-1", typ: "JWT" });
  const body = encodeJson(claims);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function cookieNamed(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .find((pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1);
}

function validClaims(sub: string) {
  return (nonce: string) => ({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub,
    email: `${sub}@gmail.com`,
    email_verified: true,
    name: `Google ${sub}`,
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

async function mockGoogle(nonce: string, sub: string): Promise<void> {
  const token = await idToken(validClaims(sub)(nonce));
  const publicJwk = await crypto.subtle.exportKey("jwk", signingKey.publicKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (href === GOOGLE_TOKEN_URL) return Response.json({ id_token: token, access_token: "x" });
    if (href === GOOGLE_JWKS_URL) {
      return Response.json(
        { keys: [{ ...publicJwk, kid: "kid-1", alg: "RS256", use: "sig" }] },
        { headers: { "Cache-Control": "max-age=60" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  });
}

interface OAuthStart {
  cookie: string;
  state: string;
  url: URL;
}

function readStart(res: Response, body: unknown): OAuthStart {
  const url = new URL(str(body, "url"));
  return {
    cookie: must(cookieNamed(res, "socrates_oauth"), "socrates_oauth cookie"),
    state: must(url.searchParams.get("state"), "oauth state"),
    url,
  };
}

async function loginWithGoogle(sub: string): Promise<{ id: string; session: string }> {
  const started = await call("/api/auth/oauth/google/start", { redirect: "manual" });
  const url = new URL(must(started.headers.get("Location"), "location"));
  const oauth = must(cookieNamed(started, "socrates_oauth"), "socrates_oauth cookie");
  await mockGoogle(must(url.searchParams.get("nonce"), "nonce"), sub);
  const res = await call(
    `/api/auth/oauth/google/callback?state=${encodeURIComponent(must(url.searchParams.get("state"), "state"))}&code=auth-code`,
    { headers: { Cookie: oauth }, redirect: "manual" },
  );
  vi.restoreAllMocks();
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/home");
  const session = must(cookieNamed(res, "socrates_session"), "socrates_session cookie");
  return { id: str(await (await call("/api/me", { headers: { Cookie: session } })).json(), "id"), session };
}

async function signup(email: string): Promise<{ id: string; session: string }> {
  const res = await call("/api/auth/signup", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: "password-1", name: email.split("@")[0], tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const id = str(await res.json(), "id");
  await verifyUserEmail(id);
  return { id, session: cookieOf(res) };
}

async function reauthWithPassword(session: string, password = "password-1"): Promise<Response> {
  return call("/api/auth/reauth/password", {
    method: "POST",
    headers: { ...json, Cookie: session },
    body: JSON.stringify({ password }),
  });
}

function withReauth(session: string, reauth: Response): string {
  return `${session}; ${must(cookieNamed(reauth, "socrates_reauth"), "socrates_reauth cookie")}`;
}

async function reauthed(session: string, password = "password-1"): Promise<string> {
  return withReauth(session, await reauthWithPassword(session, password));
}

async function startBind(cookies: string, body: unknown = {}): Promise<Response> {
  return call("/api/me/identities/oauth/google/start", {
    method: "POST",
    headers: { ...json, Cookie: cookies },
    body: JSON.stringify(body),
  });
}

async function reauthWithGoogle(session: string, sub: string): Promise<string> {
  const start = await call("/api/auth/reauth/oauth/google/start", {
    method: "POST",
    headers: { ...json, Cookie: session },
    body: "{}",
  });
  expect(start.status).toBe(200);
  const started = readStart(start, await start.json());
  await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), sub);
  const res = await finishGoogle(started, session);
  vi.restoreAllMocks();
  expect(res.headers.get("Location")).toBe("/settings?reauth=ok");
  return `${session}; ${must(cookieNamed(res, "socrates_reauth"), "reauth cookie")}`;
}

async function finishGoogle(oauth: OAuthStart, session: string): Promise<Response> {
  return call(`/api/auth/oauth/google/callback?state=${encodeURIComponent(oauth.state)}&code=auth-code`, {
    headers: { Cookie: `${oauth.cookie}; ${session}` },
    redirect: "manual",
  });
}

async function identities(cookie: string): Promise<Response> {
  return call("/api/me/identities", { headers: { Cookie: cookie } });
}

async function unbind(cookies: string, method: string): Promise<Response> {
  return call(`/api/me/identities/${method}`, { method: "DELETE", headers: { Cookie: cookies } });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  signingKey = await rsaPair();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGoogleKeyCache();
});

describe("verified-method gate alignment (#138 × #437)", () => {
  async function googleWithUnverifiedEmail(sub: string, email: string, password: string) {
    const user = await loginWithGoogle(sub);
    const bind = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthWithGoogle(user.session, sub) },
      body: JSON.stringify({ email, password }),
    });
    expect(bind.status).toBe(200);
    return user;
  }

  test("an unverified bound email does not gate an account that keeps a verified SSO method", async () => {
    const user = await googleWithUnverifiedEmail("id-gate-aligned", "gate-aligned@example.com", "aligned-pass-1");
    const res = await call("/api/classrooms", { headers: { Cookie: user.session } });
    expect(res.status).toBe(200);
    const me = await call("/api/me", { headers: { Cookie: user.session } });
    expect(field(await me.json(), "emailVerified")).toBe(true);
  });

  test("unverified email + password cannot sign in while the account has another entry", async () => {
    const user = await googleWithUnverifiedEmail("id-login-method", "login-method@example.com", "aligned-pass-2");
    const blocked = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "login-method@example.com", password: "aligned-pass-2" }),
    });
    expect(blocked.status).toBe(403);
    expect(str(await blocked.json(), "code")).toBe("email_unverified");
    expect(cookieNamed(blocked, "socrates_session")).toBeUndefined();

    const sso = await loginWithGoogle("id-login-method");
    expect(sso.id).toBe(user.id);

    await verifyUserEmail(user.id);
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "login-method@example.com", password: "aligned-pass-2" }),
    });
    expect(login.status).toBe(200);
    expect(str(await login.json(), "id")).toBe(user.id);
  });

  test("the last verified method cannot be unbound while the email stays unverified", async () => {
    const user = await googleWithUnverifiedEmail("id-last-verified", "last-verified@example.com", "aligned-pass-3");
    const cookies = await reauthed(user.session, "aligned-pass-3");
    const blocked = await unbind(cookies, "google");
    expect(blocked.status).toBe(409);
    expect(str(await blocked.json(), "code")).toBe("last_verified_method");

    const emailRemoved = await unbind(cookies, "email");
    expect(emailRemoved.status).toBe(204);
    const googleKept = await call("/api/classrooms", { headers: { Cookie: cookieOf(emailRemoved) } });
    expect(googleKept.status).toBe(200);

    const rebound = await googleWithUnverifiedEmail("id-last-verified", "last-verified@example.com", "aligned-pass-3");
    expect(rebound.id).toBe(user.id);
    await verifyUserEmail(user.id);
    const allowed = await unbind(await reauthed(rebound.session, "aligned-pass-3"), "google");
    expect(allowed.status).toBe(204);
  });
});

describe("login method overview (#138)", () => {
  test("requires a session", async () => {
    expect((await identities("socrates_session=")).status).toBe(401);
  });

  test("email account lists its email method and no reauth window", async () => {
    const user = await signup("overview@example.com");
    const res = await identities(user.session);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(field(field(body, "email"), "email")).toBe("overview@example.com");
    expect(field(field(body, "email"), "verified")).toBe(true);
    expect(rows(field(body, "oauth"))).toEqual([]);
    expect(field(body, "reauthExpiresAt")).toBeNull();
  });

  test("SSO account has no email method and lists its linked provider", async () => {
    const user = await loginWithGoogle("id-overview");
    const body = await (await identities(user.session)).json();
    expect(field(body, "email")).toBeNull();
    const [identity] = rows(field(body, "oauth"));
    expect(field(identity, "provider")).toBe("google");
    expect(typeof field(identity, "linkedAt")).toBe("string");
  });
});

describe("re-auth (#138 D2)", () => {
  test("wrong password → 401 invalid_credentials, no reauth cookie", async () => {
    const user = await signup("reauth-bad@example.com");
    const res = await reauthWithPassword(user.session, "not-my-password");
    expect(res.status).toBe(401);
    expect(str(await res.json(), "code")).toBe("invalid_credentials");
    expect(cookieNamed(res, "socrates_reauth")).toBeUndefined();
  });

  test("correct password → short-lived reauth cookie reflected by the overview", async () => {
    const user = await signup("reauth-ok@example.com");
    const res = await reauthWithPassword(user.session);
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((line) => line.startsWith("socrates_reauth="));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/api");
    expect(setCookie).toContain("Max-Age=600");
    const expiresAt = str(await res.json(), "expiresAt");
    expect(Number.isNaN(Date.parse(expiresAt))).toBe(false);

    const body = await (await identities(withReauth(user.session, res))).json();
    expect(field(body, "reauthExpiresAt")).toBe(expiresAt);
  });

  test("passwordless account → 409 password_not_set", async () => {
    const user = await loginWithGoogle("id-passwordless");
    const res = await reauthWithPassword(user.session);
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("password_not_set");
  });

  test("logout clears the reauth cookie", async () => {
    const user = await signup("reauth-logout@example.com");
    const cookies = await reauthed(user.session);
    const res = await call("/api/auth/logout", { method: "POST", headers: { Cookie: cookies } });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie().find((line) => line.startsWith("socrates_reauth="));
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("re-auth gate (#138 驗收：沒通過身分再驗證時一律拒絕)", () => {
  test("bind email without reauth → 403 reauth_required", async () => {
    const user = await signup("gate-email@example.com");
    const res = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: user.session },
      body: JSON.stringify({ email: "gate-new@example.com", password: "password-2" }),
    });
    expect(res.status).toBe(403);
    expect(str(await res.json(), "code")).toBe("reauth_required");
  });

  test("bind SSO and unbind without reauth → 403 reauth_required", async () => {
    const user = await loginWithGoogle("id-gate");
    const bind = await startBind(user.session);
    expect(bind.status).toBe(403);
    expect(str(await bind.json(), "code")).toBe("reauth_required");

    const remove = await unbind(user.session, "google");
    expect(remove.status).toBe(403);
    expect(str(await remove.json(), "code")).toBe("reauth_required");
  });

  test("reauth built on an older session version is rejected after a bump", async () => {
    const user = await signup("gate-stale@example.com");
    const reauth = await reauthWithPassword(user.session);
    expect((await unbind(withReauth(user.session, reauth), "email")).status).toBe(409);

    await run(env.DB, "UPDATE users SET session_version = session_version + 1 WHERE id = $id", { id: user.id });
    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "gate-stale@example.com", password: "password-1" }),
    });
    expect(login.status).toBe(200);
    const stale = await call("/api/me/identities/email", {
      method: "POST",
      headers: {
        ...json,
        Cookie: `${cookieOf(login)}; ${must(cookieNamed(reauth, "socrates_reauth"), "reauth cookie")}`,
      },
      body: JSON.stringify({ email: "gate-stale-new@example.com", password: "password-2" }),
    });
    expect(stale.status).toBe(403);
    expect(str(await stale.json(), "code")).toBe("reauth_required");
  });
});

describe("SSO re-auth (#138 D3)", () => {
  test("Google reauth uses max_age=0 and login_hint; bound identity required", async () => {
    const user = await signup("reauth-google@example.com");
    await run(
      env.DB,
      "INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES ('google', 'id-reauth-google', $uid, $email, $at)",
      { uid: user.id, email: "reauth-google@gmail.com", at: new Date().toISOString() },
    );
    const cookies = await reauthed(user.session);
    const res = await call("/api/auth/reauth/oauth/google/start", {
      method: "POST",
      headers: { ...json, Cookie: cookies },
      body: JSON.stringify({ returnTo: "/settings" }),
    });
    expect(res.status).toBe(200);
    const started = readStart(res, await res.json());
    expect(started.url.searchParams.get("max_age")).toBe("0");
    expect(started.url.searchParams.get("prompt")).toBe("select_account");
    expect(started.url.searchParams.get("login_hint")).toBe("reauth-google@gmail.com");
  });

  test("Facebook reauth uses auth_type=reauthenticate", async () => {
    const user = await signup("reauth-facebook@example.com");
    await run(
      env.DB,
      "INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES ('facebook', 'fb-reauth', $uid, NULL, $at)",
      { uid: user.id, at: new Date().toISOString() },
    );
    const cookies = await reauthed(user.session);
    const res = await call("/api/auth/reauth/oauth/facebook/start", {
      method: "POST",
      headers: { ...json, Cookie: cookies },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const started = readStart(res, await res.json());
    expect(started.url.searchParams.get("auth_type")).toBe("reauthenticate");
  });

  test("unbound provider → 404 identity_not_found", async () => {
    const user = await signup("reauth-unbound@example.com");
    const res = await call("/api/auth/reauth/oauth/google/start", {
      method: "POST",
      headers: { ...json, Cookie: await reauthed(user.session) },
      body: "{}",
    });
    expect(res.status).toBe(404);
    expect(str(await res.json(), "code")).toBe("identity_not_found");
  });

  test("callback grants the sudo window and returns to the origin page", async () => {
    const user = await loginWithGoogle("id-reauth-flow");
    const start = await call("/api/auth/reauth/oauth/google/start", {
      method: "POST",
      headers: { ...json, Cookie: user.session },
      body: JSON.stringify({ returnTo: "/settings?section=dialogue" }),
    });
    expect(start.status).toBe(200);
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-reauth-flow");
    const res = await finishGoogle(started, user.session);
    vi.restoreAllMocks();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/settings?section=dialogue&reauth=ok");
    expect(cookieNamed(res, "socrates_reauth")).toBeDefined();
  });

  test("callback for an identity bound to someone else → reauth_identity_mismatch", async () => {
    const owner = await loginWithGoogle("id-reauth-owner");
    const intruder = await loginWithGoogle("id-reauth-intruder");
    const start = await call("/api/auth/reauth/oauth/google/start", {
      method: "POST",
      headers: { ...json, Cookie: owner.session },
      body: "{}",
    });
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-reauth-intruder");
    const res = await finishGoogle(started, intruder.session);
    vi.restoreAllMocks();
    expect(res.headers.get("Location")).toBe("/settings?error=reauth_identity_mismatch");
    expect(cookieNamed(res, "socrates_reauth")).toBeUndefined();
  });
});

describe("bind email (#138 D6)", () => {
  test("SSO account adds email + password, then both sign-in paths reach the same account", async () => {
    const user = await loginWithGoogle("id-bind-email");
    const res = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthWithGoogle(user.session, "id-bind-email") },
      body: JSON.stringify({ email: "Bound.User@Example.com", password: "bound-pass-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(str(body, "email")).toBe("bound.user@example.com");
    expect(field(body, "verified")).toBe(false);
    await verifyUserEmail(user.id);

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "bound.user@example.com", password: "bound-pass-1" }),
    });
    expect(login.status).toBe(200);
    expect(str(await login.json(), "id")).toBe(user.id);

    const overview = await (await identities(await reauthed(user.session, "bound-pass-1"))).json();
    expect(field(field(overview, "email"), "email")).toBe("bound.user@example.com");
  });
  test("already having an email → 409 email_already_linked", async () => {
    const user = await signup("bind-again@example.com");
    const res = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthed(user.session) },
      body: JSON.stringify({ email: "bind-again-2@example.com", password: "password-2" }),
    });
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("email_already_linked");
  });

  test("email owned by another account → 409 email_taken", async () => {
    const existing = await signup("bind-taken@example.com");
    expect(existing.id).toBeTruthy();
    const user = await loginWithGoogle("id-bind-taken");
    const res = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthWithGoogle(user.session, "id-bind-taken") },
      body: JSON.stringify({ email: "bind-taken@example.com", password: "password-2" }),
    });
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("email_taken");
  });
});

describe("bind SSO provider (#138)", () => {
  test("email account links Google, then both sign-in paths reach the same account", async () => {
    const user = await signup("bind-google@example.com");
    const start = await startBind(await reauthed(user.session), { returnTo: "/settings" });
    expect(start.status).toBe(200);
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-bind-google");
    const res = await finishGoogle(started, user.session);
    vi.restoreAllMocks();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/settings?linked=google");

    const google = await loginWithGoogle("id-bind-google");
    expect(google.id).toBe(user.id);
  });

  test("provider already linked → 409 provider_already_linked", async () => {
    const user = await loginWithGoogle("id-bind-twice");
    const res = await startBind(await reauthWithGoogle(user.session, "id-bind-twice"));
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("provider_already_linked");
  });

  test("identity bound to another account → callback redirects with identity_taken", async () => {
    const owner = await loginWithGoogle("id-bind-owner");
    const other = await signup("bind-other@example.com");
    const start = await startBind(await reauthed(other.session));
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-bind-owner");
    const res = await finishGoogle(started, other.session);
    vi.restoreAllMocks();
    expect(res.headers.get("Location")).toBe("/settings?error=identity_taken");
    expect(owner.id).not.toBe(other.id);
  });

  test("callback under a different session → reauth_identity_mismatch", async () => {
    const starter = await signup("bind-mismatch-a@example.com");
    const other = await signup("bind-mismatch-b@example.com");
    const start = await startBind(await reauthed(starter.session));
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-bind-mismatch");
    const res = await finishGoogle(started, other.session);
    vi.restoreAllMocks();
    expect(res.headers.get("Location")).toBe("/settings?error=reauth_identity_mismatch");
    const overview = await (await identities(other.session)).json();
    expect(rows(field(overview, "oauth"))).toEqual([]);
  });

  test("returnTo outside the origin falls back to /settings", async () => {
    const user = await signup("bind-returnto@example.com");
    const start = await startBind(await reauthed(user.session), { returnTo: "https://evil.example/phish" });
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-bind-returnto");
    const res = await finishGoogle(started, user.session);
    vi.restoreAllMocks();
    expect(res.headers.get("Location")).toBe("/settings?linked=google");
  });
});

describe("unbind (#138 D5/D7)", () => {
  test("last login method cannot be removed", async () => {
    const ssoOnly = await loginWithGoogle("id-unbind-last-sso");
    const ssoRes = await unbind(await reauthWithGoogle(ssoOnly.session, "id-unbind-last-sso"), "google");
    expect(ssoRes.status).toBe(409);
    expect(str(await ssoRes.json(), "code")).toBe("last_login_method");

    const emailOnly = await signup("unbind-last-email@example.com");
    const emailRes = await unbind(await reauthed(emailOnly.session), "email");
    expect(emailRes.status).toBe(409);
    expect(str(await emailRes.json(), "code")).toBe("last_login_method");
  });

  test("unknown method → 404 not_found; unbound provider → 404 identity_not_found", async () => {
    const user = await signup("unbind-missing@example.com");
    const cookies = await reauthed(user.session);
    const unknown = await unbind(cookies, "apple");
    expect(unknown.status).toBe(404);
    expect(str(await unknown.json(), "code")).toBe("not_found");
    const missing = await unbind(cookies, "google");
    expect(missing.status).toBe(404);
    expect(str(await missing.json(), "code")).toBe("identity_not_found");
  });

  test("removing Google keeps the email method usable and revokes other devices", async () => {
    const user = await signup("unbind-google@example.com");
    const start = await startBind(await reauthed(user.session));
    const started = readStart(start, await start.json());
    await mockGoogle(must(started.url.searchParams.get("nonce"), "nonce"), "id-unbind-google");
    await finishGoogle(started, user.session);
    vi.restoreAllMocks();

    const res = await unbind(await reauthed(user.session), "google");
    expect(res.status).toBe(204);
    const refreshed = cookieOf(res);
    expect(refreshed).not.toBe(user.session);

    expect(str(await (await call("/api/me", { headers: { Cookie: refreshed } })).json(), "id")).toBe(user.id);
    expect(await (await call("/api/me", { headers: { Cookie: user.session } })).json()).toBeNull();

    const google = await loginWithGoogle("id-unbind-google");
    expect(google.id).not.toBe(user.id);
  });

  test("removing email keeps the SSO method usable and invalidates the password", async () => {
    const user = await loginWithGoogle("id-unbind-email");
    const bind = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthWithGoogle(user.session, "id-unbind-email") },
      body: JSON.stringify({ email: "unbind-email@example.com", password: "unbind-pass-1" }),
    });
    expect(bind.status).toBe(200);
    await verifyUserEmail(user.id);

    const res = await unbind(await reauthed(user.session, "unbind-pass-1"), "email");
    expect(res.status).toBe(204);
    const refreshed = cookieOf(res);
    expect(str(await (await call("/api/me", { headers: { Cookie: refreshed } })).json(), "id")).toBe(user.id);

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "unbind-email@example.com", password: "unbind-pass-1" }),
    });
    expect(login.status).toBe(401);

    const overview = await (await identities(refreshed)).json();
    expect(field(overview, "email")).toBeNull();
    expect(str(must(rows(field(overview, "oauth"))[0], "oauth identity"), "provider")).toBe("google");
  });

  test("the reauth window survives the bump on the same device but not on its old version", async () => {
    const user = await loginWithGoogle("id-unbind-window");
    const bind = await call("/api/me/identities/email", {
      method: "POST",
      headers: { ...json, Cookie: await reauthWithGoogle(user.session, "id-unbind-window") },
      body: JSON.stringify({ email: "unbind-window@example.com", password: "unbind-pass-2" }),
    });
    expect(bind.status).toBe(200);
    await verifyUserEmail(user.id);
    const cookies = await reauthed(user.session, "unbind-pass-2");
    const oldReauth = must(
      cookieNamed(await reauthWithPassword(user.session, "unbind-pass-2"), "socrates_reauth"),
      "reauth cookie",
    );
    const res = await unbind(cookies, "email");
    expect(res.status).toBe(204);
    const refreshed = cookieOf(res);
    const reissued = must(cookieNamed(res, "socrates_reauth"), "reissued reauth cookie");

    const overview = await (
      await call("/api/me/identities", { headers: { Cookie: `${refreshed}; ${reissued}` } })
    ).json();
    expect(field(overview, "reauthExpiresAt")).not.toBeNull();

    const stale = await unbind(`${refreshed}; ${oldReauth}`, "google");
    expect(stale.status).toBe(403);
    expect(str(await stale.json(), "code")).toBe("reauth_required");
  });
});
