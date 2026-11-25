import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { hashPassword, passwordResetBinding, sealAccountToken } from "../src/auth";
import { one, run } from "../src/db/d1";
import type { RateLimiter } from "../src/do/rate-limiter";
import type { Env } from "../src/env";
import { call, callWith, must, str } from "./helpers";

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

function limiter(key: string): DurableObjectStub<RateLimiter> {
  return env.RateLimiter.get(env.RateLimiter.idFromName(key));
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
    const unavailable: Env["RateLimiter"] = new Proxy(env.RateLimiter, {
      get() {
        throw new Error("limiter unavailable");
      },
    });
    const response = await callWith({ RateLimiter: unavailable }, "/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.158" },
      body: JSON.stringify({ token: "not-a-token", password: "new-password-1" }),
    });
    expect(response.status).toBe(400);
  });
});

function loginRequest(email: string, password: string, ip?: string): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ip) headers["CF-Connecting-IP"] = ip;
  return { method: "POST", headers, body: JSON.stringify({ email, password }) };
}

async function seedAccount(password = "correct-pass-1"): Promise<{ id: string; email: string }> {
  const id = `u_${crypto.randomUUID()}`;
  const email = `lockout-${crypto.randomUUID()}@example.com`;
  await run(
    env.DB,
    "INSERT INTO users (id, name, email, password_hash, lang, created_at) VALUES ($id, $name, $email, $hash, 'zh', $at)",
    { id, name: "鎖定測試", email, hash: await hashPassword(password), at: new Date().toISOString() },
  );
  return { id, email };
}

describe("per-identifier lockout (#393)", () => {
  it("supports check, record, clear, and window expiry per key on a single DO shard", async () => {
    const stub = limiter(keyOf("shard"));
    const k1 = `k1-${crypto.randomUUID()}`;
    const k2 = `k2-${crypto.randomUUID()}`;

    expect(await stub.check(k1, 2, 60_000)).toBe(true);
    expect(await stub.check(k1, 2, 60_000)).toBe(true);
    await stub.record(k1, 60_000);
    expect(await stub.check(k1, 2, 60_000)).toBe(true);
    await stub.record(k1, 60_000);
    expect(await stub.check(k1, 2, 60_000)).toBe(false);
    expect(await stub.check(k2, 2, 60_000)).toBe(true);

    await stub.clear(k1);
    expect(await stub.check(k1, 2, 60_000)).toBe(true);

    const shortKey = `short-${crypto.randomUUID()}`;
    await stub.record(shortKey, 15);
    expect(await stub.check(shortKey, 1, 15)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(await stub.check(shortKey, 1, 15)).toBe(true);
  });

  it("atomically gates keyed allowKey calls and sweeps expired entries past 1024 keys", async () => {
    const stub = limiter(keyOf("shard"));
    const key = `allow-${crypto.randomUUID()}`;
    expect(await stub.allowKey(key, 1, 60_000)).toBe(true);
    expect(await stub.allowKey(key, 1, 60_000)).toBe(false);
    expect(await stub.allowKey(`other-${crypto.randomUUID()}`, 1, 60_000)).toBe(true);

    for (let i = 0; i < 1030; i += 1) {
      await stub.record(`spray-${i}`, 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    await stub.record("trigger-sweep", 60_000);
    expect(await stub.check(key, 1, 60_000)).toBe(false);
  });

  it("locks out an account after 10 failures across distinct IPs and mixed email casing", async () => {
    const { email } = await seedAccount("valid-pass-1");
    for (let i = 0; i < 10; i += 1) {
      const target = i % 2 === 0 ? email : email.toUpperCase();
      const res = await call("/api/auth/login", loginRequest(target, "wrong-pass-1", `198.51.100.${i + 1}`));
      expect(res.status).toBe(401);
    }

    const blocked = await call("/api/auth/login", loginRequest(email, "valid-pass-1", "198.51.100.99"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeNull();
    expect(str(await blocked.json(), "code")).toBe("rate_limited");
  });

  it("applies the same lockout threshold to unknown emails to avoid existence oracles", async () => {
    const ghost = `ghost-${crypto.randomUUID()}@example.com`;
    for (let i = 0; i < 10; i += 1) {
      const res = await call("/api/auth/login", loginRequest(ghost, "wrong-pass-1", `203.0.113.${i + 1}`));
      expect(res.status).toBe(401);
    }
    const blocked = await call("/api/auth/login", loginRequest(ghost, "wrong-pass-1", "203.0.113.99"));
    expect(blocked.status).toBe(429);
    expect(str(await blocked.json(), "code")).toBe("rate_limited");
  });

  it("clears failed login count after a successful login", async () => {
    const { email } = await seedAccount("valid-pass-1");
    for (let i = 0; i < 9; i += 1) {
      expect((await call("/api/auth/login", loginRequest(email, "wrong-pass-1", `198.51.100.${i + 20}`))).status).toBe(
        401,
      );
    }
    expect((await call("/api/auth/login", loginRequest(email, "valid-pass-1", "198.51.100.40"))).status).toBe(200);
    for (let i = 0; i < 9; i += 1) {
      expect((await call("/api/auth/login", loginRequest(email, "wrong-pass-1", `198.51.100.${i + 50}`))).status).toBe(
        401,
      );
    }
  });

  it("does not count disabled accounts with a valid password as failed logins", async () => {
    const { id, email } = await seedAccount("valid-pass-1");
    await run(env.DB, "UPDATE users SET disabled_at = $at WHERE id = $id", { id, at: new Date().toISOString() });

    for (let i = 0; i < 11; i += 1) {
      const res = await call("/api/auth/login", loginRequest(email, "valid-pass-1", `198.51.100.${i + 70}`));
      expect(res.status).toBe(403);
      expect(str(await res.json(), "code")).toBe("account_disabled");
    }
  });

  it("clears login lockout when password reset succeeds", async () => {
    const { id, email } = await seedAccount("old-pass-1");
    for (let i = 0; i < 10; i += 1) {
      expect((await call("/api/auth/login", loginRequest(email, "wrong-pass-1", `198.51.100.${i + 100}`))).status).toBe(
        401,
      );
    }
    expect((await call("/api/auth/login", loginRequest(email, "old-pass-1", "198.51.100.120"))).status).toBe(429);

    const row = must(
      await one<{ password_hash: string; email: string }>(
        env.DB,
        "SELECT password_hash, email FROM users WHERE id = $id",
        { id },
      ),
      "seeded user",
    );
    const token = await sealAccountToken(
      { env },
      "password_reset",
      id,
      passwordResetBinding(row.password_hash, row.email),
      30 * 60_000,
    );
    const resetRes = await call("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "fresh-pass-1" }),
    });
    expect(resetRes.status).toBe(204);

    expect((await call("/api/auth/login", loginRequest(email, "fresh-pass-1", "198.51.100.121"))).status).toBe(200);
  });

  it("falls open on login when the RateLimiter DO is unreachable", async () => {
    const { email } = await seedAccount("valid-pass-1");
    const unavailable: Env["RateLimiter"] = new Proxy(env.RateLimiter, {
      get() {
        throw new Error("limiter unavailable");
      },
    });
    const wrong = await callWith(
      { RateLimiter: unavailable },
      "/api/auth/login",
      loginRequest(email, "wrong-pass-1", "203.0.113.200"),
    );
    expect(wrong.status).toBe(401);
    const ok = await callWith(
      { RateLimiter: unavailable },
      "/api/auth/login",
      loginRequest(email, "valid-pass-1", "203.0.113.201"),
    );
    expect(ok.status).toBe(200);
  });
});
