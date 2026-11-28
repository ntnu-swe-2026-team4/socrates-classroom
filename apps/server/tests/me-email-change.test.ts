import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { one, run } from "../src/db/d1";
import { issueSessionToken } from "../src/auth";
import { call, must, scopedEnv, str, workerFetch } from "./helpers";

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const migrations = inject("d1Migrations");
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
});

function mailbox(): { sent: SentEmail[]; request: Request } {
  const sent: SentEmail[] = [];
  const scoped = scopedEnv({
    ALERT_FROM_EMAIL: "noreply@socrates.test",
    SEND_EMAIL: {
      send: async (message: SentEmail) => {
        sent.push(message);
        return { messageId: "m" };
      },
    },
  });
  const request: Request = async (path, init = {}) => {
    const pending: Promise<unknown>[] = [];
    const res = await workerFetch(scoped, new Request(`http://worker.test${path}`, init), (promise) => {
      pending.push(promise);
    });
    await Promise.all(pending);
    return res;
  };
  return { sent, request };
}

async function signupAt(email: string): Promise<{ id: string; session: string }> {
  const res = await call("/api/auth/signup", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: "password-1", name: "換信測試", tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const id = str(await res.json(), "id");
  await run(env.DB, "UPDATE users SET email_verified_at = $at WHERE id = $id AND email_verified_at IS NULL", {
    id,
    at: new Date().toISOString(),
  });
  return { id, session: must(res.headers.getSetCookie()[0]?.split(";")[0], "session cookie") };
}

async function reauthOf(session: string): Promise<string> {
  const res = await call("/api/auth/reauth/password", {
    method: "POST",
    headers: { ...json, Cookie: session },
    body: JSON.stringify({ password: "password-1" }),
  });
  expect(res.status).toBe(200);
  return reauthCookie(res);
}

function reauthCookie(res: Response): string {
  return must(
    res.headers
      .getSetCookie()
      .find((line) => line.startsWith("socrates_reauth="))
      ?.split(";")[0],
    "reauth cookie",
  );
}

async function requestChange(request: Request, session: string, email: string, reauth: string): Promise<Response> {
  return request("/api/me/email/change", {
    method: "POST",
    headers: { ...json, Cookie: `${session}; ${reauth}` },
    body: JSON.stringify({ email }),
  });
}

function tokenOf(mail: SentEmail, fragment: string): string {
  const match = mail.text.match(new RegExp(`${fragment}=([^\\s]+)`));
  return must(match?.[1], `token in mail fragment ${fragment}`);
}

describe("email change (#463: pending_email, dual mails, atomic promote)", () => {
  test("request keeps users.email intact and sends verify+notice mails", async () => {
    const { request, sent } = mailbox();
    const oldEmail = `old-${crypto.randomUUID()}@example.com`;
    const newEmail = `new-${crypto.randomUUID()}@example.com`;
    const { id, session } = await signupAt(oldEmail);
    const reauth = await reauthOf(session);

    const res = await requestChange(request, session, newEmail, reauth);
    expect(res.status).toBe(204);

    const row = await one<{ email: string | null; pending_email: string | null }>(
      env.DB,
      "SELECT email, pending_email FROM users WHERE id = $id",
      { id },
    );
    expect(row?.email).toBe(oldEmail);
    expect(row?.pending_email).toBe(newEmail);

    const verifyMail = sent.find((mail) => mail.to === newEmail);
    expect(verifyMail?.text).toContain("換信測試");
    const noticeMail = sent.find((mail) => mail.to === oldEmail);
    expect(noticeMail?.text).toContain(newEmail);
  });

  test("no reauth is rejected", async () => {
    const { request } = mailbox();
    const { session } = await signupAt(`noreauth-${crypto.randomUUID()}@example.com`);
    const res = await request("/api/me/email/change", {
      method: "POST",
      headers: { ...json, Cookie: session },
      body: JSON.stringify({ email: `x-${crypto.randomUUID()}@example.com` }),
    });
    expect(res.status).toBe(403);
    expect(str(await res.json(), "code")).toBe("reauth_required");
  });

  test("verify promotes atomically; old sessions survive; old address loses login", async () => {
    const { request, sent } = mailbox();
    const oldEmail = `promote-old-${crypto.randomUUID()}@example.com`;
    const newEmail = `promote-new-${crypto.randomUUID()}@example.com`;
    const { id, session } = await signupAt(oldEmail);
    const reauth = await reauthOf(session);
    await requestChange(request, session, newEmail, reauth);
    const verifyMail = must(
      sent.find((mail) => mail.to === newEmail),
      "verify mail",
    );

    const verified = await request("/api/auth/email/change/verify", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: tokenOf(verifyMail, "#change") }),
    });
    expect(verified.status).toBe(204);

    const row = await one<{ email: string | null; pending_email: string | null; email_verified_at: string | null }>(
      env.DB,
      "SELECT email, pending_email, email_verified_at FROM users WHERE id = $id",
      { id },
    );
    expect(row?.email).toBe(newEmail);
    expect(row?.pending_email).toBeNull();
    expect(row?.email_verified_at).not.toBeNull();

    const me = await request("/api/me", { headers: { Cookie: session } });
    expect(me.status).toBe(200);
    expect(str(await me.json(), "id")).toBe(id);

    const loginNew = await request("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: newEmail, password: "password-1" }),
    });
    expect(loginNew.status).toBe(200);
    const loginOld = await request("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: oldEmail, password: "password-1" }),
    });
    expect(loginOld.status).toBe(401);

    const replay = await request("/api/auth/email/change/verify", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: tokenOf(verifyMail, "#change") }),
    });
    expect(replay.status).toBe(400);
  });

  test("an address owned by another account is rejected", async () => {
    const { request } = mailbox();
    const target = `taken-target-${crypto.randomUUID()}@example.com`;
    await signupAt(target);
    const { session } = await signupAt(`taken-old-${crypto.randomUUID()}@example.com`);
    const reauth = await reauthOf(session);
    const res = await requestChange(request, session, target, reauth);
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("email_taken");
  });

  test("a pending claim blocks signup within its window and lapses after", async () => {
    const { request } = mailbox();
    const claimed = `squat-target-${crypto.randomUUID()}@example.com`;
    const { session } = await signupAt(`squat-old-${crypto.randomUUID()}@example.com`);
    const reauth = await reauthOf(session);
    await requestChange(request, session, claimed, reauth);

    const blocked = await request("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: claimed, password: "password-2", name: "搶註冊", tosAccepted: true }),
    });
    expect(blocked.status).toBe(409);

    await run(env.DB, "UPDATE users SET pending_email_at = $at WHERE pending_email = $email", {
      email: claimed,
      at: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    const after = await request("/api/auth/signup", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: claimed, password: "password-2", name: "搶註冊", tosAccepted: true }),
    });
    expect(after.status).toBe(200);
  });

  test("cancel by token clears the pending claim; a late verify fails", async () => {
    const { request, sent } = mailbox();
    const oldEmail = `cancel-old-${crypto.randomUUID()}@example.com`;
    const newEmail = `cancel-new-${crypto.randomUUID()}@example.com`;
    const { session } = await signupAt(oldEmail);
    const reauth = await reauthOf(session);
    await requestChange(request, session, newEmail, reauth);
    const notice = must(
      sent.find((mail) => mail.to === oldEmail),
      "notice mail",
    );

    const cancelled = await request("/api/me/email/change/cancel", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: tokenOf(notice, "#cancel") }),
    });
    expect(cancelled.status).toBe(204);

    const verifyMail = must(
      sent.find((mail) => mail.to === newEmail),
      "verify mail",
    );
    const late = await request("/api/auth/email/change/verify", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: tokenOf(verifyMail, "#change") }),
    });
    expect(late.status).toBe(400);

    const garbage = await request("/api/me/email/change/cancel", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: "not-a-token" }),
    });
    expect(garbage.status).toBe(400);
  });

  test("cancel with session+reauth clears the claim", async () => {
    const { request } = mailbox();
    const oldEmail = `sc-old-${crypto.randomUUID()}@example.com`;
    const newEmail = `sc-new-${crypto.randomUUID()}@example.com`;
    const { session } = await signupAt(oldEmail);
    const reauth = await reauthOf(session);
    await requestChange(request, session, newEmail, reauth);
    const res = await request("/api/me/email/change/cancel", {
      method: "POST",
      headers: { ...json, Cookie: `${session}; ${reauth}` },
      body: "{}",
    });
    expect(res.status).toBe(204);
    const row = await one<{ pending_email: string | null }>(
      env.DB,
      "SELECT pending_email FROM users WHERE email = $email",
      { email: oldEmail },
    );
    expect(row?.pending_email).toBeNull();
  });

  test("SSO-only accounts are directed to the bind flow (#138)", async () => {
    const { request } = mailbox();
    const id = `u_sso_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await run(env.DB, "INSERT INTO users (id, name, lang, created_at) VALUES ($id, '純SSO', 'zh', $at)", {
      id,
      at: new Date().toISOString(),
    });
    await run(
      env.DB,
      "INSERT INTO user_identities (provider, provider_user_id, user_id, email, created_at) VALUES ('google', $pid, $id, NULL, $at)",
      { pid: id, id, at: new Date().toISOString() },
    );
    const token = await issueSessionToken({ env }, { id, name: "純SSO", isAdmin: false, emailVerified: false }, 0);
    const res = await request("/api/me/email/change", {
      method: "POST",
      headers: { ...json, Cookie: `socrates_session=${token}` },
      body: JSON.stringify({ email: `sso-${crypto.randomUUID()}@example.com` }),
    });
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("email_not_set");
  });

  test("changing to the current email is a no-op without mails", async () => {
    const { request, sent } = mailbox();
    const email = `noop-${crypto.randomUUID()}@example.com`;
    const { session } = await signupAt(email);
    const reauth = await reauthOf(session);
    const res = await requestChange(request, session, email, reauth);
    expect(res.status).toBe(204);
    expect(sent.length).toBe(0);
  });
});
