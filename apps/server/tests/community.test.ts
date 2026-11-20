import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { seedFixture } from "../src/seed";
import { call, cookieOf } from "./helpers";

const migrations = inject("d1Migrations");

const json: Record<string, string> = { "Content-Type": "application/json" };

async function login(email: string, password = "demo-demo"): Promise<string> {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return call(path, { method: "POST", headers: { ...json, Cookie: cookie }, body: JSON.stringify(body) });
}

function del(path: string, cookie: string): Promise<Response> {
  return call(path, { method: "DELETE", headers: { Cookie: cookie } });
}

interface Announcement {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

interface PostReply {
  id: string;
  body: string;
  authorName: string;
  isTeacher: boolean;
  createdAt: string;
}
interface Post extends PostReply {
  replies: PostReply[];
}

let owner: string;
let member: string;
let joiner: string;
let classroomId: string;
let teacherId: string;

async function roomsOf(cookie: string): Promise<Array<{ id: string; role: string }>> {
  return (await (await call("/api/classrooms", { headers: { Cookie: cookie } })).json()) as Array<{
    id: string;
    role: string;
  }>;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  owner = await login("demo@socrates.tw");
  member = await login("student-a@socrates.tw");
  joiner = await login("student-e@socrates.tw");
  const rooms = await roomsOf(owner);
  classroomId = rooms.find((room) => room.role === "teacher")!.id;
  teacherId = ((await (await call("/api/me", { headers: { Cookie: owner } })).json()) as { id: string }).id;
});

describe("classroom announcements (#241)", () => {
  test("owner composes; members read; non-owner compose rejected; outsider and guest blocked", async () => {
    const created = await post(`/api/classrooms/${classroomId}/announcements`, owner, { body: "週三停課一次" });
    expect(created.status).toBe(201);
    const row = (await created.json()) as Announcement;
    expect(row.body).toBe("週三停課一次");

    const list = await call(`/api/classrooms/${classroomId}/announcements`, { headers: { Cookie: member } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as Announcement[]).some((a) => a.id === row.id)).toBe(true);

    expect((await post(`/api/classrooms/${classroomId}/announcements`, member, { body: "越權" })).status).toBe(403);
    expect((await call(`/api/classrooms/${classroomId}/announcements`, { headers: { Cookie: joiner } })).status).toBe(
      403,
    );
    expect((await call(`/api/classrooms/${classroomId}/announcements`)).status).toBe(401);
  });

  test("owner deletes; missing id 404; non-owner delete rejected", async () => {
    const created = await post(`/api/classrooms/${classroomId}/announcements`, owner, { body: "即將刪除" });
    const { id } = (await created.json()) as Announcement;
    expect((await del(`/api/classrooms/${classroomId}/announcements/${id}`, member)).status).toBe(403);
    expect((await del(`/api/classrooms/${classroomId}/announcements/${id}`, owner)).status).toBe(204);
    expect((await del(`/api/classrooms/${classroomId}/announcements/${id}`, owner)).status).toBe(404);
  });
});

describe("classroom members roster (#241, #237)", () => {
  test("roster lists teacher and members in join order", async () => {
    const res = await call(`/api/classrooms/${classroomId}/members`, { headers: { Cookie: member } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      teacher: { id: string; name: string };
      members: Array<{ id: string; name: string; joinedAt: string }>;
    };
    expect(body.teacher.id).toBe(teacherId);
    expect(body.members.length).toBeGreaterThan(0);
    expect(body.members.every((m) => m.id !== body.teacher.id)).toBe(true);
    expect((await call(`/api/classrooms/${classroomId}/members`, { headers: { Cookie: joiner } })).status).toBe(403);
  });

  test("removing a member deletes only the roster row — account and other classrooms survive (#237)", async () => {
    expect((await post("/api/join", joiner, { code: "demo-phil", tosAccepted: true })).status).toBe(200);
    expect((await post("/api/join", joiner, { code: "demo-eths", tosAccepted: true })).status).toBe(200);
    const joined = (await roomsOf(joiner)).filter((room) => room.role === "student");
    expect(joined.length).toBe(2);

    const me = (await (await call("/api/me", { headers: { Cookie: joiner } })).json()) as { id: string };
    const removed = await del(`/api/classrooms/${classroomId}/members/${me.id}`, owner);
    expect(removed.status).toBe(204);
    expect((await del(`/api/classrooms/${classroomId}/members/${me.id}`, owner)).status).toBe(404);

    expect((await call("/api/me", { headers: { Cookie: joiner } })).status).toBe(200);
    const after = (await roomsOf(joiner)).filter((room) => room.role === "student");
    expect(after.length).toBe(1);
    expect(after.some((room) => room.id === classroomId)).toBe(false);
  });

  test("member can self-leave but not remove others; teacher row cannot be removed", async () => {
    expect((await post("/api/join", joiner, { code: "demo-phil", tosAccepted: true })).status).toBe(200);
    const me = (await (await call("/api/me", { headers: { Cookie: joiner } })).json()) as { id: string };
    const other = "u_fx_student_b";
    expect((await del(`/api/classrooms/${classroomId}/members/${other}`, joiner)).status).toBe(403);
    expect((await del(`/api/classrooms/${classroomId}/members/${teacherId}`, owner)).status).toBe(403);
    expect((await del(`/api/classrooms/${classroomId}/members/${me.id}`, joiner)).status).toBe(204);
  });
});

describe("classroom posts (#241)", () => {
  async function posts(cookie: string): Promise<Post[]> {
    const res = await call(`/api/classrooms/${classroomId}/posts`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as Post[];
  }

  test("members post threads and single-level replies; list newest thread first", async () => {
    const thread = await post(`/api/classrooms/${classroomId}/posts`, member, { body: "大家的直覺是什麼？" });
    expect(thread.status).toBe(201);
    const root = (await thread.json()) as Post;
    expect(root.body).toBe("大家的直覺是什麼？");
    expect(root.replies).toEqual([]);

    expect(
      (await post(`/api/classrooms/${classroomId}/posts`, owner, { body: "先表態再說理由", parentId: root.id })).status,
    ).toBe(201);

    const list = await posts(member);
    const found = list.find((p) => p.id === root.id)!;
    expect(found.replies.map((r) => r.body)).toEqual(["先表態再說理由"]);
    expect(list[0]!.createdAt >= list[list.length - 1]!.createdAt).toBe(true);
  });

  test("deleting a root post cascades its replies (#158 拍板)", async () => {
    const root = (await (
      await post(`/api/classrooms/${classroomId}/posts`, owner, { body: "將被刪除的 thread" })
    ).json()) as Post;
    await post(`/api/classrooms/${classroomId}/posts`, member, { body: "回覆", parentId: root.id });

    expect((await del(`/api/classrooms/${classroomId}/posts/${root.id}`, owner)).status).toBe(204);
    const list = await posts(owner);
    expect(list.some((p) => p.id === root.id)).toBe(false);
  });

  test("author deletes own post; member cannot delete others; owner can delete any", async () => {
    const mine = (await (
      await post(`/api/classrooms/${classroomId}/posts`, member, { body: "我的貼文" })
    ).json()) as Post;
    const theirs = (await (
      await post(`/api/classrooms/${classroomId}/posts`, owner, { body: "老師的貼文" })
    ).json()) as Post;

    expect((await del(`/api/classrooms/${classroomId}/posts/${theirs.id}`, member)).status).toBe(403);
    expect((await del(`/api/classrooms/${classroomId}/posts/${mine.id}`, member)).status).toBe(204);
    expect((await del(`/api/classrooms/${classroomId}/posts/${theirs.id}`, owner)).status).toBe(204);
  });

  test("guests and outsiders are blocked", async () => {
    expect((await call(`/api/classrooms/${classroomId}/posts`)).status).toBe(401);
    expect((await post(`/api/classrooms/${classroomId}/posts`, joiner, { body: "路人的話" })).status).toBe(403);
  });
});

describe("classroom activities list (#241)", () => {
  test("members see the classroom activities, newest first; outsider and guest blocked", async () => {
    const res = await call(`/api/classrooms/${classroomId}/activities`, { headers: { Cookie: member } });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      id: string;
      mode: string;
      topicTitle: string;
      finishedAt: string | null;
      createdAt: string;
    }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.createdAt >= list[list.length - 1]!.createdAt).toBe(true);
    expect((await call(`/api/classrooms/${classroomId}/activities`, { headers: { Cookie: joiner } })).status).toBe(403);
    expect((await call(`/api/classrooms/${classroomId}/activities`)).status).toBe(401);
  });
});
