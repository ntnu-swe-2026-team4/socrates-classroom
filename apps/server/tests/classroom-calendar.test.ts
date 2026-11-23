import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, expect, inject, it } from "vitest";
import { call, classroomWithActivity, cookieOf, createClassroom, registerStudent, systemTopicId } from "./helpers";
import { seedFixture } from "../src/seed";

const migrations = inject("d1Migrations");

interface CalendarEvent {
  id: string;
  classroomId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface CalendarPage {
  items: CalendarEvent[];
  nextCursor: string | null;
}

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

async function createEvent(classroomId: string, input: object): Promise<CalendarEvent> {
  const response = await request(`/classrooms/${classroomId}/calendar-events`, owner, "POST", input);
  expect(response.status).toBe(201);
  return (await response.json()) as CalendarEvent;
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
  expect((await response.json()) as CalendarPage).toMatchObject({ items: [{ id: event.id }], nextCursor: null });
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
  const first = (await (
    await request(calendarPath(classroomId, from, to, { limit: "2" }), owner)
  ).json()) as CalendarPage;
  expect(first.items.map((item) => item.id)).toEqual([spanning.id, middle.id]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const next = (await (
    await request(calendarPath(classroomId, from, to, { limit: "2", cursor: first.nextCursor ?? "" }), owner)
  ).json()) as CalendarPage;
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
