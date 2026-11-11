import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AUTH_PROVIDERS, type AuthProvider, type Lang, type User } from "@socrates/shared";
import { batch, one, type SqlEntry } from "../db/d1";
import { b64url, fromB64url, openClaims, sealClaims, startSession } from "../auth";
import { timingSafeEqual } from "../auth-crypto";
import { enforceIpLimit, langOf, newId, nowIso, uniqueViolationColumns, type AppEnv, type Ctx } from "../http";
import type { Env } from "../env";
import { providerConfigured } from "./oauth-config";

export const OAUTH_STATE_COOKIE = "socrates_oauth";
const STATE_PATH = "/api/auth/oauth";
const STATE_TTL_SECONDS = 600;
const FACEBOOK_VERSION = "v24.0";
const APPLE_ISSUER = "https://appleid.apple.com";
const DEFAULT_NEXT = "/home";

export interface OAuthState {
  p: AuthProvider;
  s: string;
  v?: string;
  n: string;
  g?: string;
  exp: number;
}

export interface OAuthProfile {
  provider: AuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

type Json = Record<string, unknown>;

const encoder = new TextEncoder();
const PROVIDER_LABEL: Record<AuthProvider, string> = { google: "Google", apple: "Apple", facebook: "Facebook" };
const FALLBACK_NAME: Record<Lang, (label: string) => string> = {
  zh: (label) => `${label} 使用者`,
  en: (label) => `${label} user`,
  es: (label) => `Usuario de ${label}`,
};

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));
const b64json = (value: object): string => b64url(encoder.encode(JSON.stringify(value)));

function providerOf(raw: string): AuthProvider | null {
  return (AUTH_PROVIDERS as readonly string[]).includes(raw) ? (raw as AuthProvider) : null;
}

export function safeNext(raw: string | undefined | null): string {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return DEFAULT_NEXT;
  }
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return DEFAULT_NEXT;
  }
  return raw;
}

function callbackUrl(c: Ctx, provider: AuthProvider): string {
  const base = (c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
  return `${base}/api/auth/oauth/${provider}/callback`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

async function authorizeUrl(env: Env, provider: AuthProvider, redirectUri: string, state: OAuthState): Promise<string> {
  const common = { redirect_uri: redirectUri, response_type: "code", state: state.s };
  switch (provider) {
    case "google":
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        ...common,
        client_id: env.GOOGLE_CLIENT_ID!,
        scope: "openid email profile",
        code_challenge: await pkceChallenge(state.v!),
        code_challenge_method: "S256",
        prompt: "select_account",
      })}`;
    case "facebook":
      return `https://www.facebook.com/${FACEBOOK_VERSION}/dialog/oauth?${new URLSearchParams({
        ...common,
        client_id: env.FACEBOOK_APP_ID!,
        scope: "email,public_profile",
      })}`;
    case "apple":
      return `${APPLE_ISSUER}/auth/authorize?${new URLSearchParams({
        ...common,
        client_id: env.APPLE_CLIENT_ID!,
        scope: "name email",
        response_mode: "form_post",
      })}`;
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as Json;
}

function postForm(url: string, form: Record<string, string>): Promise<Json> {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
}

function accessTokenOf(token: Json, provider: AuthProvider): string {
  const access = str(token.access_token);
  if (!access) throw new Error(`${provider} token response without access_token`);
  return access;
}

export async function appleClientSecret(
  env: Pick<Env, "APPLE_CLIENT_ID" | "APPLE_TEAM_ID" | "APPLE_KEY_ID" | "APPLE_PRIVATE_KEY">,
  iat = Math.floor(Date.now() / 1000),
): Promise<string> {
  const der = fromB64url((env.APPLE_PRIVATE_KEY ?? "").replace(/-----[A-Z ]+-----/g, "").replace(/\\n|\s/g, ""));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signingInput = `${b64json({ alg: "ES256", kid: env.APPLE_KEY_ID })}.${b64json({
    iss: env.APPLE_TEAM_ID,
    iat,
    exp: iat + 300,
    aud: APPLE_ISSUER,
    sub: env.APPLE_CLIENT_ID,
  })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

function appleName(rawUser: string | undefined): string | null {
  if (!rawUser) return null;
  try {
    const name = (JSON.parse(rawUser) as { name?: { firstName?: unknown; lastName?: unknown } }).name;
    return [str(name?.firstName), str(name?.lastName)].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

async function fetchProfile(
  env: Env,
  provider: AuthProvider,
  params: Record<string, string>,
  redirectUri: string,
  verifier: string | undefined,
): Promise<OAuthProfile> {
  const code = params.code!;
  switch (provider) {
    case "google": {
      const token = await postForm("https://oauth2.googleapis.com/token", {
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier ?? "",
      });
      const info = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessTokenOf(token, provider)}` },
      });
      const email = str(info.email);
      return {
        provider,
        subject: str(info.sub) ?? "",
        email,
        emailVerified: info.email_verified === true,
        name: str(info.name),
      };
    }
    case "facebook": {
      const graph = `https://graph.facebook.com/${FACEBOOK_VERSION}`;
      const token = await fetchJson(
        `${graph}/oauth/access_token?${new URLSearchParams({
          client_id: env.FACEBOOK_APP_ID!,
          client_secret: env.FACEBOOK_APP_SECRET!,
          redirect_uri: redirectUri,
          code,
        })}`,
      );
      const me = await fetchJson(`${graph}/me?fields=id,name,email`, {
        headers: { Authorization: `Bearer ${accessTokenOf(token, provider)}` },
      });
      const email = str(me.email);
      return { provider, subject: str(me.id) ?? "", email, emailVerified: email !== null, name: str(me.name) };
    }
    case "apple": {
      const token = await postForm(`${APPLE_ISSUER}/auth/token`, {
        code,
        client_id: env.APPLE_CLIENT_ID!,
        client_secret: await appleClientSecret(env),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const payload = str(token.id_token)?.split(".")[1];
      if (!payload) throw new Error("apple token response without id_token");
      const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Json;
      if (claims.iss !== APPLE_ISSUER || claims.aud !== env.APPLE_CLIENT_ID) throw new Error("apple id_token audience");
      return {
        provider,
        subject: str(claims.sub) ?? "",
        email: str(claims.email),
        emailVerified: claims.email_verified === true || claims.email_verified === "true",
        name: appleName(params.user),
      };
    }
  }
}

interface AccountRow {
  id: string;
  name: string;
  is_guest: number;
}

const toUser = (row: AccountRow): User => ({ id: row.id, name: row.name, guest: row.is_guest === 1 });

async function resolveOnce(db: D1Database, profile: OAuthProfile, guestId: string | null, lang: Lang): Promise<User> {
  const key = { provider: profile.provider, subject: profile.subject };
  const linked = await one<AccountRow>(
    db,
    "SELECT u.id, u.name, u.is_guest FROM oauth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $provider AND i.subject = $subject",
    key,
  );
  if (linked) return toUser(linked);

  const at = nowIso();
  const email = profile.emailVerified && profile.email ? profile.email.trim().toLowerCase() : null;
  const link = (uid: string): SqlEntry => ({
    sql: "INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES ($provider, $subject, $uid, $email, $at)",
    params: { ...key, uid, email: profile.email?.trim().toLowerCase() ?? null, at },
  });

  let storedEmail = email;
  if (email) {
    const owner = await one<AccountRow & { password_hash: string | null }>(
      db,
      "SELECT id, name, is_guest, password_hash FROM users WHERE email = $email",
      { email },
    );
    if (owner?.password_hash) storedEmail = null;
    else if (owner) {
      await batch(db, [
        { sql: "UPDATE users SET is_guest = 0 WHERE id = $id", params: { id: owner.id } },
        link(owner.id),
      ]);
      return { id: owner.id, name: owner.name, guest: false };
    }
  }

  const name =
    profile.name?.trim().slice(0, 80) ||
    profile.email?.split("@")[0]?.trim().slice(0, 80) ||
    FALLBACK_NAME[lang](PROVIDER_LABEL[profile.provider]);

  const guest = guestId
    ? await one<{ id: string }>(
        db,
        "SELECT id FROM users WHERE id = $id AND is_guest = 1 AND preview_classroom_id IS NULL",
        { id: guestId },
      )
    : null;
  if (guest) {
    await batch(db, [
      {
        sql: "UPDATE users SET name = $name, email = COALESCE($email, email), is_guest = 0 WHERE id = $id",
        params: { id: guest.id, name, email: storedEmail },
      },
      link(guest.id),
    ]);
    return { id: guest.id, name, guest: false };
  }

  const id = newId("u_");
  await batch(db, [
    {
      sql: "INSERT INTO users (id, name, is_guest, email, lang, created_at) VALUES ($id, $name, 0, $email, $lang, $at)",
      params: { id, name, email: storedEmail, lang, at },
    },
    link(id),
  ]);
  return { id, name, guest: false };
}

export async function resolveOAuthAccount(
  db: D1Database,
  profile: OAuthProfile,
  options: { guestId?: string | null; lang: Lang },
): Promise<User> {
  if (!profile.subject) throw new Error(`${profile.provider} profile without subject`);
  try {
    return await resolveOnce(db, profile, options.guestId ?? null, options.lang);
  } catch (error) {
    if (uniqueViolationColumns(error).length === 0) throw error;
    return await resolveOnce(db, profile, options.guestId ?? null, options.lang);
  }
}

async function callbackParams(c: Ctx): Promise<Record<string, string>> {
  if (c.req.method !== "POST") return c.req.query();
  try {
    const body = await c.req.parseBody();
    return Object.fromEntries(
      Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function currentGuestId(c: Ctx): string | undefined {
  const user = c.get("user");
  return user?.guest && !user.preview ? user.id : undefined;
}

export function oauthRoutes() {
  return new Hono<AppEnv>()
    .get("/auth/oauth/:provider/start", async (c) => {
      const provider = providerOf(c.req.param("provider"));
      if (!provider || !providerConfigured(c.env, provider)) return c.redirect("/login?error=oauth_unavailable", 302);
      const guestId = currentGuestId(c);
      const state: OAuthState = {
        p: provider,
        s: randomToken(),
        ...(provider === "google" ? { v: randomToken() } : {}),
        n: safeNext(c.req.query("next")),
        ...(guestId ? { g: guestId } : {}),
        exp: Date.now() + STATE_TTL_SECONDS * 1000,
      };
      setCookie(c, OAUTH_STATE_COOKIE, await sealClaims({ env: c.env }, state), {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        path: STATE_PATH,
        maxAge: STATE_TTL_SECONDS,
      });
      return c.redirect(await authorizeUrl(c.env, provider, callbackUrl(c, provider), state), 302);
    })
    .on(["GET", "POST"], "/auth/oauth/:provider/callback", async (c) => {
      await enforceIpLimit(c, "oauth", 30);
      const provider = providerOf(c.req.param("provider"));
      const params = await callbackParams(c);
      const state = await openClaims<OAuthState>({ env: c.env }, getCookie(c, OAUTH_STATE_COOKIE));
      deleteCookie(c, OAUTH_STATE_COOKIE, { path: STATE_PATH, secure: true, sameSite: "None" });
      const valid =
        provider &&
        providerConfigured(c.env, provider) &&
        state?.p === provider &&
        state.exp > Date.now() &&
        params.state &&
        timingSafeEqual(params.state, state.s) &&
        params.code;
      if (!valid) return c.redirect("/login?error=oauth_failed", 302);
      try {
        const profile = await fetchProfile(c.env, provider, params, callbackUrl(c, provider), state.v);
        const user = await resolveOAuthAccount(c.env.DB, profile, {
          guestId: state.g ?? currentGuestId(c),
          lang: langOf(c),
        });
        await startSession(c, user);
        return c.redirect(state.n, 302);
      } catch (error) {
        console.warn("[oauth] sign-in failed", provider, error instanceof Error ? error.message : "unknown error");
        return c.redirect("/login?error=oauth_failed", 302);
      }
    });
}
