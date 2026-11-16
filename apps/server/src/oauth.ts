import { b64url, fromB64url } from "./auth";

export const OAUTH_PROVIDERS = ["google"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OAuthProfile {
  subject: string;
  email: string;
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
