import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, inject, test, vi } from "vitest";
import { seedFixture } from "../src/seed";
import {
  FACEBOOK_DIALOG_URL,
  FACEBOOK_ME_URL,
  FACEBOOK_TOKEN_URL,
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
  oauthProviders,
  resetGoogleKeyCache,
} from "../src/oauth";
import { call, classroomWithActivity, cookieOf } from "./helpers";
import { one, run } from "../src/db/d1";

const migrations = inject("d1Migrations");
const CLIENT_ID = "test-google-client-id";
const FB_APP_ID = "test-facebook-app-id";
const FB_APP_SECRET = "test-facebook-app-secret";
const FB_ACCESS_TOKEN = "fb-token";
const json = { "Content-Type": "application/json" };

let teacher: string;
let joinCode: string;
let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function rsaPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function idToken(claims: Record<string, unknown>, key = signingKey, kid = "kid-1"): Promise<string> {
  const head = encodeJson({ alg: "RS256", kid, typ: "JWT" });
  const body = encodeJson(claims);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function cookieNamed(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0]!)
    .find((pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1);
}

interface Started {
  cookie: string;
  state: string;
  nonce: string;
  url: URL;
}

async function start(): Promise<Started> {
  const res = await call("/api/auth/oauth/google/start", { redirect: "manual" });
  expect(res.status).toBe(302);
  const url = new URL(res.headers.get("Location")!);
  const cookie = cookieNamed(res, "socrates_oauth");
  expect(cookie).toBeDefined();
  return { cookie: cookie!, state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")!, url };
}

async function mockGoogle(claims: (nonce: string) => Record<string, unknown>, nonce: string, key = signingKey) {
  const publicJwk = await crypto.subtle.exportKey("jwk", signingKey.publicKey);
  const token = await idToken(claims(nonce), key);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === GOOGLE_TOKEN_URL) return Response.json({ id_token: token, access_token: "x" });
    if (url === GOOGLE_JWKS_URL) {
      return Response.json(
        { keys: [{ ...publicJwk, kid: "kid-1", alg: "RS256", use: "sig" }] },
        { headers: { "Cache-Control": "max-age=60" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  });
}

function validClaims(sub: string, extra: Record<string, unknown> = {}) {
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
    ...extra,
  });
}

async function finish(started: Started, state = started.state): Promise<Response> {
  return call(`/api/auth/oauth/google/callback?state=${encodeURIComponent(state)}&code=auth-code`, {
    headers: { Cookie: started.cookie },
    redirect: "manual",
  });
}

async function googleLogin(sub: string, extra: Record<string, unknown> = {}): Promise<Response> {
  const started = await start();
  await mockGoogle(validClaims(sub, extra), started.nonce);
  const res = await finish(started);
  vi.restoreAllMocks();
  return res;
}

async function me(cookie: string): Promise<{ id: string; name: string; isAdmin: boolean } | null> {
  return (await (await call("/api/me", { headers: { Cookie: cookie } })).json()) as {
    id: string;
    name: string;
    isAdmin: boolean;
  } | null;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  signingKey = await rsaPair();
  otherKey = await rsaPair();
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  teacher = cookieOf(login);
  const started = await classroomWithActivity(teacher, "SSO 班");
  joinCode = started.code;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGoogleKeyCache();
});

describe("email signup (standalone account)", () => {
  test("signup → session → logout → login returns the same user", async () => {
    const body = { email: "New.User@Example.com", password: "password-1", name: "新用戶", tosAccepted: true };
    const res = await call("/api/auth/signup", { method: "POST", headers: json, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const user = (await res.json()) as { id: string; name: string; isAdmin: boolean };
    expect(user.name).toBe("新用戶");
    expect("canManageClasses" in user).toBe(false);
    expect(user.isAdmin).toBe(false);
    const session = cookieOf(res);
    expect((await me(session))?.id).toBe(user.id);

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "new.user@example.com", password: "password-1" }),
    });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { id: string }).id).toBe(user.id);
  });

  test("duplicate email → 409, missing ToS → 422, weak password → 422", async () => {
    const base = { email: "dup@example.com", password: "password-1", name: "A", tosAccepted: true };
    expect((await call("/api/auth/signup", { method: "POST", headers: json, body: JSON.stringify(base) })).status).toBe(
      200,
    );
    const dup = await call("/api/auth/signup", { method: "POST", headers: json, body: JSON.stringify(base) });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe("email_taken");
    const noTos = await call("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ ...base, email: "tos@example.com", tosAccepted: false }),
    });
    expect(((await noTos.json()) as { code: string }).code).toBe("tos_required");
    const weak = await call("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ ...base, email: "weak@example.com", password: "short" }),
    });
    expect(weak.status).toBe(422);
  });

  test("no-mode (#210): standalone accounts can create classrooms and manage keys; joining still works", async () => {
    const res = await call("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "joiner@example.com", password: "password-1", name: "加入者", tosAccepted: true }),
    });
    const session = cookieOf(res);
    const create = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: session },
      body: JSON.stringify({ name: "x" }),
    });
    expect(create.status).toBe(201);
    expect((await call("/api/settings/keys", { headers: { Cookie: session } })).status).toBe(200);

    const joined = await call("/api/join", {
      method: "POST",
      headers: { ...json, Cookie: session },
      body: JSON.stringify({ code: joinCode, tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const list = (await (await call("/api/classrooms", { headers: { Cookie: session } })).json()) as Array<{
      role: string;
      code: string | null;
    }>;
    expect(list.length).toBe(2);
    expect(list.some((room) => room.role === "teacher" && room.code !== null)).toBe(true);
    expect(list.some((room) => room.role === "student" && room.code === null)).toBe(true);
  });
});

describe("Google OAuth", () => {
  test("start redirects to Google with state, nonce and S256 PKCE", async () => {
    const started = await start();
    expect(started.url.origin + started.url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(started.url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(started.url.searchParams.get("response_type")).toBe("code");
    expect(started.url.searchParams.get("scope")).toBe("openid email profile");
    expect(started.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(started.url.searchParams.get("code_challenge")).toBeTruthy();
    expect(started.url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/oauth\/google\/callback$/);
    expect(started.state.length).toBeGreaterThan(20);
    expect(started.nonce.length).toBeGreaterThan(20);
  });

  test("unknown provider → 404", async () => {
    expect((await call("/api/auth/oauth/nope/start", { redirect: "manual" })).status).toBe(404);
  });

  test("first login creates a standalone account; second login reuses it", async () => {
    const first = await googleLogin("g-100");
    expect(first.status).toBe(302);
    expect(first.headers.get("Location")).toBe("/home");
    const session = cookieNamed(first, "socrates_session")!;
    const user = await me(session);
    expect(user?.isAdmin).toBe(false);
    expect(user?.name).toBe("Google g-100");

    const second = await googleLogin("g-100");
    const again = await me(cookieNamed(second, "socrates_session")!);
    expect(again?.id).toBe(user?.id);
  });

  test("disabled account is refused at the OAuth gate, same as password login", async () => {
    await googleLogin("g-175");
    await run(
      env.DB,
      "UPDATE users SET disabled_at = '2026-11-22T00:00:00Z' WHERE id = (SELECT user_id FROM user_identities WHERE provider = 'google' AND provider_user_id = 'g-175')",
      {},
    );
    const res = await googleLogin("g-175");
    expect(res.headers.get("Location")).toBe("/login?error=account_disabled");
    expect(cookieNamed(res, "socrates_session")).toBeUndefined();
  });

  test("same email via email signup and Google stays two accounts", async () => {
    const signup = await call("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "g-200@gmail.com", password: "password-1", name: "E", tosAccepted: true }),
    });
    const emailUser = (await signup.json()) as { id: string };
    const google = await googleLogin("g-200");
    const googleUser = await me(cookieNamed(google, "socrates_session")!);
    expect(googleUser?.id).toBeDefined();
    expect(googleUser?.id).not.toBe(emailUser.id);

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: "g-200@gmail.com", password: "password-1" }),
    });
    expect(((await login.json()) as { id: string }).id).toBe(emailUser.id);
  });

  test("missing cookie or mismatched state → oauth_state_invalid, no session", async () => {
    const noCookie = await call("/api/auth/oauth/google/callback?state=abc&code=x", { redirect: "manual" });
    expect(noCookie.headers.get("Location")).toBe("/login?error=oauth_state_invalid");
    expect(cookieNamed(noCookie, "socrates_session")).toBeUndefined();

    const started = await start();
    const wrong = await finish(started, "tampered-state");
    expect(wrong.headers.get("Location")).toBe("/login?error=oauth_state_invalid");
    expect(cookieNamed(wrong, "socrates_session")).toBeUndefined();

    const forged = await call(`/api/auth/oauth/google/callback?state=${started.state}&code=x`, {
      headers: { Cookie: `${started.cookie}x` },
      redirect: "manual",
    });
    expect(forged.headers.get("Location")).toBe("/login?error=oauth_state_invalid");
  });

  test("user cancels on Google → oauth_failed", async () => {
    const started = await start();
    const res = await call(`/api/auth/oauth/google/callback?state=${started.state}&error=access_denied`, {
      headers: { Cookie: started.cookie },
      redirect: "manual",
    });
    expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
  });

  test.each([
    ["unverified email", { email_verified: false }, "oauth_email_unverified"],
    ["wrong audience", { aud: "someone-else" }, "oauth_failed"],
    ["wrong issuer", { iss: "https://evil.example" }, "oauth_failed"],
    ["expired token", { exp: Math.floor(Date.now() / 1000) - 3600 }, "oauth_failed"],
    ["missing iat", { iat: undefined }, "oauth_failed"],
    ["iat in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }, "oauth_failed"],
    ["wrong nonce", { nonce: "replayed" }, "oauth_failed"],
  ])("rejects %s", async (_label, extra, code) => {
    const res = await googleLogin("g-bad", extra);
    expect(res.headers.get("Location")).toBe(`/login?error=${code}`);
    expect(cookieNamed(res, "socrates_session")).toBeUndefined();
  });

  test("rejects a token signed by a key Google did not publish", async () => {
    const started = await start();
    await mockGoogle(validClaims("g-forged"), started.nonce, otherKey);
    const res = await finish(started);
    expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
    expect(cookieNamed(res, "socrates_session")).toBeUndefined();
  });
});

describe("authProviders capability detection (#207)", () => {
  test("GET /auth/providers lists configured providers; apple stays retired (拍板見 accounts.md §7)", async () => {
    const res = await call("/api/auth/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: string[] };
    expect(body.providers).toContain("google");
    expect(body.providers).toContain("facebook");
    expect(body.providers).not.toContain("apple");
  });

  test("GET /auth/providers is browser-cacheable: constant payload, no session, no DB", async () => {
    const res = await call("/api/auth/providers");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  test("oauthProviders: env presence gates each provider", () => {
    expect(oauthProviders({})).toEqual([]);
    expect(oauthProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual(["google"]);
    expect(oauthProviders({ FACEBOOK_APP_ID: "a", FACEBOOK_APP_SECRET: "b" })).toEqual(["facebook"]);
    expect(
      oauthProviders({
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        FACEBOOK_APP_ID: "c",
        FACEBOOK_APP_SECRET: "d",
      }),
    ).toEqual(["google", "facebook"]);
  });

  test("apple start is 404 (拍板退場)", async () => {
    expect((await call("/api/auth/oauth/apple/start", { redirect: "manual" })).status).toBe(404);
  });
});

describe("Facebook OAuth (#207)", () => {
  interface FbStarted {
    cookie: string;
    state: string;
    url: URL;
  }

  async function fbStart(): Promise<FbStarted> {
    const res = await call("/api/auth/oauth/facebook/start", { redirect: "manual" });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    const cookie = cookieNamed(res, "socrates_oauth");
    expect(cookie).toBeDefined();
    return { cookie: cookie!, state: url.searchParams.get("state")!, url };
  }

  function mockFacebook(profile: Record<string, unknown>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href);
      if (url.origin + url.pathname === FACEBOOK_TOKEN_URL) {
        expect(url.searchParams.get("client_id")).toBe(FB_APP_ID);
        expect(url.searchParams.get("code")).toBe("auth-code");
        return Response.json({ access_token: FB_ACCESS_TOKEN, token_type: "bearer" });
      }
      if (url.origin + url.pathname === FACEBOOK_ME_URL) {
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(FB_APP_SECRET),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(FB_ACCESS_TOKEN));
        const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
        expect(url.searchParams.get("appsecret_proof")).toBe(expected);
        return Response.json(profile);
      }
      return new Response("unexpected", { status: 500 });
    });
  }

  async function fbLogin(profile: Record<string, unknown>): Promise<Response> {
    const started = await fbStart();
    mockFacebook(profile);
    const res = await call(
      `/api/auth/oauth/facebook/callback?state=${encodeURIComponent(started.state)}&code=auth-code`,
      {
        headers: { Cookie: started.cookie },
        redirect: "manual",
      },
    );
    vi.restoreAllMocks();
    return res;
  }

  test("start redirects to the dialog with client_id, state, scope and redirect_uri", async () => {
    const started = await fbStart();
    expect(started.url.origin + started.url.pathname).toBe(FACEBOOK_DIALOG_URL);
    expect(started.url.searchParams.get("client_id")).toBe(FB_APP_ID);
    expect(started.url.searchParams.get("response_type")).toBe("code");
    expect(started.url.searchParams.get("scope")).toBe("email");
    expect(started.url.searchParams.get("redirect_uri")!.endsWith("/api/auth/oauth/facebook/callback")).toBe(true);
    expect(started.state.length).toBeGreaterThan(0);
  });

  test("first login creates a standalone account; second login reuses it", async () => {
    const first = await fbLogin({ id: "fb-100", name: "林書豪", email: "fb100@example.com" });
    expect(first.status).toBe(302);
    expect(first.headers.get("Location")).toBe("/home");
    const session = cookieNamed(first, "socrates_session")!;
    const user = await me(session);
    expect(user?.name).toBe("林書豪");

    const second = await fbLogin({ id: "fb-100", name: "林書豪", email: "fb100@example.com" });
    const again = await me(cookieNamed(second, "socrates_session")!);
    expect(again?.id).toBe(user?.id);
  });

  test("profile without email still signs in; identity row keeps email NULL", async () => {
    const res = await fbLogin({ id: "fb-noemail", name: "無信箱" });
    expect(res.status).toBe(302);
    const identity = await one<{ email: string | null }>(
      env.DB,
      "SELECT email FROM user_identities WHERE provider = 'facebook' AND provider_user_id = 'fb-noemail'",
    );
    expect(identity?.email).toBeNull();
  });

  test("callback with wrong state is rejected", async () => {
    const started = await fbStart();
    mockFacebook({ id: "fb-x", name: "X" });
    const res = await call(`/api/auth/oauth/facebook/callback?state=forged&code=auth-code`, {
      headers: { Cookie: started.cookie },
      redirect: "manual",
    });
    vi.restoreAllMocks();
    expect(res.headers.get("Location")).toBe("/login?error=oauth_state_invalid");
    expect(cookieNamed(res, "socrates_session")).toBeUndefined();
  });
});
