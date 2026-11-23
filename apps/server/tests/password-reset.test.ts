import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import worker from "../src/index";
import { one, run } from "../src/db/d1";
import { type AccountTokenPurpose, hashPassword, passwordResetBinding, sealAccountToken } from "../src/auth";
import { cookieOf, must, scopedEnv } from "./helpers";

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

const json = { "Content-Type": "application/json" };
const BASE = "https://socrates.test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("d1Migrations"));
});

type Delivery = "delivered" | "missing" | "failing";

function mailbox(delivery: Delivery = "delivered") {
  const sent: SentEmail[] = [];
  const binding = {
    send: async (message: SentEmail) => {
      if (delivery === "failing") throw new Error("send failed");
      sent.push(message);
      return { messageId: "m" };
    },
  };
  const scoped = scopedEnv({
    SEND_EMAIL: delivery === "missing" ? undefined : binding,
    ALERT_FROM_EMAIL: "noreply@socrates.test",
    PUBLIC_BASE_URL: BASE,
  });
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const pending: Promise<unknown>[] = [];
    const res = await (
      worker as unknown as { fetch(req: Request, env: unknown, ctx: unknown): Promise<Response> }
    ).fetch(new Request(`http://worker.test${path}`, init), scoped, {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
    return res;
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
  return { sent, request, post };
}

type Mailbox = ReturnType<typeof mailbox>;

function freshEmail(): string {
  return `reset-${crypto.randomUUID()}@example.com`;
}

async function signup(m: Mailbox, email: string, password: string, lang = "zh-TW") {
  const res = await m.post(
    "/api/auth/signup",
    { email, password, name: "重設測試", tosAccepted: true },
    { "Accept-Language": lang },
  );
  expect(res.status).toBe(200);
  const user = (await res.json()) as { id: string };
  return { id: user.id, cookie: cookieOf(res) };
}

function tokenOf(mail: SentEmail): string {
  const match = must(/#token=([A-Za-z0-9_\-.]+)/.exec(mail.text), "reset token");
  return match[1];
}

async function requestLink(m: Mailbox, email: string): Promise<string> {
  const before = m.sent.length;
  const res = await m.post("/api/auth/password/forgot", { email });
  expect(res.status).toBe(204);
  expect(m.sent).toHaveLength(before + 1);
  return tokenOf(must(m.sent.at(-1), "latest email"));
}

const reset = (m: Mailbox, token: string, password: string) => m.post("/api/auth/password/reset", { token, password });

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

async function loginStatus(m: Mailbox, email: string, password: string): Promise<number> {
  return (await m.post("/api/auth/login", { email, password })).status;
}

async function bindingOf(id: string): Promise<string> {
  const row = await one<{ password_hash: string; email: string }>(
    env.DB,
    "SELECT password_hash, email FROM users WHERE id = $id",
    { id },
  );
  const record = must(row, "user row");
  return passwordResetBinding(record.password_hash, record.email);
}

async function sealedToken(purpose: string, uid: string, ttlMs: number): Promise<string> {
  return sealAccountToken({ env }, purpose as AccountTokenPurpose, uid, await bindingOf(uid), ttlMs);
}

describe("password reset (#230)", () => {
  test("forgot for an email account → 204 and one mail carrying the reset link", async () => {
    const m = mailbox();
    const email = freshEmail();
    await signup(m, email, "old-password-1");

    const res = await m.post("/api/auth/password/forgot", { email: email.toUpperCase() });

    expect(res.status).toBe(204);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to).toBe(email);
    expect(m.sent[0].from).toBe("noreply@socrates.test");
    expect(m.sent[0].text).toContain(`${BASE}/reset-password#token=`);
  });

  test("forgot for unknown, passwordless and disabled accounts → 204 and no mail", async () => {
    const m = mailbox();
    const passwordless = freshEmail();
    await run(env.DB, "INSERT INTO users (id, name, email, lang, created_at) VALUES ($id, $name, $email, 'zh', $at)", {
      id: `u_${crypto.randomUUID()}`,
      name: "無密碼",
      email: passwordless,
      at: new Date().toISOString(),
    });
    const disabled = freshEmail();
    const account = await signup(m, disabled, "old-password-1");
    await run(env.DB, "UPDATE users SET disabled_at = $at WHERE id = $id", {
      id: account.id,
      at: new Date().toISOString(),
    });

    for (const email of [freshEmail(), passwordless, disabled]) {
      const res = await m.post("/api/auth/password/forgot", { email });
      expect(res.status).toBe(204);
    }
    expect(m.sent).toHaveLength(0);
  });

  test("reset → 204, old password 401, new password 200; reusing the link → 400 reset_token_invalid", async () => {
    const m = mailbox();
    const email = freshEmail();
    await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);

    expect((await reset(m, token, "new-password-1")).status).toBe(204);
    expect(await loginStatus(m, email, "old-password-1")).toBe(401);
    expect(await loginStatus(m, email, "new-password-1")).toBe(200);

    const again = await reset(m, token, "newer-password-1");
    expect(again.status).toBe(400);
    expect(await codeOf(again)).toBe("reset_token_invalid");
  });

  test("two links outstanding: using one → the other 400 reset_token_invalid", async () => {
    const m = mailbox();
    const email = freshEmail();
    await signup(m, email, "old-password-1");
    const first = await requestLink(m, email);
    const second = await requestLink(m, email);

    expect((await reset(m, first, "new-password-1")).status).toBe(204);
    const stale = await reset(m, second, "other-password-1");
    expect(stale.status).toBe(400);
    expect(await codeOf(stale)).toBe("reset_token_invalid");
  });

  test("concurrent resets with one link → exactly one 204, the other 400", async () => {
    const m = mailbox();
    const email = freshEmail();
    await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);

    const results = await Promise.all([reset(m, token, "first-password-1"), reset(m, token, "second-password-1")]);

    expect(results.map((res) => res.status).sort()).toEqual([204, 400]);
  });

  test("reset bumps session_version → an existing session reads /me as null", async () => {
    const m = mailbox();
    const email = freshEmail();
    const { cookie } = await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);

    expect((await reset(m, token, "new-password-1")).status).toBe(204);

    const me = await m.request("/api/me", { headers: { Cookie: cookie } });
    expect(await me.json()).toBeNull();
  });

  test("expired link → 400 reset_token_invalid", async () => {
    const m = mailbox();
    const account = await signup(m, freshEmail(), "old-password-1");
    const token = await sealedToken("password_reset", account.id, -60_000);

    const res = await reset(m, token, "new-password-1");

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("reset_token_invalid");
  });

  test("tampered or malformed links → 400 reset_token_invalid and the targeted account is untouched", async () => {
    const m = mailbox();
    const victim = freshEmail();
    const victimAccount = await signup(m, victim, "old-password-1");
    const attacker = freshEmail();
    await signup(m, attacker, "old-password-1");
    const token = await requestLink(m, attacker);
    const [payload, signature] = token.split(".") as [string, string];
    const decoded = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;
    const forged = btoa(JSON.stringify({ ...decoded, uid: victimAccount.id }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const flipped = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    for (const bad of [`${forged}.${signature}`, flipped, "not-a-token", ""]) {
      const res = await reset(m, bad, "new-password-1");
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("reset_token_invalid");
    }
    expect(await loginStatus(m, victim, "old-password-1")).toBe(200);
  });

  test("link signed for another purpose → 400 reset_token_invalid", async () => {
    const m = mailbox();
    const account = await signup(m, freshEmail(), "old-password-1");
    const token = await sealedToken("email_verify", account.id, 30 * 60_000);

    const res = await reset(m, token, "new-password-1");

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("reset_token_invalid");
  });

  test("password changed elsewhere → outstanding links 400 reset_token_invalid", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);
    await run(env.DB, "UPDATE users SET password_hash = $hash WHERE id = $id", {
      id: account.id,
      hash: await hashPassword("changed-elsewhere-1"),
    });

    const res = await reset(m, token, "new-password-1");

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("reset_token_invalid");
  });

  test("email changed elsewhere → outstanding links 400 reset_token_invalid", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);
    await run(env.DB, "UPDATE users SET email = $email WHERE id = $id", { id: account.id, email: freshEmail() });

    const res = await reset(m, token, "new-password-1");

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("reset_token_invalid");
  });

  test("new password under the signup minimum → 422, the link stays usable", async () => {
    const m = mailbox();
    const email = freshEmail();
    await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);

    expect((await reset(m, token, "short")).status).toBe(422);
    expect((await reset(m, token, "new-password-1")).status).toBe(204);
  });

  test("mail template follows users.lang: zh / en / es each get their own subject", async () => {
    const m = mailbox();

    for (const lang of ["zh-TW", "en", "es"]) {
      const email = freshEmail();
      await signup(m, email, "old-password-1", lang);
      await requestLink(m, email);
    }

    const subjects = m.sent.map((mail) => mail.subject);
    expect(subjects.every((subject) => subject.length > 0)).toBe(true);
    expect(new Set(subjects).size).toBe(3);
  });

  test("account disabled after the link was mailed → 400 reset_token_invalid", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email, "old-password-1");
    const token = await requestLink(m, email);
    await run(env.DB, "UPDATE users SET disabled_at = $at WHERE id = $id", {
      id: account.id,
      at: new Date().toISOString(),
    });

    const res = await reset(m, token, "new-password-1");

    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("reset_token_invalid");
  });

  test("missing or failing mail binding → forgot still 204 (fail-open)", async () => {
    for (const delivery of ["missing", "failing"] as const) {
      const m = mailbox(delivery);
      const email = freshEmail();
      await signup(m, email, "old-password-1");

      const res = await m.post("/api/auth/password/forgot", { email });

      expect(res.status).toBe(204);
      expect(m.sent).toHaveLength(0);
    }
  });
});

describe("password reset rate limits (#230)", () => {
  test("forgot: calls 1-5 → 204, the 6th inside one minute → 429 rate_limited", async () => {
    const m = mailbox();
    const headers = { "CF-Connecting-IP": "198.51.100.230" };
    let last: Response | null = null;
    for (let i = 0; i < 6; i += 1) {
      last = await m.post("/api/auth/password/forgot", { email: freshEmail() }, headers);
      if (i < 5) expect(last.status).toBe(204);
    }
    expect(last?.status).toBe(429);
    expect(await codeOf(must(last, "rate-limit response"))).toBe("rate_limited");
  });

  test("reset: calls 1-10 → 400, the 11th inside one minute → 429 rate_limited", async () => {
    const m = mailbox();
    const headers = { "CF-Connecting-IP": "198.51.100.231" };
    let last: Response | null = null;
    for (let i = 0; i < 11; i += 1) {
      last = await m.post("/api/auth/password/reset", { token: "not-a-token", password: "new-password-1" }, headers);
      if (i < 10) expect(last.status).toBe(400);
    }
    expect(last?.status).toBe(429);
    expect(await codeOf(must(last, "rate-limit response"))).toBe("rate_limited");
  });
});
