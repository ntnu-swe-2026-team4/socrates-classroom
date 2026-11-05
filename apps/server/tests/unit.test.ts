import { describe, expect, test } from "vitest";
import { issueSessionToken, userFromSessionToken, hashPassword, verifyPassword } from "../src/auth";
import { encryptKey, decryptKey, isAllowedProvider } from "../src/providers/byok";
import { availableProviders } from "../src/providers/catalog";
import { localize } from "../src/messages";
import { mockSocratesReply, openingMessage } from "../src/providers/mock-socrates";

const envStub = { env: { AUTH_SECRET: "unit-test-secret" } } as never;

describe("signed session", () => {
  test("token roundtrip", async () => {
    const user = { id: "u1", name: "小明", role: "student" as const };
    const token = await issueSessionToken(envStub, user);
    expect(await userFromSessionToken(envStub, token)).toEqual(user);
  });

  test("竄改 token 拒絕", async () => {
    const token = await issueSessionToken(envStub, { id: "u1", name: "小明", role: "student" });
    const tampered = `${token.slice(0, -3)}xyz`;
    expect(await userFromSessionToken(envStub, tampered)).toBeNull();
  });

  test("過期 token 拒絕", async () => {
    const user = { id: "u1", name: "小明", role: "student" as const };
    const token = await issueSessionToken(envStub, user);
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(atob(payload!.replaceAll("-", "+").replaceAll("_", "/"))) as { exp: number };
    claims.exp = Date.now() - 1000;
    const expiredPayload = btoa(JSON.stringify(claims)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    expect(await userFromSessionToken(envStub, `${expiredPayload}.${sig}`)).toBeNull();
  });
});

describe("password", () => {
  test("pbkdf2 roundtrip", async () => {
    const hash = await hashPassword("demo-demo");
    expect(await verifyPassword("demo-demo", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("byok", () => {
  test("aes-gcm roundtrip 與 allowlist", async () => {
    const enc = await encryptKey({ BYOK_ENC_KEY: "k" } as never, "sk-or-v1-abcdefgh");
    expect(enc).not.toContain("sk-or");
    expect(await decryptKey({ BYOK_ENC_KEY: "k" } as never, enc)).toBe("sk-or-v1-abcdefgh");
    expect(isAllowedProvider("openrouter")).toBe(true);
    expect(isAllowedProvider("evil")).toBe(false);
  });
});

describe("catalog", () => {
  test("mock 模式只有 mock；real 模式依 env 過濾", () => {
    const mockEnv = { LLM_PROVIDER: "mock" } as never;
    expect(availableProviders(mockEnv).map((p) => p.id)).toEqual(["mock"]);
    const real = availableProviders({
      LLM_PROVIDER: "pool",
      DGX_BASE_URL: "http://dgx:8888/v1",
      OPENROUTER_API_KEY: "sk",
    } as never);
    expect(real.map((p) => p.id)).toEqual(["dgx-spark", "openrouter"]);
  });

  test("binding 條目：env.AI 存在時加入，且優先序在 rest 之後", () => {
    const real = availableProviders({
      LLM_PROVIDER: "pool",
      DGX_BASE_URL: "http://dgx:8888/v1",
      OPENROUTER_API_KEY: "sk",
      AI: { run: async () => ({}) },
    } as never);
    expect(real.map((p) => p.id)).toEqual(["dgx-spark", "openrouter", "workers-ai-5.3-flash", "workers-ai-4.7-flash"]);
  });
});

describe("messages", () => {
  test("三語在地化", () => {
    expect(localize("tos_required", "zh")).toContain("同意");
    expect(localize("tos_required", "en")).toContain("Terms");
    expect(localize("tos_required", "es")).toContain("Términos");
  });
});

describe("mock socrates", () => {
  test("回覆包含挑戰語氣且非空", () => {
    const reply = mockSocratesReply("我認為效益最大", 3);
    expect(reply.length).toBeGreaterThan(8);
    expect(openingMessage("電車難題")).toContain("電車難題");
  });
});
