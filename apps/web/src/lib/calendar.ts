export interface CalendarEvent {
  id: string;
  classroomId: string;
  title: string;
  startsAt: string;
  note: string;
}

export interface CalendarEventInput {
  title: string;
  startsAt: string;
  note: string;
}

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

export function eventsByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const days = new Map<string, CalendarEvent[]>();
  for (const event of [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = dayKey(new Date(event.startsAt));
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  return days;
}

const STORAGE_PREFIX = "calendar-mock:";
const memory = new Map<string, CalendarEvent[]>();

function read(classroomId: string): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + classroomId);
    return raw ? (JSON.parse(raw) as CalendarEvent[]) : [];
  } catch {
    return memory.get(classroomId) ?? [];
  }
}

function write(classroomId: string, events: CalendarEvent[]) {
  memory.set(classroomId, events);
  try {
    localStorage.setItem(STORAGE_PREFIX + classroomId, JSON.stringify(events));
  } catch {}
}

export const mockCalendar = {
  async list(classroomId: string): Promise<CalendarEvent[]> {
    return read(classroomId);
  },
  async create(classroomId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    const event = { id: crypto.randomUUID(), classroomId, ...input };
    write(classroomId, [...read(classroomId), event]);
    return event;
  },
  async remove(classroomId: string, id: string): Promise<void> {
    write(
      classroomId,
      read(classroomId).filter((event) => event.id !== id),
    );
  },
};
