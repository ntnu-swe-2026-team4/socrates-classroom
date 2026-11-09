import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey, timingSafeEqual } from "../src/auth-crypto";
import type { Env } from "../src/env";

const env = { BYOK_ENC_KEY: "test-encryption-key" } as unknown as Env;

describe("auth-crypto (teacher key AES-GCM)", () => {
  it("roundtrip: encrypt → decrypt returns the original; blob carries the v1 prefix", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(await decryptKey(env, stored)).toBe("sk-live-abcdef123456");
  });

  it("each encryption uses a fresh IV — the same plaintext yields two different blobs", async () => {
    const a = await encryptKey(env, "same-plaintext");
    const b = await encryptKey(env, "same-plaintext");
    expect(a).not.toBe(b);
  });

  it("tampered ciphertext: decrypt returns null (the GCM tag blocks tampering)", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    const [version, iv, data] = stored.split(".");
    const tampered = atob(data!);
    const flipped = btoa(tampered.slice(0, -1) + String.fromCharCode(tampered.charCodeAt(tampered.length - 1) ^ 1));
    expect(await decryptKey(env, [version, iv, flipped].join("."))).toBeNull();
  });

  it("unknown version prefix and truncated blob: decrypt returns null", async () => {
    expect(await decryptKey(env, "v2.aaa.bbb")).toBeNull();
    expect(await decryptKey(env, "garbage")).toBeNull();
    expect(await decryptKey(env, "v1.onlyonepart")).toBeNull();
  });

  it("key rotation: the old blob no longer decrypts (returns null, no throw)", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    const otherEnv = { BYOK_ENC_KEY: "a-different-key" } as unknown as Env;
    expect(await decryptKey(otherEnv, stored)).toBeNull();
  });

  it("timingSafeEqual: equal true; unequal false; different lengths false", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
