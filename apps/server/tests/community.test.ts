import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedDemo } from "../src/seed";
import { SESSION_COOKIE } from "../src/auth";
import { call, cookieOf } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let teacher: string;
let topicId: string;

interface PostShape {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isTeacher: boolean;
  createdAt: string;
  replies: Array<Omit<PostShape, "replies">>;
}

async function guest(name: string): Promise<{ cookie: string; id: string }> {
  const res = await call("/api/auth/guest", { method: "POST", headers: json, body: JSON.stringify({ name }) });
  expect(res.status).toBe(200);
  const user = (await res.json()) as { id: string };
  return { cookie: cookieOf(res), id: user.id };
}

async function classroom(name: string): Promise<{ id: string; code: string }> {
  const res = await call("/api/classrooms", {
    method: "POST",
    headers: { ...json, Cookie: teacher },
    body: JSON.stringify({ name, topicId }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { classroomId: string; code: string };
  return { id: body.classroomId, code: body.code };
}

async function student(code: string, name: string): Promise<{ cookie: string; id: string }> {
  const user = await guest(name);
  const res = await call("/api/join", {
    method: "POST",
    headers: { ...json, Cookie: user.cookie },
    body: JSON.stringify({ code, tosAccepted: true }),
  });
  expect(res.status).toBe(200);
  return user;
}

function send(path: string, cookie: string, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { ...json, Cookie: cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function get<T>(path: string, cookie: string): Promise<T> {
  const res = await call(path, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  teacher = cookieOf(login);
  const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{ id: string }>;
  topicId = topics[0]!.id;
});

describe("announcements", () => {
  it("owner posts and deletes; members read newest first; students cannot post; strangers get 404", async () => {
    const room = await classroom("公告班");
    const alice = await student(room.code, "公告甲");
    const stranger = await guest("公告路人");
    const base = `/api/classrooms/${room.id}/announcements`;

    const first = await send(base, teacher, "POST", { body: "第一則\n第二行" });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string; body: string; authorName: string; createdAt: string };
    expect(created).toMatchObject({ body: "第一則\n第二行" });
    expect(created.authorName.length).toBeGreaterThan(0);
    const second = (await (await send(base, teacher, "POST", { body: "第二則" })).json()) as { id: string };

    const list = await get<Array<{ id: string }>>(base, alice.cookie);
    expect(list.map((entry) => entry.id)).toEqual([second.id, created.id]);

    expect((await send(base, alice.cookie, "POST", { body: "學生公告" })).status).toBe(403);
    expect((await send(base, teacher, "POST", { body: "   " })).status).toBe(422);
    expect((await send(base, teacher, "POST", { body: "x".repeat(2001) })).status).toBe(422);
    expect((await call(base, { headers: { Cookie: stranger.cookie } })).status).toBe(404);
    expect((await send(base, stranger.cookie, "POST", { body: "闖入" })).status).toBe(404);
    expect((await call(base)).status).toBe(401);

    expect((await send(`${base}/${created.id}`, alice.cookie, "DELETE")).status).toBe(403);
    expect((await send(`${base}/${created.id}`, teacher, "DELETE")).status).toBe(204);
    expect((await send(`${base}/${created.id}`, teacher, "DELETE")).status).toBe(404);
    expect((await get<Array<{ id: string }>>(base, alice.cookie)).map((entry) => entry.id)).toEqual([second.id]);
  });
});

describe("members", () => {
  it("lists teacher + students, hides preview users, supports kick and leave, never removes the owner", async () => {
    const room = await classroom("成員班");
    const alice = await student(room.code, "成員甲");
    const bob = await student(room.code, "成員乙");
    const carol = await student(room.code, "成員丙");
    const base = `/api/classrooms/${room.id}/members`;

    const preview = await call(`/api/classrooms/${room.id}/preview`, { method: "POST", headers: { Cookie: teacher } });
    expect(preview.status).toBe(200);
    const previewUser = ((await preview.json()) as { user: { id: string } }).user;
    const previewCookie = (preview.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(";")[0]!)
      .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))!;

    const roster = await get<{ teacher: { id: string; name: string }; members: Array<{ id: string; name: string }> }>(
      base,
      alice.cookie,
    );
    expect(roster.teacher.name.length).toBeGreaterThan(0);
    expect(roster.members.map((member) => member.name)).toEqual(["成員甲", "成員乙", "成員丙"]);
    expect(roster.members.some((member) => member.id === previewUser.id)).toBe(false);
    expect((await get<{ members: unknown[] }>(base, previewCookie)).members).toHaveLength(3);
    expect(
      (await send(`/api/classrooms/${room.id}/posts`, previewCookie, "POST", { body: "測試學生發言" })).status,
    ).toBe(201);

    expect((await call(base, { headers: { Cookie: (await guest("成員路人")).cookie } })).status).toBe(404);
    expect((await send(`${base}/${roster.teacher.id}`, teacher, "DELETE")).status).toBe(403);
    expect((await send(`${base}/${roster.teacher.id}`, alice.cookie, "DELETE")).status).toBe(403);
    expect((await send(`${base}/${bob.id}`, alice.cookie, "DELETE")).status).toBe(403);

    expect((await send(`${base}/${bob.id}`, teacher, "DELETE")).status).toBe(204);
    expect((await call(`/api/classrooms/${room.id}`, { headers: { Cookie: bob.cookie } })).status).toBe(404);
    expect((await call("/api/me", { headers: { Cookie: bob.cookie } })).status).toBe(200);
    expect((await send(`${base}/${bob.id}`, teacher, "DELETE")).status).toBe(404);

    expect((await send(`${base}/${carol.id}`, carol.cookie, "DELETE")).status).toBe(204);
    expect((await call(base, { headers: { Cookie: carol.cookie } })).status).toBe(404);

    const after = await get<{ members: Array<{ id: string }> }>(base, teacher);
    expect(after.members.map((member) => member.id)).toEqual([alice.id]);
    const summary = await get<{ memberCount: number }>(`/api/classrooms/${room.id}`, teacher);
    expect(summary.memberCount).toBe(1);
  });
});

describe("discussion board", () => {
  it("threads newest first with replies oldest first; parent validation; author/owner delete; cascade", async () => {
    const room = await classroom("討論班");
    const other = await classroom("隔壁班");
    const alice = await student(room.code, "討論甲");
    const bob = await student(room.code, "討論乙");
    const outsider = await student(other.code, "隔壁同學");
    const base = `/api/classrooms/${room.id}/posts`;

    const thread = (await (await send(base, alice.cookie, "POST", { body: "第一個問題" })).json()) as PostShape;
    expect(thread).toMatchObject({ authorId: alice.id, authorName: "討論甲", isTeacher: false, replies: [] });
    const later = await send(base, teacher, "POST", { body: "老師開的串" });
    expect(later.status).toBe(201);
    const teacherThread = (await later.json()) as PostShape;
    expect(teacherThread.isTeacher).toBe(true);

    const r1 = (await (
      await send(base, bob.cookie, "POST", { body: "回覆一", parentId: thread.id })
    ).json()) as PostShape;
    const r2 = (await (await send(base, teacher, "POST", { body: "回覆二", parentId: thread.id })).json()) as PostShape;

    expect((await send(base, bob.cookie, "POST", { body: "巢狀", parentId: r1.id })).status).toBe(404);
    expect((await send(base, bob.cookie, "POST", { body: "不存在", parentId: "p_missing" })).status).toBe(404);
    const foreign = (await (
      await send(`/api/classrooms/${other.id}/posts`, outsider.cookie, "POST", { body: "隔壁的串" })
    ).json()) as PostShape;
    expect((await send(base, bob.cookie, "POST", { body: "跨班", parentId: foreign.id })).status).toBe(404);
    expect((await send(base, outsider.cookie, "POST", { body: "闖入" })).status).toBe(404);
    expect((await call(base, { headers: { Cookie: outsider.cookie } })).status).toBe(404);
    expect((await send(base, alice.cookie, "POST", { body: "" })).status).toBe(422);

    const board = await get<PostShape[]>(base, bob.cookie);
    expect(board.map((post) => post.id)).toEqual([teacherThread.id, thread.id]);
    const replies = board[1]!.replies;
    expect(replies.map((reply) => reply.id)).toEqual([r1.id, r2.id]);
    expect(replies.map((reply) => reply.isTeacher)).toEqual([false, true]);
    expect("replies" in replies[0]!).toBe(false);

    expect((await send(`${base}/${r1.id}`, alice.cookie, "DELETE")).status).toBe(403);
    expect((await send(`${base}/${foreign.id}`, teacher, "DELETE")).status).toBe(404);
    expect((await send(`${base}/${r1.id}`, bob.cookie, "DELETE")).status).toBe(204);
    expect((await send(`${base}/${teacherThread.id}`, alice.cookie, "DELETE")).status).toBe(403);

    expect((await send(`${base}/${thread.id}`, teacher, "DELETE")).status).toBe(204);
    expect((await send(`${base}/${r2.id}`, teacher, "DELETE")).status).toBe(404);
    expect((await get<PostShape[]>(base, alice.cookie)).map((post) => post.id)).toEqual([teacherThread.id]);

    expect((await send(`${base}/${teacherThread.id}`, teacher, "DELETE")).status).toBe(204);
    expect(await get<PostShape[]>(base, alice.cookie)).toEqual([]);
  });

  it("a departed member's posts keep their account name", async () => {
    const room = await classroom("離開班");
    const dan = await student(room.code, "離開者");
    const base = `/api/classrooms/${room.id}/posts`;
    expect((await send(base, dan.cookie, "POST", { body: "我先走了" })).status).toBe(201);
    expect((await send(`/api/classrooms/${room.id}/members/${dan.id}`, dan.cookie, "DELETE")).status).toBe(204);
    const board = await get<PostShape[]>(base, teacher);
    expect(board[0]).toMatchObject({ authorId: dan.id, authorName: "離開者", isTeacher: false });
  });
});
