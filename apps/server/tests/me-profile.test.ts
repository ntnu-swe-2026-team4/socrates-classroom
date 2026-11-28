import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { seedFixture } from "../src/seed";
import { one, run } from "../src/db/d1";
import { call, classroomWithActivity, cookieOf, field, registerStudent, str } from "./helpers";

const migrations = inject("d1Migrations");
const json = { "Content-Type": "application/json" };

async function signup(email: string, verify = true): Promise<{ id: string; session: string }> {
  const res = await call("/api/auth/signup", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: "password-1", name: email.split("@")[0], tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  const id = str(await res.json(), "id");
  if (verify) {
    await run(env.DB, "UPDATE users SET email_verified_at = $at WHERE id = $id AND email_verified_at IS NULL", {
      id,
      at: new Date().toISOString(),
    });
  }
  return { id, session: cookieOf(res) };
}

async function devLogin(email: string): Promise<string> {
  const res = await call("/api/dev/login", { method: "POST", headers: json, body: JSON.stringify({ email }) });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function profile(session: string): Promise<Record<string, unknown>> {
  const res = await call("/api/me/profile", { headers: { Cookie: session } });
  expect(res.status).toBe(200);
  const body: Record<string, unknown> = await res.json();
  return body;
}

async function patchMe(session: string, body: unknown): Promise<Response> {
  return call("/api/me", {
    method: "PATCH",
    headers: { ...json, Cookie: session },
    body: JSON.stringify(body),
  });
}

function jpegOf(payload: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, ...new Array(payload).fill(0x11), 0xff, 0xd9]);
}

async function uploadAvatar(session: string, bytes: Uint8Array): Promise<Response> {
  return call("/api/me/avatar", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", Cookie: session },
    body: bytes,
  });
}

describe("account profile (#234): read, rename, lang, avatar color token, R2 image upload", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, migrations);
    await seedFixture(env.DB);
  });

  test("GET /me/profile returns name, email, lang and a null avatar for a fresh signup", async () => {
    const { session } = await signup(`profile-read-${crypto.randomUUID()}@socrates.tw`);
    const me = await profile(session);
    expect(str(me, "name")).toContain("profile-read-");
    expect(str(me, "email")).toContain("@socrates.tw");
    expect(me.lang).toBe("zh");
    expect(me.avatar).toBeNull();
  });

  test("GET /me/profile requires a session", async () => {
    const res = await call("/api/me/profile");
    expect(res.status).toBe(401);
  });

  test("PATCH /me renames the account and GET /me reflects it", async () => {
    const { session } = await signup(`profile-rename-${crypto.randomUUID()}@socrates.tw`);
    const res = await patchMe(session, { name: "新名字" });
    expect(res.status).toBe(200);
    expect(str(await res.json(), "name")).toBe("新名字");
    const me = await call("/api/me", { headers: { Cookie: session } });
    expect(me.status).toBe(200);
    expect(str(await me.json(), "name")).toBe("新名字");
  });

  test("PATCH /me rejects empty bodies and invalid fields", async () => {
    const { session } = await signup(`profile-invalid-${crypto.randomUUID()}@socrates.tw`);
    for (const body of [{}, { name: "  " }, { name: "x".repeat(81) }, { lang: "fr" }, { avatar: "color:gold" }]) {
      const res = await patchMe(session, body);
      expect(res.status).toBe(422);
    }
  });

  test("PATCH /me sets, keeps and clears the avatar color token", async () => {
    const { session } = await signup(`profile-avatar-${crypto.randomUUID()}@socrates.tw`);
    const set = await patchMe(session, { avatar: "color:vermilion" });
    expect(set.status).toBe(200);
    expect(str(await set.json(), "avatar")).toBe("color:vermilion");
    expect((await profile(session)).avatar).toBe("color:vermilion");
    const other = await patchMe(session, { name: "改名不動頭像" });
    expect(other.status).toBe(200);
    expect(str(await other.json(), "avatar")).toBe("color:vermilion");
    const cleared = await patchMe(session, { avatar: null });
    expect(cleared.status).toBe(200);
    expect(field(await cleared.json(), "avatar")).toBeNull();
  });

  test("PATCH /me updates the language preference", async () => {
    const { session } = await signup(`profile-lang-${crypto.randomUUID()}@socrates.tw`);
    const res = await patchMe(session, { lang: "es" });
    expect(res.status).toBe(200);
    expect(field(await res.json(), "lang")).toBe("es");
    expect((await profile(session)).lang).toBe("es");
  });

  test("renaming leaves members.name and activity display_name snapshots intact (#234 D6)", async () => {
    const teacher = await devLogin("demo@socrates.tw");
    const { code, activityId } = await classroomWithActivity(teacher, `profile-snap-${crypto.randomUUID()}`);
    const student = await registerStudent(code, "原野");
    const res = await patchMe(student.cookie, { name: "改名後" });
    expect(res.status).toBe(200);

    const member = await one<{ name: string }>(env.DB, "SELECT name FROM members WHERE user_id = $id", {
      id: student.userId,
    });
    expect(member?.name).toBe("原野");

    const participant = await one<{ display_name: string }>(
      env.DB,
      "SELECT display_name FROM activity_participants WHERE activity_id = $aid AND user_id = $id",
      { aid: activityId, id: student.userId },
    );
    expect(participant?.display_name).toBe("原野");
    expect((await profile(student.cookie)).name).toBe("改名後");
  });

  test("unverified accounts stay behind the hard gate (#437)", async () => {
    const email = `profile-gate-${crypto.randomUUID()}@socrates.tw`;
    const { id, session } = await signup(email, false);
    const read = await call("/api/me/profile", { headers: { Cookie: session } });
    expect(read.status).toBe(403);
    expect(str(await read.json(), "code")).toBe("email_unverified");
    const write = await patchMe(session, { name: "不該生效" });
    expect(write.status).toBe(403);
    const row = await one<{ name: string }>(env.DB, "SELECT name FROM users WHERE id = $id", { id });
    expect(row?.name).toBe(email.split("@")[0]);
  });

  test("PATCH /me requires a session", async () => {
    const res = await call("/api/me", { method: "PATCH", headers: json, body: JSON.stringify({ name: "無" }) });
    expect(res.status).toBe(401);
  });

  test("POST /me/avatar stores a content-hashed JPEG and serves it back", async () => {
    const { id, session } = await signup(`profile-image-${crypto.randomUUID()}@socrates.tw`);
    const bytes = jpegOf(4096);
    const res = await uploadAvatar(session, bytes);
    expect(res.status).toBe(200);
    const token = str(await res.json(), "avatar");
    expect(token).toMatch(/^image:[0-9a-f]{8}$/);
    expect(str(await profile(session), "avatar")).toBe(token);

    const version = token.slice("image:".length);
    const served = await call(`/api/avatars/${id}/${version}`, { headers: { Cookie: session } });
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
    expect(served.headers.get("ETag")).toBeTruthy();
    expect(served.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });

  test("POST /me/avatar rejects non-JPEG and oversized bodies", async () => {
    const { session } = await signup(`avatar-invalid-${crypto.randomUUID()}@socrates.tw`);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(16).fill(0)]);
    expect((await uploadAvatar(session, png)).status).toBe(422);
    expect((await uploadAvatar(session, jpegOf(64 * 1024 + 1))).status).toBe(422);
    expect((await uploadAvatar(session, new Uint8Array(0))).status).toBe(422);
  });

  test("replacing the avatar deletes the previous object; identical bytes reuse the key", async () => {
    const { id, session } = await signup(`avatar-replace-${crypto.randomUUID()}@socrates.tw`);
    const first = str(await (await uploadAvatar(session, jpegOf(64))).json(), "avatar");
    const firstKey = `avatars/${id}/${first.slice("image:".length)}.jpg`;
    const again = str(await (await uploadAvatar(session, jpegOf(64))).json(), "avatar");
    expect(again).toBe(first);

    const second = str(await (await uploadAvatar(session, jpegOf(65))).json(), "avatar");
    expect(second).not.toBe(first);
    expect(await env.AVATARS.get(firstKey)).toBeNull();
    expect(await env.AVATARS.get(`avatars/${id}/${second.slice("image:".length)}.jpg`)).not.toBeNull();
  });

  test("DELETE /me/avatar clears the token and removes the stored object", async () => {
    const { id, session } = await signup(`avatar-delete-${crypto.randomUUID()}@socrates.tw`);
    const token = str(await (await uploadAvatar(session, jpegOf(32))).json(), "avatar");
    const key = `avatars/${id}/${token.slice("image:".length)}.jpg`;
    expect(await env.AVATARS.get(key)).not.toBeNull();

    const removed = await call("/api/me/avatar", { method: "DELETE", headers: { Cookie: session } });
    expect(removed.status).toBe(204);
    expect((await profile(session)).avatar).toBeNull();
    expect(await env.AVATARS.get(key)).toBeNull();
  });

  test("GET /avatars/:userId/:version requires a session and 404s unknown objects", async () => {
    const { id, session } = await signup(`avatar-serve-${crypto.randomUUID()}@socrates.tw`);
    const token = str(await (await uploadAvatar(session, jpegOf(16))).json(), "avatar");
    const version = token.slice("image:".length);
    expect((await call(`/api/avatars/${id}/${version}`)).status).toBe(401);
    expect((await call(`/api/avatars/${id}/00000000`, { headers: { Cookie: session } })).status).toBe(404);
  });

  test("avatar upload and serving sit behind the hard gate (#437)", async () => {
    const { session } = await signup(`avatar-gate-${crypto.randomUUID()}@socrates.tw`, false);
    expect((await uploadAvatar(session, jpegOf(8))).status).toBe(403);
  });
});
