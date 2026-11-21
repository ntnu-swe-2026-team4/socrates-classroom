import { OAUTH_PROVIDERS, type OAuthProvider } from "@socrates/shared";
import { b64url, fromB64url } from "./auth";

export type { OAuthProvider };

export interface OAuthProfile {
  subject: string;
  email: string | null;
  name: string;
}

export interface OAuthPending {
  provider: OAuthProvider;
  state: string;
  verifier: string;
  nonce: string;
  exp: number;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CLOCK_SKEW_SECONDS = 60;

export class OAuthError extends Error {
  constructor(public readonly code: "oauth_failed" | "oauth_email_unverified") {
    super(code);
  }
}

export interface ProviderEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
}

export function oauthProviders(env: ProviderEnv): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) providers.push("facebook");
  return providers;
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function googleAuthorizeUrl(config: GoogleConfig, pending: OAuthPending): Promise<string> {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function googleProfile(config: GoogleConfig, code: string, pending: OAuthPending): Promise<OAuthProfile> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) throw new OAuthError("oauth_failed");
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new OAuthError("oauth_failed");
  return verifyGoogleIdToken(body.id_token, config.clientId, pending.nonce);
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  sub?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(fromB64url(segment))) as T;
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  nonce: string,
  now = Date.now(),
): Promise<OAuthProfile> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) throw new OAuthError("oauth_failed");
  let header: { alg?: unknown; kid?: unknown };
  let claims: IdTokenClaims;
  try {
    header = decodeSegment(headerPart);
    claims = decodeSegment(payloadPart);
  } catch {
    throw new OAuthError("oauth_failed");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new OAuthError("oauth_failed");
  const key = await googleKey(header.kid);
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(signaturePart) as BufferSource, signed);
  if (!valid) throw new OAuthError("oauth_failed");

  const nowSeconds = Math.floor(now / 1000);
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.includes(claims.iss)) throw new OAuthError("oauth_failed");
  // Google issues a string `aud` for a single client; accept arrays only if we ever register multiple clients.
  if (claims.aud !== clientId) throw new OAuthError("oauth_failed");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new OAuthError("oauth_failed");
  }
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new OAuthError("oauth_failed");
  }
  if (typeof claims.nonce !== "string" || claims.nonce !== nonce) throw new OAuthError("oauth_failed");
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw new OAuthError("oauth_failed");
  if (typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new OAuthError("oauth_email_unverified");
  }
  const email = claims.email.toLowerCase();
  const fallback = email.split("@")[0] ?? "user";
  const name = (typeof claims.name === "string" ? claims.name : fallback).trim().slice(0, 80) || fallback;
  return { subject: claims.sub, email, name };
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

export function resetGoogleKeyCache(): void {
  jwksCache = null;
}

async function loadJwks(force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new OAuthError("oauth_failed");
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys: body.keys ?? [], expiresAt: Date.now() + Math.min(maxAge, 86400) * 1000 };
  return jwksCache.keys;
}

async function googleKey(kid: string): Promise<CryptoKey> {
  let jwk = (await loadJwks(false)).find((key) => key.kid === kid);
  if (!jwk) jwk = (await loadJwks(true)).find((key) => key.kid === kid);
  if (jwk?.kty !== "RSA") throw new OAuthError("oauth_failed");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

export interface FacebookConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export const FACEBOOK_DIALOG_URL = "https://www.facebook.com/v27.0/dialog/oauth";
export const FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v27.0/oauth/access_token";
export const FACEBOOK_ME_URL = "https://graph.facebook.com/v27.0/me";
const FACEBOOK_FIELDS = "id,name,email";

export async function appsecretProof(appSecret: string, accessToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function facebookAuthorizeUrl(config: FacebookConfig, pending: OAuthPending): string {
  const url = new URL(FACEBOOK_DIALOG_URL);
  url.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "email",
    state: pending.state,
  }).toString();
  return url.toString();
}

export async function facebookProfile(config: FacebookConfig, code: string): Promise<OAuthProfile> {
  const tokenUrl = new URL(FACEBOOK_TOKEN_URL);
  tokenUrl.search = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  }).toString();
  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) throw new OAuthError("oauth_failed");
  const tokenBody = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof tokenBody.access_token !== "string" || tokenBody.access_token.length === 0) {
    throw new OAuthError("oauth_failed");
  }
  const meUrl = new URL(FACEBOOK_ME_URL);
  meUrl.search = new URLSearchParams({
    fields: FACEBOOK_FIELDS,
    access_token: tokenBody.access_token,
    appsecret_proof: await appsecretProof(config.appSecret, tokenBody.access_token),
  }).toString();
  const meRes = await fetch(meUrl);
  if (!meRes.ok) throw new OAuthError("oauth_failed");
  const me = (await meRes.json()) as { id?: unknown; name?: unknown; email?: unknown };
  if (typeof me.id !== "string" || me.id.length === 0) throw new OAuthError("oauth_failed");
  const name = (typeof me.name === "string" ? me.name : "").trim().slice(0, 80) || `Facebook ${me.id.slice(0, 8)}`;
  const email = typeof me.email === "string" && me.email.length > 0 ? me.email.toLowerCase() : null;
  return { subject: me.id, email, name };
}
