import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey, timingSafeEqual } from "../src/auth-crypto";
import type { Env } from "../src/env";

const env = { BYOK_ENC_KEY: "test-encryption-key" } as unknown as Env;

describe("auth-crypto（teacher key AES-GCM）", () => {
  it("roundtrip：encrypt → decrypt 回原文；blob 帶 v1 前綴", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(await decryptKey(env, stored)).toBe("sk-live-abcdef123456");
  });

  it("每次加密 IV 不同——同一明文兩次 blob 相異", async () => {
    const a = await encryptKey(env, "same-plaintext");
    const b = await encryptKey(env, "same-plaintext");
    expect(a).not.toBe(b);
  });

  it("tampered ciphertext：decrypt 回 null（GCM tag 擋篡改）", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    const [version, iv, data] = stored.split(".");
    const tampered = atob(data!);
    const flipped = btoa(tampered.slice(0, -1) + String.fromCharCode(tampered.charCodeAt(tampered.length - 1) ^ 1));
    expect(await decryptKey(env, [version, iv, flipped].join("."))).toBeNull();
  });

  it("未知版本前綴與殘缺 blob：decrypt 回 null", async () => {
    expect(await decryptKey(env, "v2.aaa.bbb")).toBeNull();
    expect(await decryptKey(env, "garbage")).toBeNull();
    expect(await decryptKey(env, "v1.onlyonepart")).toBeNull();
  });

  it("換 key：舊 blob 解不開（回 null，不炸）", async () => {
    const stored = await encryptKey(env, "sk-live-abcdef123456");
    const otherEnv = { BYOK_ENC_KEY: "a-different-key" } as unknown as Env;
    expect(await decryptKey(otherEnv, stored)).toBeNull();
  });

  it("timingSafeEqual：相等 true；不等 false；長度不同 false", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
