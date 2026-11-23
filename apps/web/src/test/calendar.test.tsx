import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test } from "vitest";
import { ClassroomCalendar } from "@/components/ClassroomCalendar";
import { setLocale } from "@/i18n";
import { dayKey, eventsByDay, mockCalendar, monthDays } from "@/lib/calendar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount(teacher: boolean) {
  setLocale("en");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClassroomCalendar id="room" teacher={teacher} />
    </QueryClientProvider>,
  );
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
  const event = (id: string, startsAt: string) => ({ id, classroomId: "room", title: id, startsAt, note: "" });
  const days = eventsByDay([event("late", at(3, 15)), event("early", at(3, 9)), event("other", at(4, 9))]);
  expect(days.get(dayKey(new Date(2026, 10, 3)))?.map((entry) => entry.id)).toEqual(["early", "late"]);
  expect(days.get(dayKey(new Date(2026, 10, 4)))).toHaveLength(1);
});

test("a teacher adds an event and sees it on the chosen day", async () => {
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "New event" }));
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Essay due" } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "14:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getAllByText("Essay due").length).toBeGreaterThan(0);
  expect(await mockCalendar.list("room")).toHaveLength(1);
});

test("a teacher deletes an event after confirming", async () => {
  await mockCalendar.create("room", { title: "Field trip", startsAt: new Date().toISOString(), note: "" });
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: /Delete · Field trip/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Field trip")).toBeNull());
  expect(await mockCalendar.list("room")).toHaveLength(0);
});

test("a student sees events but cannot add or delete them", async () => {
  await mockCalendar.create("room", { title: "Field trip", startsAt: new Date().toISOString(), note: "" });
  mount(false);
  expect((await screen.findAllByText("Field trip")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "New event" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
});
