import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RateLimiter } from "../src/do/rate-limiter";
import type { Env } from "../src/env";
import { call, callWith } from "./helpers";

function limiter(key: string): DurableObjectStub<RateLimiter> {
  return env.RateLimiter.get(env.RateLimiter.idFromName(key)) as unknown as DurableObjectStub<RateLimiter>;
}

function keyOf(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

describe("RateLimiter DO (#157)", () => {
  it("counts one window per key regardless of which caller asks", async () => {
    const key = keyOf("login");
    expect(await limiter(key).allow(3, 60_000)).toBe(true);
    expect(await limiter(key).allow(3, 60_000)).toBe(true);
    expect(await limiter(key).allow(3, 60_000)).toBe(true);
    expect(await limiter(key).allow(3, 60_000)).toBe(false);
  });

  it("keeps scopes and IPs apart", async () => {
    const ip = crypto.randomUUID();
    expect(await limiter(`login:${ip}`).allow(1, 60_000)).toBe(true);
    expect(await limiter(`login:${ip}`).allow(1, 60_000)).toBe(false);
    expect(await limiter(`register:${ip}`).allow(1, 60_000)).toBe(true);
    expect(await limiter(`login:${crypto.randomUUID()}`).allow(1, 60_000)).toBe(true);
  });

  it("drops hits once the window has passed", async () => {
    const key = keyOf("stt");
    expect(await limiter(key).allow(1, 10)).toBe(true);
    expect(await limiter(key).allow(1, 10)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await limiter(key).allow(1, 10)).toBe(true);
  });

  it("enforces HTTP limits through the DO window", async () => {
    const ip = "203.0.113.157";
    const init = (): RequestInit => ({
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ token: "not-a-token", password: "new-password-1" }),
    });
    for (let i = 0; i < 10; i += 1) {
      expect((await call("/api/auth/password/reset", init())).status).toBe(400);
    }
    const limited = await call("/api/auth/password/reset", init());
    expect(limited.status).toBe(429);
    expect(await limiter(`password-reset:${ip}`).allow(10, 60_000)).toBe(false);
  });

  it("falls open when the limiter is unreachable", async () => {
    const unavailable = {
      idFromName: () => {
        throw new Error("limiter unavailable");
      },
    } as unknown as Env["RateLimiter"];
    const response = await callWith({ RateLimiter: unavailable }, "/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.158" },
      body: JSON.stringify({ token: "not-a-token", password: "new-password-1" }),
    });
    expect(response.status).toBe(400);
  });
});
