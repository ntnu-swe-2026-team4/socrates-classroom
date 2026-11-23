import type { CalendarEvent } from "@socrates/shared";

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function monthDays(year: number, month: number): Date[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const length = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length }, (_, index) => new Date(year, month, index - lead + 1));
}

export function eventsByDay(
  events: readonly CalendarEvent[],
  visibleDays: readonly Date[],
): Map<string, CalendarEvent[]> {
  const days = new Map<string, CalendarEvent[]>();
  const ordered = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const day of visibleDays) {
    const key = dayKey(day);
    const start = day.getTime();
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const items = ordered.filter((event) => {
      const begins = Date.parse(event.startsAt);
      return begins < end && (event.endsAt ? Date.parse(event.endsAt) > start : begins >= start);
    });
    if (items.length) days.set(key, items);
  }
  return days;
}
