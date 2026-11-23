import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import worker from "../src/index";
import { one, run } from "../src/db/d1";
import { type AccountTokenPurpose, emailVerifyBinding, issueSessionToken, sealAccountToken } from "../src/auth";
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
  return `verify-${crypto.randomUUID()}@example.com`;
}

async function signup(m: Mailbox, email: string, lang = "zh-TW") {
  const before = m.sent.length;
  const res = await m.post(
    "/api/auth/signup",
    { email, password: "verify-pass-1", name: "驗證測試", tosAccepted: true },
    { "Accept-Language": lang },
  );
  expect(res.status).toBe(200);
  const user = (await res.json()) as { id: string; emailVerified: boolean };
  const mails = m.sent.slice(before);
  return { id: user.id, emailVerified: user.emailVerified, cookie: cookieOf(res), mail: mails.at(-1) };
}

function tokenOf(mail: SentEmail): string {
  return must(/#token=([A-Za-z0-9_\-.]+)/.exec(mail.text), "verify token")[1];
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

const verify = (m: Mailbox, token: string) => m.post("/api/auth/email/verify", { token });

async function me(m: Mailbox, cookie: string): Promise<{ emailVerified: boolean } | null> {
  return (await (await m.request("/api/me", { headers: { Cookie: cookie } })).json()) as {
    emailVerified: boolean;
  } | null;
}

async function sessionCookie(userId: string): Promise<string> {
  const token = await issueSessionToken({ env }, { id: userId, name: "SSO", isAdmin: false, emailVerified: true }, 0);
  return `socrates_session=${token}`;
}

async function sealVerifyToken(userId: string, ttlMs: number): Promise<string> {
  const row = must(
    await one<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = $id", { id: userId }),
    "user",
  );
  return sealAccountToken({ env }, "email_verify" as AccountTokenPurpose, userId, emailVerifyBinding(row.email), ttlMs);
}

async function classroomCode(m: Mailbox): Promise<{ code: string; cookie: string }> {
  const teacher = await signup(m, freshEmail());
  const created = await m.request("/api/classrooms", {
    method: "POST",
    headers: { ...json, Cookie: teacher.cookie },
    body: JSON.stringify({ name: "驗證班" }),
  });
  expect(created.status).toBe(201);
  const classroom = (await created.json()) as { classroomId: string; code: string };
  const topic = await m.request("/api/topics", {
    method: "POST",
    headers: { ...json, Cookie: teacher.cookie },
    body: JSON.stringify({
      title: "信箱驗證是否值得多一步？",
      statement: "註冊時就要證明信箱是自己的，還是先用再說？",
      prompts: ["你會怎麼查證？"],
    }),
  });
  expect(topic.status).toBe(201);
  const started = await m.request(`/api/classrooms/${classroom.classroomId}/activities`, {
    method: "POST",
    headers: { ...json, Cookie: teacher.cookie },
    body: JSON.stringify({ topicId: ((await topic.json()) as { id: string }).id, mode: "live" }),
  });
  expect(started.status).toBe(201);
  return { code: classroom.code, cookie: teacher.cookie };
}

describe("email verification (#259)", () => {
  test("signup mails the verification link and the account starts unverified", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email);

    expect(account.emailVerified).toBe(false);
    const mail = must(account.mail, "verification mail");
    expect(mail.to).toBe(email);
    expect(mail.from).toBe("noreply@socrates.test");
    expect(mail.text).toContain(`${BASE}/verify-email#token=`);
    expect(await me(m, account.cookie)).toEqual({
      id: account.id,
      name: "驗證測試",
      isAdmin: false,
      emailVerified: false,
    });
  });

  test("classroom-code register mails the verification link too", async () => {
    const m = mailbox();
    const { code } = await classroomCode(m);
    const before = m.sent.length;
    const email = freshEmail();

    const res = await m.post("/api/auth/register", {
      code,
      email,
      password: "verify-pass-1",
      name: "班級驗證生",
      tosAccepted: true,
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { emailVerified: boolean }).toMatchObject({ emailVerified: false });
    const mail = must(m.sent.slice(before).at(-1), "verification mail");
    expect(mail.to).toBe(email);
    expect(mail.text).toContain("/verify-email#token=");
  });

  test("clicking the link verifies the account; a second click stays 204", async () => {
    const m = mailbox();
    const account = await signup(m, freshEmail());
    const token = tokenOf(must(account.mail, "verification mail"));

    expect((await verify(m, token)).status).toBe(204);
    expect((await me(m, account.cookie))?.emailVerified).toBe(true);
    expect((await verify(m, token)).status).toBe(204);
  });

  test("expired, tampered or malformed links → 400 verify_token_invalid and the account stays unverified", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email);
    const token = tokenOf(must(account.mail, "verification mail"));
    const expired = await sealVerifyToken(account.id, -60_000);
    const [payload, signature] = token.split(".") as [string, string];
    const flipped = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    for (const bad of [expired, flipped, "not-a-token", ""]) {
      const res = await verify(m, bad);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("verify_token_invalid");
    }
    expect((await me(m, account.cookie))?.emailVerified).toBe(false);
  });

  test("email changed or account disabled after the link was mailed → 400 verify_token_invalid", async () => {
    const m = mailbox();
    const changed = await signup(m, freshEmail());
    const changedToken = tokenOf(must(changed.mail, "verification mail"));
    await run(env.DB, "UPDATE users SET email = $email WHERE id = $id", { id: changed.id, email: freshEmail() });

    const disabled = await signup(m, freshEmail());
    const disabledToken = tokenOf(must(disabled.mail, "verification mail"));
    await run(env.DB, "UPDATE users SET disabled_at = $at WHERE id = $id", {
      id: disabled.id,
      at: new Date().toISOString(),
    });

    for (const token of [changedToken, disabledToken]) {
      const res = await verify(m, token);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("verify_token_invalid");
    }
  });

  test("verify and password-reset tokens stay separate", async () => {
    const m = mailbox();
    const email = freshEmail();
    const account = await signup(m, email);
    const verifyToken = tokenOf(must(account.mail, "verification mail"));

    const resetWithVerify = await m.post("/api/auth/password/reset", {
      token: verifyToken,
      password: "reset-pass-1",
    });
    expect(resetWithVerify.status).toBe(400);
    expect(await codeOf(resetWithVerify)).toBe("reset_token_invalid");

    const before = m.sent.length;
    await m.post("/api/auth/password/forgot", { email });
    const resetToken = tokenOf(must(m.sent.slice(before).at(-1), "reset mail"));

    const verifyWithReset = await verify(m, resetToken);
    expect(verifyWithReset.status).toBe(400);
    expect(await codeOf(verifyWithReset)).toBe("verify_token_invalid");
    expect((await me(m, account.cookie))?.emailVerified).toBe(false);
  });

  test("mail template follows users.lang: zh / en / es each get their own subject", async () => {
    const m = mailbox();
    for (const lang of ["zh-TW", "en", "es"]) {
      await signup(m, freshEmail(), lang);
    }

    const subjects = m.sent.map((mail) => mail.subject);
    expect(subjects.every((subject) => subject.length > 0)).toBe(true);
    expect(new Set(subjects).size).toBe(3);
  });

  test("missing or failing mail binding → signup still 200 (fail-open)", async () => {
    for (const delivery of ["missing", "failing"] as const) {
      const m = mailbox(delivery);
      const res = await m.post("/api/auth/signup", {
        email: freshEmail(),
        password: "verify-pass-1",
        name: "寄不出去",
        tosAccepted: true,
      });
      expect(res.status).toBe(200);
      expect(m.sent).toHaveLength(0);
    }
  });
});

describe("verification resend (#259)", () => {
  test("requires a session", async () => {
    const m = mailbox();
    const res = await m.post("/api/auth/email/verify/resend", {});
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe("unauthorized");
  });

  test("unverified account → one new mail, still 204; verified account → 204 with no mail", async () => {
    const m = mailbox();
    const account = await signup(m, freshEmail());
    const before = m.sent.length;

    const resent = await m.post("/api/auth/email/verify/resend", {}, { Cookie: account.cookie });
    expect(resent.status).toBe(204);
    expect(m.sent).toHaveLength(before + 1);

    const token = tokenOf(must(m.sent.at(-1), "resent mail"));
    expect((await verify(m, token)).status).toBe(204);

    const afterVerified = await m.post("/api/auth/email/verify/resend", {}, { Cookie: account.cookie });
    expect(afterVerified.status).toBe(204);
    expect(m.sent).toHaveLength(before + 1);
  });

  test("SSO-style account without users.email → 409 email_not_set", async () => {
    const m = mailbox();
    const id = `u_${crypto.randomUUID()}`;
    await run(env.DB, "INSERT INTO users (id, name, lang, created_at) VALUES ($id, $name, 'zh', $at)", {
      id,
      name: "SSO",
      at: new Date().toISOString(),
    });

    const res = await m.post("/api/auth/email/verify/resend", {}, { Cookie: await sessionCookie(id) });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("email_not_set");
  });

  test("calls 1-5 → 204, the 6th inside one minute → 429 rate_limited", async () => {
    const m = mailbox();
    const account = await signup(m, freshEmail());
    const headers = { Cookie: account.cookie, "CF-Connecting-IP": "198.51.100.259" };
    let last: Response | null = null;
    for (let i = 0; i < 6; i += 1) {
      last = await m.post("/api/auth/email/verify/resend", {}, headers);
      if (i < 5) expect(last.status).toBe(204);
    }
    expect(last?.status).toBe(429);
    expect(await codeOf(must(last, "rate-limit response"))).toBe("rate_limited");
  });
});
