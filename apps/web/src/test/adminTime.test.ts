import { describe, expect, it } from "vitest";
import { bucketByDay, dayKey, formatDateTime, lastDayKeys } from "@/lib/adminTime";

const row = { hour: "2026-11-14T16:00:00Z", classrooms: 2, joins: 5 };
const now = new Date("2026-11-15T10:00:00Z");

describe("admin time helpers", () => {
  it("formats day keys as YYYY-MM-DD in the requested zone", () => {
    expect(dayKey(new Date("2026-11-14T16:30:00Z"), "UTC")).toBe("2026-11-14");
    expect(dayKey(new Date("2026-11-14T16:30:00Z"), "Asia/Taipei")).toBe("2026-11-15");
    expect(dayKey(new Date("2026-11-14T16:30:00Z"), "America/Los_Angeles")).toBe("2026-11-14");
  });

  it("puts the same UTC hour on different days depending on the viewer's time zone", () => {
    const dayOf = (timeZone: string) =>
      bucketByDay([row], timeZone, 7, now).find((bucket) => bucket.classrooms > 0)?.day;
    expect(dayOf("UTC")).toBe("2026-11-14");
    expect(dayOf("Asia/Taipei")).toBe("2026-11-15");
    expect(dayOf("America/Los_Angeles")).toBe("2026-11-14");
  });

  it("returns exactly `days` ordered buckets and fills the gaps with zeros", () => {
    const buckets = bucketByDay([row], "UTC", 7, now);
    expect(buckets.map((bucket) => bucket.day)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(buckets.filter((bucket) => bucket.classrooms === 0 && bucket.joins === 0)).toHaveLength(6);
  });

  it("sums several hours of the same local day", () => {
    const hourly = [
      { hour: "2026-11-14T01:00:00Z", classrooms: 1, joins: 1 },
      { hour: "2026-11-14T22:00:00Z", classrooms: 3, joins: 4 },
    ];
    const bucket = bucketByDay(hourly, "UTC", 7, now).find((item) => item.day === "2026-11-14");
    expect(bucket).toEqual({ day: "2026-11-14", classrooms: 4, joins: 5 });
  });

  it("ignores rows older than the window", () => {
    const old = { hour: "2026-10-01T00:00:00Z", classrooms: 9, joins: 9 };
    expect(bucketByDay([old], "UTC", 7, now).every((bucket) => bucket.classrooms === 0)).toBe(true);
  });

  it("keeps seven distinct consecutive days across a daylight-saving change", () => {
    const keys = lastDayKeys(new Date("2026-11-03T12:00:00Z"), 7, "America/New_York");
    expect(keys).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    const dstDay = bucketByDay(
      [{ hour: "2026-11-01T05:30:00Z", classrooms: 1, joins: 0 }],
      "America/New_York",
      7,
      new Date("2026-11-03T12:00:00Z"),
    );
    expect(dstDay.find((bucket) => bucket.day === "2026-11-01")?.classrooms).toBe(1);
  });

  it("formats a timestamp for the viewer's locale and zone", () => {
    expect(formatDateTime("2026-11-14T16:30:00Z", "en", "UTC")).toContain("4:30");
    expect(formatDateTime("2026-11-14T16:30:00Z", "en", "Asia/Taipei")).toContain("12:30");
  });
});
