import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { subscribeToClassroom } from "@/api/classroom-events";
import { ClassroomCalendar } from "@/components/ClassroomCalendar";
import { setLocale } from "@/i18n";
import { dayKey, eventsByDay, monthDays } from "@/lib/calendar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(teacher: boolean) {
  setLocale("en");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClassroomCalendar id="room" teacher={teacher} />
    </QueryClientProvider>,
  );
  return client;
}

test("a month is laid out in whole Monday-first weeks", () => {
  const november = monthDays(2026, 10);
  expect(november).toHaveLength(42);
  expect(dayKey(november[0])).toBe("2026-10-26");
  expect(dayKey(november[6])).toBe("2026-11-01");
  expect(dayKey(november[41])).toBe("2026-12-06");
  expect(monthDays(2027, 1)).toHaveLength(28);
});

test("events are grouped by local day and ordered by start time", () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
  const event = (id: string, startsAt: string) => ({
    id,
    classroomId: "room",
    title: id,
    startsAt,
    note: "",
    endsAt: null,
    createdAt: startsAt,
    updatedAt: startsAt,
  });
  const days = eventsByDay(
    [event("late", at(3, 15)), event("early", at(3, 9)), event("other", at(4, 9))],
    [new Date(2026, 10, 3), new Date(2026, 10, 4)],
  );
  expect(days.get(dayKey(new Date(2026, 10, 3)))?.map((entry) => entry.id)).toEqual(["early", "late"]);
  expect(days.get(dayKey(new Date(2026, 10, 4)))).toHaveLength(1);
});

test("an event crossing midnight appears only on the local days it overlaps", () => {
  const startsAt = new Date(2026, 10, 30, 23).toISOString();
  const endsAt = new Date(2026, 11, 2).toISOString();
  const event = {
    id: "overnight",
    classroomId: "room",
    title: "Trip",
    startsAt,
    endsAt,
    note: "",
    createdAt: startsAt,
    updatedAt: startsAt,
  };
  const days = eventsByDay([event], [new Date(2026, 11, 1), new Date(2026, 11, 2)]);
  expect(days.get("2026-12-01")).toEqual([event]);
  expect(days.has("2026-12-02")).toBe(false);
});

function calendarServer(initial: string[] = []) {
  const makeEvent = (title: string, id: string, startsAt = new Date().toISOString()) => ({
    id,
    title,
    startsAt,
    classroomId: "room",
    note: "",
    endsAt: null,
    createdAt: startsAt,
    updatedAt: startsAt,
  });
  let events = initial.map((title, i) => makeEvent(title, String(i)));
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = "/api/classrooms/room/calendar-events";
    if (url.pathname === path && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const event = { ...makeEvent(body.title, "created", body.startsAt), note: body.note };
      events.push(event);
      return Response.json(event, { status: 201 });
    }
    if (url.pathname.startsWith(`${path}/`) && init?.method === "DELETE") {
      events = events.filter((event) => event.id !== url.pathname.slice(path.length + 1));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === path && init?.method === "GET") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const items = events.filter((event) => from <= event.startsAt && event.startsAt < to);
      return url.searchParams.get("cursor") === "second"
        ? Response.json({ items: items.slice(1), nextCursor: null })
        : Response.json({ items: items.slice(0, 1), nextCursor: items.length > 1 ? "second" : null });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("a teacher creates an API event in another month", async () => {
  const fetch = calendarServer();
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 3);
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "New event" }));
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Essay due" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: dayKey(nextMonth) } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "14:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findAllByText("Essay due");
  const request = fetch.mock.calls.find(([, init]) => init?.method === "POST");
  const startsAt = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 3, 14, 30).toISOString();
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ title: "Essay due", startsAt, note: "" });
});

test("a teacher deletes a shared event after confirming", async () => {
  const fetch = calendarServer(["Field trip"]);
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: /Delete · Field trip/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Field trip")).toBeNull());
  expect(
    fetch.mock.calls.some(([path, init]) => String(path).endsWith("/calendar-events/0") && init?.method === "DELETE"),
  ).toBe(true);
});

test("a student sees every page for the current local month", async () => {
  const fetch = calendarServer(["Field trip", "Essay due"]);
  mount(false);
  await screen.findAllByText("Field trip");
  await screen.findAllByText("Essay due");
  const today = new Date();
  const queries = fetch.mock.calls.map(([input]) => new URL(String(input), "http://localhost").searchParams);
  expect(queries.map((query) => query.get("cursor"))).toEqual([null, "second"]);
  for (const query of queries) {
    expect(query.get("from")).toBe(new Date(today.getFullYear(), today.getMonth(), 1).toISOString());
    expect(query.get("to")).toBe(new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString());
  }
  expect(screen.queryByRole("button", { name: "New event" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
});

test("a calendar socket update refreshes the visible month", async () => {
  const fetch = calendarServer(["Before update"]);
  const client = mount(false);
  await screen.findAllByText("Before update");

  const sockets: EventTarget[] = [];
  class CalendarSocket extends EventTarget {
    constructor() {
      super();
      sockets.push(this);
    }

    close() {}
  }
  vi.stubGlobal("WebSocket", CalendarSocket);
  const unsubscribe = subscribeToClassroom(client, "room");
  try {
    const startsAt = new Date().toISOString();
    fetch.mockResolvedValue(
      Response.json({
        items: [
          {
            id: "updated",
            classroomId: "room",
            title: "After update",
            startsAt,
            endsAt: null,
            note: "",
            createdAt: startsAt,
            updatedAt: startsAt,
          },
        ],
        nextCursor: null,
      }),
    );
    sockets[0].dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "classroom.changed", resource: "calendar" }) }),
    );
    await screen.findAllByText("After update");
    expect(screen.queryByText("Before update")).toBeNull();
  } finally {
    unsubscribe();
  }
});
