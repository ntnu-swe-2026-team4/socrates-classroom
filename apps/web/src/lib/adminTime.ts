export interface DayBucket {
  day: string;
  classrooms: number;
  joins: number;
}

const HOUR_MS = 3_600_000;

export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function lastDayKeys(now: Date, days: number, timeZone: string): string[] {
  const keys: string[] = [];
  for (let hours = days * 24 + 23; hours >= 0; hours -= 1) {
    const key = dayKey(new Date(now.getTime() - hours * HOUR_MS), timeZone);
    if (keys.at(-1) !== key) keys.push(key);
  }
  return keys.slice(-days);
}

export function bucketByDay(
  hourly: ReadonlyArray<{ hour: string; classrooms: number; joins: number }>,
  timeZone: string,
  days: number,
  now: Date = new Date(),
): DayBucket[] {
  const buckets = new Map<string, DayBucket>(
    lastDayKeys(now, days, timeZone).map((day) => [day, { day, classrooms: 0, joins: 0 }]),
  );
  for (const row of hourly) {
    const bucket = buckets.get(dayKey(new Date(row.hour), timeZone));
    if (!bucket) continue;
    bucket.classrooms += row.classrooms;
    bucket.joins += row.joins;
  }
  return [...buckets.values()];
}

export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}
