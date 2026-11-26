import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, expect, inject, it } from "vitest";
import { z } from "zod";
import { CalendarEventSchema } from "@socrates/shared";
import {
  call,
  classroomWithActivity,
  cookieOf,
  createClassroom,
  field,
  must,
  registerStudent,
  rows,
  str,
  systemTopicId,
  verifyUserEmail,
} from "./helpers";
import { seedFixture } from "../src/seed";

const migrations = inject("d1Migrations");

const CalendarPageSchema = z.object({
  items: z.array(CalendarEventSchema),
  nextCursor: z.string().nullable(),
});

let owner: string;
let topicId: string;

function request(path: string, cookie = "", method = "GET", body?: object) {
  return call(`/api${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function calendarPath(classroomId: string, from: string, to: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ from, to, ...extra });
  return `/classrooms/${classroomId}/calendar-events?${query}`;
}

async function createEvent(classroomId: string, input: object): Promise<z.infer<typeof CalendarEventSchema>> {
  const response = await request(`/classrooms/${classroomId}/calendar-events`, owner, "POST", input);
  expect(response.status).toBe(201);
  return CalendarEventSchema.parse(await response.json());
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await request("/auth/login", "", "POST", { email: "demo@socrates.tw", password: "demo-demo" });
  expect(login.status).toBe(200);
  owner = cookieOf(login);
  topicId = await systemTopicId(owner);
});

it("stores an event for an empty classroom without creating a dialogue activity", async () => {
  const { classroomId } = await createClassroom(owner, "Calendar only");
  const event = await createEvent(classroomId, {
    title: "  Essay due  ",
    startsAt: "2026-11-23T15:00:00+08:00",
    endsAt: "2026-11-23T16:00:00+08:00",
    note: "  Bring notes  ",
  });
  expect(event).toMatchObject({
    classroomId,
    title: "Essay due",
    startsAt: "2026-11-23T07:00:00.000Z",
    endsAt: "2026-11-23T08:00:00.000Z",
    note: "Bring notes",
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  const path = calendarPath(classroomId, "2026-11-23T06:00:00Z", "2026-11-23T08:00:00Z");
  const response = await request(path, owner);
  expect(response.status).toBe(200);
  expect(CalendarPageSchema.parse(await response.json())).toMatchObject({
    items: [{ id: event.id }],
    nextCursor: null,
  });
  expect(await (await request(`/classrooms/${classroomId}/activities`, owner)).json()).toMatchObject({ items: [] });
});

it("lets members read events but reserves writes for the classroom owner", async () => {
  const { classroomId, code } = await classroomWithActivity(owner, "Calendar roles", topicId);
  const student = await registerStudent(code, "Calendar reader");
  const event = await createEvent(classroomId, { title: "Class meeting", startsAt: "2026-11-25T09:00:00Z" });
  const path = calendarPath(classroomId, "2026-11-25T00:00:00Z", "2026-11-26T00:00:00Z");
  expect((await request(path)).status).toBe(401);
  expect(await (await request(path, student.cookie)).json()).toMatchObject({ items: [{ id: event.id }] });
  expect(
    (
      await request(`/classrooms/${classroomId}/calendar-events`, student.cookie, "POST", {
        title: "Unauthorized",
        startsAt: "2026-11-25T10:00:00Z",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(`/classrooms/${classroomId}/calendar-events/${event.id}`, student.cookie, "PATCH", {
        title: "Unauthorized",
      })
    ).status,
  ).toBe(403);
  expect(
    (await request(`/classrooms/${classroomId}/calendar-events/${event.id}`, student.cookie, "DELETE")).status,
  ).toBe(403);
  const other = await createClassroom(owner, "Other calendar");
  expect(
    (await request(calendarPath(other.classroomId, "2026-11-25T00:00:00Z", "2026-11-26T00:00:00Z"), student.cookie))
      .status,
  ).toBe(403);
  expect(
    (
      await request(`/classrooms/${other.classroomId}/calendar-events/${event.id}`, owner, "PATCH", {
        title: "Wrong classroom",
      })
    ).status,
  ).toBe(404);
});

it("updates and deletes only an event in its classroom", async () => {
  const { classroomId } = await createClassroom(owner, "Calendar editing");
  const event = await createEvent(classroomId, {
    title: "Presentation",
    startsAt: "2026-11-26T09:00:00Z",
    endsAt: "2026-11-26T10:00:00Z",
  });
  const path = `/classrooms/${classroomId}/calendar-events/${event.id}`;
  const changed = await request(path, owner, "PATCH", {
    title: "  Final presentation  ",
    endsAt: null,
    note: "  Room 2  ",
  });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({
    id: event.id,
    title: "Final presentation",
    startsAt: event.startsAt,
    endsAt: null,
    note: "Room 2",
  });
  expect((await request(path, owner, "DELETE")).status).toBe(204);
  expect((await request(path, owner, "DELETE")).status).toBe(404);
  expect(
    await (await request(calendarPath(classroomId, "2026-11-26T00:00:00Z", "2026-11-27T00:00:00Z"), owner)).json(),
  ).toMatchObject({ items: [] });
});

it("preserves edits to different fields from concurrent requests", async () => {
  const { classroomId } = await createClassroom(owner, "Concurrent editing");
  const event = await createEvent(classroomId, { title: "Presentation", startsAt: "2026-11-26T09:00:00Z" });
  const path = `/classrooms/${classroomId}/calendar-events/${event.id}`;
  const results = await Promise.all([
    request(path, owner, "PATCH", { title: "Updated presentation" }),
    request(path, owner, "PATCH", { note: "Room 2" }),
  ]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  const calendar = calendarPath(classroomId, "2026-11-26T00:00:00Z", "2026-11-27T00:00:00Z");
  expect(await (await request(calendar, owner)).json()).toMatchObject({
    items: [{ id: event.id, title: "Updated presentation", note: "Room 2" }],
  });
});

it("queries overlapping events in start order with a range-bound cursor", async () => {
  const { classroomId } = await createClassroom(owner, "Calendar paging");
  const later = await createEvent(classroomId, { title: "Later", startsAt: "2026-11-23T12:00:00Z" });
  const spanning = await createEvent(classroomId, {
    title: "Spanning",
    startsAt: "2026-11-22T12:00:00Z",
    endsAt: "2026-11-23T10:00:00Z",
  });
  const middle = await createEvent(classroomId, { title: "Middle", startsAt: "2026-11-23T11:00:00Z" });
  await createEvent(classroomId, { title: "Outside", startsAt: "2026-11-24T00:00:00Z" });
  const from = "2026-11-23T00:00:00Z";
  const to = "2026-11-24T00:00:00Z";
  const first = CalendarPageSchema.parse(
    await (await request(calendarPath(classroomId, from, to, { limit: "2" }), owner)).json(),
  );
  expect(first.items.map((item) => item.id)).toEqual([spanning.id, middle.id]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const next = CalendarPageSchema.parse(
    await (
      await request(calendarPath(classroomId, from, to, { limit: "2", cursor: first.nextCursor ?? "" }), owner)
    ).json(),
  );
  expect(next.items.map((item) => item.id)).toEqual([later.id]);
  expect(next.nextCursor).toBeNull();
  expect(
    (await request(calendarPath(classroomId, "2026-11-23T01:00:00Z", to, { cursor: first.nextCursor ?? "" }), owner))
      .status,
  ).toBe(422);
});

it("rejects invalid event times and calendar ranges", async () => {
  const { classroomId } = await createClassroom(owner, "Calendar validation");
  const collection = `/classrooms/${classroomId}/calendar-events`;
  expect((await request(collection, owner, "POST", { title: " ", startsAt: "2026-11-23T09:00:00Z" })).status).toBe(422);
  expect(
    (
      await request(collection, owner, "POST", {
        title: "Backwards",
        startsAt: "2026-11-23T10:00:00Z",
        endsAt: "2026-11-23T09:00:00Z",
      })
    ).status,
  ).toBe(422);
  const event = await createEvent(classroomId, {
    title: "Timed",
    startsAt: "2026-11-23T09:00:00Z",
    endsAt: "2026-11-23T10:00:00Z",
  });
  expect((await request(`${collection}/${event.id}`, owner, "PATCH", {})).status).toBe(422);
  expect(
    (await request(`${collection}/${event.id}`, owner, "PATCH", { startsAt: "2026-11-23T11:00:00Z" })).status,
  ).toBe(422);
  expect((await request(calendarPath(classroomId, "2026-11-24T00:00:00Z", "2026-11-23T00:00:00Z"), owner)).status).toBe(
    422,
  );
  expect((await request(calendarPath(classroomId, "2026-11-01T00:00:00Z", "2027-01-04T00:00:00Z"), owner)).status).toBe(
    422,
  );
  expect(
    (await request(calendarPath(classroomId, "2026-11-23T00:00:00Z", "2026-11-24T00:00:00Z", { cursor: "@@" }), owner))
      .status,
  ).toBe(422);
  expect(
    (
      await request(
        calendarPath(classroomId, "2026-11-23T00:00:00Z", "2026-11-24T00:00:00Z", { cursor: btoa("not json") }),
        owner,
      )
    ).status,
  ).toBe(422);
});

it("notifies classroom members after calendar changes", async () => {
  const { classroomId, code } = await classroomWithActivity(owner, "Calendar live updates", topicId);
  const student = await registerStudent(code, "Calendar subscriber");
  const response = await call(`/api/classrooms/${classroomId}/events`, {
    headers: { Upgrade: "websocket", Cookie: student.cookie, Origin: "http://worker.test" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).toBeDefined();
  if (!socket) throw new Error("Missing classroom WebSocket");
  const next = () =>
    new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Calendar update not received")), 1000);
      socket.addEventListener(
        "message",
        (message) => {
          clearTimeout(timeout);
          resolve(JSON.parse(String(message.data)));
        },
        { once: true },
      );
    });
  const ready = next();
  socket.accept();
  expect(await ready).toEqual({ type: "ready" });
  const changed = next();
  await createEvent(classroomId, { title: "New schedule", startsAt: "2026-11-28T09:00:00Z" });
  expect(await changed).toEqual({ type: "classroom.changed", resource: "calendar" });
  socket.close();
});
it("starts a scheduled discussion once and keeps its report on the same event", async () => {
  const { classroomId } = await createClassroom(owner, "Scheduled discussion");
  const eventPath = `/classrooms/${classroomId}/calendar-events`;
  const startPath = `/classrooms/${classroomId}/activities`;
  const created = await request(eventPath, owner, "POST", {
    title: "Debate seminar",
    startsAt: "2026-11-27T09:00:00Z",
    topicId,
  });
  expect(created.status).toBe(201);
  const id = str(await created.json(), "id");
  const range = calendarPath(classroomId, "2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z");
  expect(await (await request(range, owner)).json()).toMatchObject({
    items: [{ id, topicId, activity: null }],
  });
  expect(await (await request(startPath, owner)).json()).toMatchObject({ items: [] });

  const signup = await request("/auth/signup", "", "POST", {
    name: "Calendar student",
    email: "calendar-scheduled@socrates.tw",
    password: "student-pass-1",
    tosAccepted: true,
  });
  expect(signup.status).toBe(200);
  const student = cookieOf(signup);
  await verifyUserEmail(str(await signup.json(), "id"));
  const invite = await request(`/classrooms/${classroomId}/invites`, owner, "POST", { scope: "classroom" });
  expect(invite.status).toBe(201);
  const token = str(await invite.json(), "token");
  expect((await request(`/classroom-invites/${token}/join`, student, "POST", { tosAccepted: true })).status).toBe(200);
  const input = { topicId, calendarEventId: id };
  expect((await request(startPath, student, "POST", input)).status).toBe(403);
  expect((await request(startPath, owner, "POST", { ...input, mode: "test" })).status).toBe(422);
  const responses = await Promise.all([
    request(startPath, owner, "POST", input),
    request(startPath, owner, "POST", input),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
  const activities = await Promise.all(
    responses.map(async (response) => ({ activityId: str(await response.json(), "activityId") })),
  );
  const activityId = must(activities[0], "first activity response").activityId;
  expect(must(activities[1], "second activity response").activityId).toBe(activityId);
  expect(await (await request(startPath, owner)).json()).toMatchObject({ items: [{ id: activityId }] });
  expect(await (await request(range, student)).json()).toMatchObject({
    items: [{ id, topicId, activity: { id: activityId, finishedAt: null } }],
  });
  expect((await request(`/activities/${activityId}`, student)).status).toBe(200);
  expect((await request(`${eventPath}/${id}`, owner, "DELETE")).status).toBe(409);
  expect((await request(`/activities/${activityId}/finish`, owner, "POST")).status).toBe(204);
  expect(await (await request(range, student)).json()).toMatchObject({
    items: [{ id, activity: { id: activityId, finishedAt: expect.any(String) } }],
  });
});

it("preserves the current live discussion when another is scheduled to start", async () => {
  const { classroomId, activityId } = await classroomWithActivity(owner, "Calendar with a live discussion", topicId);
  const event = await createEvent(classroomId, { title: "Next debate", startsAt: "2026-12-03T10:00:00Z", topicId });
  const path = `/classrooms/${classroomId}/activities`;
  const start = await request(path, owner, "POST", { topicId, calendarEventId: event.id });
  expect(start.status).toBe(409);
  const history = rows(field(await (await request(path, owner)).json(), "items"));
  expect(history.map((activity) => field(activity, "id"))).toEqual([activityId]);
  const classrooms = rows(await (await request("/classrooms", owner)).json());
  const currents = classrooms.map((room) => field(room, "current"));
  expect(currents.find((entry) => entry !== null)).toMatchObject({ activityId });
});
