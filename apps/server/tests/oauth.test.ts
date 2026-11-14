import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import worker from "../src/index";
import { fromB64url } from "../src/auth";
import { one, run } from "../src/db/d1";
import {
  appleClientSecret,
  OAUTH_STATE_COOKIE,
  resolveOAuthAccount,
  type OAuthProfile,
  type OAuthState,
} from "../src/routes/oauth";
import { call, cookieOf } from "./helpers";

const configured = { ...env, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };

function callWith(bindings: object, path: string, init: RequestInit = {}): Promise<Response> {
  return (worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }).fetch(
    new Request(`http://worker.test${path}`, init),
    bindings,
    { waitUntil: () => {} },
  );
}

function stateOf(cookie: string): OAuthState {
  const value = cookie.slice(`${OAUTH_STATE_COOKIE}=`.length);
  return JSON.parse(new TextDecoder().decode(fromB64url(value.split(".")[0]!))) as OAuthState;
}

function profile(subject: string, overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return { provider: "google", subject, email: null, emailVerified: false, name: "OAuth 使用者", ...overrides };
}

async function guestRow(id: string) {
  return await one<{ is_guest: number; email: string | null; name: string }>(
    env.DB,
    "SELECT is_guest, email, name FROM users WHERE id = $id",
    { id },
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

describe("OAuth sign-in routes", () => {
  test("providers are all disabled without credentials", async () => {
    const res = await call("/api/auth/providers");
    expect(await res.json()).toEqual({ google: false, apple: false, facebook: false });
    const enabled = await callWith(configured, "/api/auth/providers");
    expect(await enabled.json()).toEqual({ google: true, apple: false, facebook: false });
  });

  test("start for an unconfigured or unknown provider redirects to oauth_unavailable", async () => {
    for (const provider of ["google", "apple", "facebook", "github"]) {
      const res = await call(`/api/auth/oauth/${provider}/start`);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/login?error=oauth_unavailable");
    }
  });

  test("start for a configured provider redirects to Google with state, PKCE and a SameSite=None cookie", async () => {
    const res = await callWith(configured, "/api/auth/oauth/google/start?next=/classrooms/abc");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("id");
    expect(location.searchParams.get("redirect_uri")).toBe("http://worker.test/api/auth/oauth/google/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);

    const header = res.headers.getSetCookie()[0]!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=None/i);
    expect(header).toMatch(/Path=\/api\/auth\/oauth/);
    const state = stateOf(cookieOf(res));
    expect(state.p).toBe("google");
    expect(state.n).toBe("/classrooms/abc");
    expect(state.s).toBe(location.searchParams.get("state"));
    expect(state.v).toBeTruthy();
  });

  test("start rejects open-redirect next values", async () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "relative"]) {
      const res = await callWith(configured, `/api/auth/oauth/google/start?next=${encodeURIComponent(next)}`);
      expect(stateOf(cookieOf(res)).n).toBe("/home");
    }
    const missing = await callWith(configured, "/api/auth/oauth/google/start");
    expect(stateOf(cookieOf(missing)).n).toBe("/home");
  });

  test("callback with missing or mismatched state redirects to oauth_failed", async () => {
    const start = await callWith(configured, "/api/auth/oauth/google/start");
    const cookie = cookieOf(start);
    const state = stateOf(cookie).s;

    const cases: Array<[string, RequestInit]> = [
      [`/api/auth/oauth/google/callback?code=c&state=${state}`, {}],
      ["/api/auth/oauth/google/callback?code=c&state=wrong", { headers: { Cookie: cookie } }],
      [`/api/auth/oauth/google/callback?state=${state}`, { headers: { Cookie: cookie } }],
      [`/api/auth/oauth/facebook/callback?code=c&state=${state}`, { headers: { Cookie: cookie } }],
      [`/api/auth/oauth/google/callback?code=c&state=${state}`, { headers: { Cookie: `${cookie}x` } }],
      [
        "/api/auth/oauth/google/callback",
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: "c", state: "wrong" }),
        },
      ],
    ];
    for (const [path, init] of cases) {
      const res = await callWith(configured, path, init);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/login?error=oauth_failed");
      expect(res.headers.getSetCookie().join("\n")).toContain(`${OAUTH_STATE_COOKIE}=;`);
    }
  });
});

describe("resolveOAuthAccount", () => {
  test("a new identity creates a full user; the same subject returns the same user", async () => {
    const first = await resolveOAuthAccount(env.DB, profile("sub-new"), { lang: "zh" });
    expect(first.guest).toBe(false);
    expect((await guestRow(first.id))?.is_guest).toBe(0);
    const again = await resolveOAuthAccount(env.DB, profile("sub-new", { name: "Renamed" }), { lang: "zh" });
    expect(again.id).toBe(first.id);
    const other = await resolveOAuthAccount(env.DB, profile("sub-new", { provider: "facebook" }), { lang: "zh" });
    expect(other.id).not.toBe(first.id);
  });

  test("a verified email links to the existing email account", async () => {
    await run(
      env.DB,
      "INSERT INTO users (id, name, is_guest, email, lang, created_at) VALUES ('u_mail', 'Mail', 0, 'mail@example.com', 'zh', '2026-11-11T00:00:00Z')",
    );
    const linked = await resolveOAuthAccount(
      env.DB,
      profile("sub-mail", { email: "Mail@Example.com", emailVerified: true }),
      { lang: "en" },
    );
    expect(linked).toEqual({ id: "u_mail", name: "Mail", guest: false });

    const unverified = await resolveOAuthAccount(
      env.DB,
      profile("sub-mail-2", { provider: "apple", email: "mail@example.com", emailVerified: false }),
      { lang: "en" },
    );
    expect(unverified.id).not.toBe("u_mail");
    expect((await guestRow(unverified.id))?.email).toBeNull();
  });

  test("a verified email never links to a password account whose email was never verified", async () => {
    await run(
      env.DB,
      "INSERT INTO users (id, name, is_guest, email, password_hash, lang, created_at) VALUES ('u_squat', 'Squatter', 0, 'victim@example.com', 'pbkdf2$1$a$b', 'zh', '2026-11-11T00:00:00Z')",
    );
    const victim = await resolveOAuthAccount(
      env.DB,
      profile("sub-victim", { email: "victim@example.com", emailVerified: true }),
      { lang: "en" },
    );
    expect(victim.id).not.toBe("u_squat");
    expect(victim.guest).toBe(false);
    expect((await guestRow(victim.id))?.email).toBeNull();
  });

  test("signing in with OAuth never takes over a guest row", async () => {
    await run(
      env.DB,
      "INSERT INTO users (id, name, is_guest, lang, created_at) VALUES ('u_guest', '訪客 0001', 1, 'zh', '2026-11-11T00:00:00Z')",
    );
    const created = await resolveOAuthAccount(env.DB, profile("sub-guest"), { lang: "zh" });
    expect(created.id).not.toBe("u_guest");
    expect((await guestRow("u_guest"))?.is_guest).toBe(1);
  });

  test("name falls back to the email local part, then a provider label", async () => {
    const byEmail = await resolveOAuthAccount(
      env.DB,
      profile("sub-name-1", { name: null, email: "local.part@example.com", emailVerified: false }),
      { lang: "en" },
    );
    expect(byEmail.name).toBe("local.part");
    const byLabel = await resolveOAuthAccount(env.DB, profile("sub-name-2", { name: null }), { lang: "en" });
    expect(byLabel.name).toBe("Google user");
  });
});

describe("appleClientSecret", () => {
  test("produces an ES256 JWT verifiable with the matching public key", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const base64 = btoa(String.fromCharCode(...pkcs8));
    const pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

    const jwt = await appleClientSecret(
      {
        APPLE_CLIENT_ID: "tw.example.web",
        APPLE_TEAM_ID: "TEAM123456",
        APPLE_KEY_ID: "KEY1234567",
        APPLE_PRIVATE_KEY: pem,
      },
      1_000,
    );
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromB64url(part)));
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decode(payload)).toEqual({
      iss: "TEAM123456",
      iat: 1_000,
      exp: 1_300,
      aud: "https://appleid.apple.com",
      sub: "tw.example.web",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      fromB64url(signature) as BufferSource,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(ok).toBe(true);

    const escaped = await appleClientSecret(
      {
        APPLE_CLIENT_ID: "tw.example.web",
        APPLE_TEAM_ID: "TEAM123456",
        APPLE_KEY_ID: "KEY1234567",
        APPLE_PRIVATE_KEY: pem.replaceAll("\n", "\\n"),
      },
      1_000,
    );
    expect(escaped.split(".").slice(0, 2)).toEqual([header, payload]);
  });
});
