import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { run } from "../src/db/d1";
import { issueSessionToken } from "../src/auth";
import { call, cookieOf, str } from "./helpers";

const migrations = inject("d1Migrations");
const json = { "Content-Type": "application/json" };

async function signup(password = "password-1", email?: string): Promise<{ id: string; session: string }> {
  const address = email ?? `password-change-${crypto.randomUUID()}@socrates.tw`;
  const res = await call("/api/auth/signup", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: address, password, name: "密碼測試", tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const id = str(await res.json(), "id");
  return { id, session: cookieOf(res) };
}

async function verifyEmailOf(userId: string): Promise<void> {
  await run(env.DB, "UPDATE users SET email_verified_at = $at WHERE id = $id AND email_verified_at IS NULL", {
    id: userId,
    at: new Date().toISOString(),
  });
}

function changePassword(session: string, currentPassword: string, newPassword: string): Promise<Response> {
  return call("/api/me/password", {
    method: "POST",
    headers: { ...json, Cookie: session },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

function meOf(session: string): Promise<Response> {
  return call("/api/me", { headers: { Cookie: session } });
}

describe("password change (#234 D4): re-verify, rotate sessions, keep current device", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, migrations);
  });

  test("correct current password rotates sessions and keeps the current device alive", async () => {
    const { id, session } = await signup();
    await verifyEmailOf(id);
    const res = await changePassword(session, "password-1", "password-2");
    expect(res.status).toBe(204);
    const fresh = cookieOf(res);
    expect(fresh).not.toBe(session);

    const renewed = await meOf(fresh);
    expect(renewed.status).toBe(200);
    expect(str(await renewed.json(), "id")).toBe(id);

    const stale = await meOf(session);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toBeNull();
  });

  test("the new password signs in on a fresh device", async () => {
    const email = `rotate-login-${crypto.randomUUID()}@socrates.tw`;
    const { id, session } = await signup("password-1", email);
    await verifyEmailOf(id);
    const changed = await changePassword(session, "password-1", "password-2");
    expect(changed.status).toBe(204);
    const res = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, password: "password-2" }),
    });
    expect(res.status).toBe(200);
    const wrong = await call("/api/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email, password: "password-1" }),
    });
    expect(wrong.status).toBe(401);
  });

  test("wrong current password is rejected and sessions survive", async () => {
    const { id, session } = await signup();
    await verifyEmailOf(id);
    const res = await changePassword(session, "wrong-password", "password-2");
    expect(res.status).toBe(401);
    expect(str(await res.json(), "code")).toBe("invalid_credentials");
    const me = await meOf(session);
    expect(me.status).toBe(200);
    expect(str(await me.json(), "id")).toBe(id);
  });

  test("SSO-only accounts (no password) are rejected", async () => {
    const id = `u_sso_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await run(env.DB, "INSERT INTO users (id, name, lang, created_at) VALUES ($id, '純SSO', 'zh', $at)", {
      id,
      at: new Date().toISOString(),
    });
    const token = await issueSessionToken({ env }, { id, name: "純SSO", isAdmin: false, emailVerified: false }, 0);
    const res = await call("/api/me/password", {
      method: "POST",
      headers: { ...json, Cookie: `socrates_session=${token}` },
      body: JSON.stringify({ currentPassword: "password-1", newPassword: "password-2" }),
    });
    expect(res.status).toBe(409);
    expect(str(await res.json(), "code")).toBe("password_not_set");
  });

  test("weak new passwords fail validation", async () => {
    const { id, session } = await signup();
    await verifyEmailOf(id);
    const res = await changePassword(session, "password-1", "short");
    expect(res.status).toBe(422);
  });

  test("unverified accounts stay behind the hard gate (#437)", async () => {
    const { session } = await signup();
    const res = await changePassword(session, "password-1", "password-2");
    expect(res.status).toBe(403);
    expect(str(await res.json(), "code")).toBe("email_unverified");
  });

  test("a session is required", async () => {
    const res = await call("/api/me/password", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ currentPassword: "password-1", newPassword: "password-2" }),
    });
    expect(res.status).toBe(401);
  });
});
