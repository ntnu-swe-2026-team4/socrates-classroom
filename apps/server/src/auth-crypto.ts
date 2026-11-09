import type { Env } from "./env";

const KEY_VERSION = "v1";
const HKDF_SALT = new TextEncoder().encode("socrates-classroom");
const HKDF_INFO = new TextEncoder().encode("teacher-keys/aes-gcm");

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function aesKey(env: Env): Promise<CryptoKey> {
  if (!env.BYOK_ENC_KEY) throw new Error("BYOK_ENC_KEY is not set");
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BYOK_ENC_KEY), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO }, secret, 256);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
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
  return [KEY_VERSION, b64(iv), b64(new Uint8Array(sealed))].join(".");
}

export async function decryptKey(env: Env, stored: string): Promise<string | null> {
  const [version, ivPart, dataPart] = stored.split(".");
  if (version !== KEY_VERSION || !ivPart || !dataPart) return null;
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
