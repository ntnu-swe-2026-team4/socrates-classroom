import type { Env } from "../env";

const ALLOWED = ["openrouter", "opencode-go"] as const;
export type ByokProvider = (typeof ALLOWED)[number];

export function isAllowedProvider(provider: string): provider is ByokProvider {
  return (ALLOWED as readonly string[]).includes(provider);
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const secret = env.BYOK_ENC_KEY ?? "socrates-dev-secret";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export async function encryptKey(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(env);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}

export async function decryptKey(env: Env, stored: string): Promise<string | null> {
  const [ivPart, dataPart] = stored.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const key = await aesKey(env);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivPart) as BufferSource },
      key,
      fromB64(dataPart) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
