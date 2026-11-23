import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, expect, inject, it } from "vitest";
import { z } from "zod";
import {
  call,
  classroomWithActivity,
  cookieOf,
  createClassroom,
  frames,
  must,
  participantIdOf,
  registerStudent,
  startActivity,
  systemTopicId,
} from "./helpers";
import { one, run } from "../src/db/d1";
import { seedFixture } from "../src/seed";

const migrations = inject("d1Migrations");
const idSchema = z.object({ id: z.string() });
const tokenSchema = z.object({ id: z.string(), token: z.string() });
const pageSchema = z.object({ items: z.array(idSchema), nextCursor: z.string().nullable() });
const joinedSchema = z.object({
  classroomId: z.string(),
  activityId: z.string().nullable(),
  participantId: z.string().nullable(),
});
let owner: string;
let topicId: string;

async function request(path: string, cookie = "", method = "GET", body?: object, key?: string) {
  const headers = new Headers({ Cookie: cookie });
  if (body) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  return call(`/api${path}`, { method, headers, body: body && JSON.stringify(body) });
}

async function signup(name: string) {
  const result = await request("/auth/signup", "", "POST", {
    email: `${crypto.randomUUID()}@socrates.tw`,
    password: "student-pass-1",
    name,
    tosAccepted: true,
  });
  expect(result.status).toBe(200);
  return { userId: idSchema.parse(await result.json()).id, cookie: cookieOf(result) };
}

async function invite(classroomId: string, scope: string, activityId?: string) {
  const result = await request(`/classrooms/${classroomId}/invites`, owner, "POST", { scope, activityId });
  expect(result.status).toBe(201);
  return tokenSchema.parse(await result.json());
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await request("/auth/login", "", "POST", { email: "demo@socrates.tw", password: "demo-demo" });
  expect(login.status).toBe(200);
  owner = cookieOf(login);
  topicId = await systemTopicId(owner);
});

it("accepts a classroom invite before the classroom has an activity", async () => {
  const { classroomId } = await createClassroom(owner, "Empty classroom");
  const student = await signup("New student");
  const { token } = await invite(classroomId, "classroom");
  const preview = await request(`/classroom-invites/${token}`);
  expect(await preview.json()).toMatchObject({ scope: "classroom", classroomId, activityId: null });
  expect((await request(`/classrooms/${classroomId}/members`, student.cookie)).status).toBe(403);

  const joined = await request(`/classroom-invites/${token}/join`, student.cookie, "POST", { tosAccepted: true });
  expect(joined.status).toBe(200);
  expect(joinedSchema.parse(await joined.json())).toEqual({ classroomId, activityId: null, participantId: null });
  expect((await request(`/classrooms/${classroomId}/members`, student.cookie)).status).toBe(200);
});

it("uses the same participant for concurrent redemptions of a combined invite", async () => {
  const { classroomId, activityId } = await classroomWithActivity(owner, "Combined", topicId);
  const student = await signup("Combined student");
  const { token } = await invite(classroomId, "classroom_activity", activityId);
  const attempts = await Promise.all(
    [1, 2].map(() => request(`/classroom-invites/${token}/join`, student.cookie, "POST", { tosAccepted: true })),
  );
  for (const result of attempts) expect(result.status).toBe(200);
  const results = await Promise.all(attempts.map(async (result) => joinedSchema.parse(await result.json())));
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ classroomId, activityId, participantId: expect.any(String) });
  expect(
    await one(env.DB, "SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id = $aid AND user_id = $uid", {
      aid: activityId,
      uid: student.userId,
    }),
  ).toEqual({ n: 1 });
});

it("rejects a closed activity or revoked combined invite without admitting the account", async () => {
  const { classroomId, activityId } = await classroomWithActivity(owner, "Closed", topicId);
  const student = await signup("Late student");
  const revoked = await invite(classroomId, "classroom_activity", activityId);
  expect((await request(`/classrooms/${classroomId}/invites/${revoked.id}`, owner, "DELETE")).status).toBe(204);
  expect(
    (await request(`/classroom-invites/${revoked.token}/join`, student.cookie, "POST", { tosAccepted: true })).status,
  ).toBe(410);
  const { token } = await invite(classroomId, "classroom_activity", activityId);
  expect((await request(`/activities/${activityId}/finish`, owner, "POST")).status).toBe(204);
  expect(
    (await request(`/classroom-invites/${token}/join`, student.cookie, "POST", { tosAccepted: true })).status,
  ).toBe(409);
  expect((await request(`/classrooms/${classroomId}/members`, student.cookie)).status).toBe(403);
  expect(
    await one(env.DB, "SELECT id FROM activity_participants WHERE activity_id = $aid AND user_id = $uid", {
      aid: activityId,
      uid: student.userId,
    }),
  ).toBeNull();
});

it("keeps signed-in visitors outside the classroom", async () => {
  const { classroomId, activityId } = await classroomWithActivity(owner, "Visitor", topicId);
  const visitor = await signup("Visitor");
  const { token } = await invite(classroomId, "activity_guest", activityId);
  const joined = await request(`/classroom-invites/${token}/join`, visitor.cookie, "POST", { tosAccepted: true });
  expect(joined.status).toBe(200);
  expect(await joined.json()).toMatchObject({ activityId, kind: "guest" });
  expect((await request(`/classrooms/${classroomId}/members`, visitor.cookie)).status).toBe(403);
  expect((await request(`/activities/${activityId}`, visitor.cookie)).status).toBe(200);
});

it("restricts classroom announcements and hides test activities from students", async () => {
  const { classroomId, activityId, code } = await classroomWithActivity(owner, "Class content", topicId);
  const student = await registerStudent(code, "Announcement reader");
  const test = await startActivity(owner, classroomId, topicId, "test");
  const announcements = `/classrooms/${classroomId}/announcements`;
  const activities = `/classrooms/${classroomId}/activities`;
  expect((await request(announcements)).status).toBe(401);
  expect((await request(announcements, student.cookie, "POST", { body: "Unauthorised" })).status).toBe(403);
  const posted = await request(announcements, owner, "POST", { body: "Class news" });
  expect(posted.status).toBe(201);
  expect(await (await request(announcements, student.cookie)).json()).toMatchObject({
    items: [{ body: "Class news" }],
  });
  expect(pageSchema.parse(await (await request(activities, student.cookie)).json()).items).toEqual([
    { id: activityId },
  ]);
  expect(pageSchema.parse(await (await request(activities, owner)).json()).items).toEqual(
    expect.arrayContaining([{ id: test.activityId }, { id: activityId }]),
  );
});

it("paginates root posts, deduplicates creates, and cascades replies", async () => {
  const { classroomId, code } = await classroomWithActivity(owner, "Discussion", topicId);
  const student = await registerStudent(code, "Discussion author");
  const posts = `/classrooms/${classroomId}/posts`;
  const key = crypto.randomUUID();
  const first = await request(posts, student.cookie, "POST", { body: "first" }, key);
  expect(first.status).toBe(201);
  const { id } = idSchema.parse(await first.json());
  const replay = await request(posts, student.cookie, "POST", { body: "first" }, key);
  expect(idSchema.parse(await replay.json()).id).toBe(id);
  expect((await request(posts, student.cookie, "POST", { body: "different" }, key)).status).toBe(409);
  expect((await request(posts, owner, "POST", { body: "second" })).status).toBe(201);

  const page = pageSchema.parse(await (await request(`${posts}?limit=1`, student.cookie)).json());
  const next = must(page.nextCursor, "posts cursor");
  const last = pageSchema.parse(
    await (await request(`${posts}?limit=1&cursor=${encodeURIComponent(next)}`, student.cookie)).json(),
  );
  expect([...page.items, ...last.items].map((post) => post.id)).toEqual(expect.arrayContaining([id]));
  expect(page.items[0].id).not.toBe(last.items[0].id);
  expect(last.nextCursor).toBeNull();

  const reply = await request(`${posts}/${id}/replies`, owner, "POST", { body: "reply" });
  expect(reply.status).toBe(201);
  const replyId = idSchema.parse(await reply.json()).id;
  expect((await request(`${posts}/${replyId}/replies`, owner, "POST", { body: "nested" })).status).toBe(404);
  expect((await request(`${posts}/${id}`, student.cookie, "DELETE")).status).toBe(204);
  expect((await request(`${posts}/${id}/replies`, student.cookie)).status).toBe(404);
  expect(await one(env.DB, "SELECT id FROM classroom_posts WHERE id = $id", { id: replyId })).toBeNull();
});

it("keeps a removed student’s personal report and revokes their classroom and chat access", async () => {
  const { classroomId, code, activityId } = await classroomWithActivity(owner, "Reports", topicId);
  const student = await registerStudent(code, "Report subject");
  const participant = await participantIdOf(activityId, student.cookie);
  const outsider = await signup("Report outsider");
  const at = new Date().toISOString();
  await run(
    env.DB,
    "INSERT INTO reports (activity_id, status, teacher_report, student_reports, created_at, updated_at) VALUES ($id, 'partial', $teacher, $reports, $at, $at)",
    {
      id: activityId,
      at,
      teacher: JSON.stringify({ topicTitle: "Topic", classReport: null }),
      reports: JSON.stringify({
        [participant]: {
          participantName: "Report subject",
          pseudonym: "P01",
          analysis: null,
          violations: [],
          positions: [],
        },
      }),
    },
  );
  const liveResponse = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${activityId}:${participant}`, {
      headers: { Upgrade: "websocket", Cookie: student.cookie },
    }),
    env,
  );
  const liveSocket = must(liveResponse?.webSocket, "authorized chat websocket");
  const incoming = frames(liveSocket);
  const terminated = new Promise<number>((resolve) =>
    liveSocket.addEventListener("close", (event) => resolve(event.code)),
  );
  liveSocket.accept();
  await incoming.until((messages) => messages.some(({ type }) => type === "hello"));

  expect((await request(`/classrooms/${classroomId}/members/${student.userId}`, owner, "DELETE")).status).toBe(204);
  expect(await terminated).toBe(1008);
  expect((await request(`/classrooms/${classroomId}/members`, student.cookie)).status).toBe(403);
  expect((await request(`/activities/${activityId}/report`, outsider.cookie)).status).toBe(403);
  const personal = await request(`/activities/${activityId}/report`, student.cookie);
  expect(personal.status).toBe(200);
  expect(await personal.json()).toMatchObject({ participantName: "Report subject" });
  expect(await (await request("/me/reports", student.cookie)).json()).toMatchObject({ items: [{ activityId }] });

  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${activityId}:${participant}`, {
      headers: { Upgrade: "websocket", Cookie: student.cookie },
    }),
    env,
  );
  const socket = must(response?.webSocket, "chat websocket");
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  socket.accept();
  expect(await closed).toBe(1008);
});

it("notifies authorized classroom sockets and closes a removed member’s connection", async () => {
  const { classroomId, code } = await classroomWithActivity(owner, "Events", topicId);
  const student = await registerStudent(code, "Socket member");
  const endpoint = `/api/classrooms/${classroomId}/events`;
  expect(
    (
      await call(endpoint, {
        headers: { Upgrade: "websocket", Cookie: student.cookie, Origin: "https://foreign.test" },
      })
    ).status,
  ).toBe(403);
  const response = await call(endpoint, {
    headers: { Upgrade: "websocket", Cookie: student.cookie, Origin: "http://worker.test" },
  });
  expect(response.status).toBe(101);
  const socket = must(response.webSocket, "classroom websocket");
  const read = () =>
    new Promise<unknown>((resolve) =>
      socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }),
    );
  const ready = read();
  socket.accept();
  expect(await ready).toEqual({ type: "ready" });
  const changed = read();
  expect((await request(`/classrooms/${classroomId}/posts`, owner, "POST", { body: "event" })).status).toBe(201);
  expect(await changed).toEqual({ type: "classroom.changed", resource: "posts" });
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  expect((await request(`/classrooms/${classroomId}/members/${student.userId}`, owner, "DELETE")).status).toBe(204);
  expect(await closed).toBe(1008);
});
