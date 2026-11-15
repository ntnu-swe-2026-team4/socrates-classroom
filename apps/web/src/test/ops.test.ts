import { expect, test } from "vitest";
import {
  LIVE_WINDOW_CELLS,
  formatCount,
  formatDuration,
  formatMs,
  formatPercent,
  labelOf,
  lastTotal,
  overall,
  peakOf,
  pick,
  ratio,
} from "@/lib/ops";

const channel = (
  label: string,
  usable: "ok" | "degraded" | "down" | "unknown",
  usableSinceSec: number | null = null,
) => ({
  label,
  usable,
  usableSinceSec,
});

test("the live window is the contract's 60 s expressed in 5 s cells", () => {
  expect(LIVE_WINDOW_CELLS).toBe(12);
});

test("lastTotal sums only the trailing window", () => {
  const values = Array.from({ length: 20 }, (_, i) => i);
  expect(lastTotal(values)).toBe(values.slice(-12).reduce((a, b) => a + b, 0));
  expect(lastTotal([1, 2, 3], 2)).toBe(5);
  expect(lastTotal([])).toBe(0);
});

test("a down channel outranks a degraded one, and only the worst group is named", () => {
  const result = overall([
    channel("A", "degraded", 100),
    channel("B", "down", 300),
    channel("C", "down", 200),
    channel("D", "ok"),
  ]);
  expect(result).toEqual({ state: "down", labels: ["B", "C"], sinceSec: 200 });
});

test("degraded without a start time has no duration, and ok names nothing", () => {
  expect(overall([channel("A", "degraded"), channel("B", "ok")])).toEqual({
    state: "degraded",
    labels: ["A"],
    sinceSec: null,
  });
  expect(overall([channel("A", "ok"), channel("B", "unknown")])).toEqual({ state: "ok", labels: [], sinceSec: null });
});

test("only when every channel is unknown is the overall state unknown", () => {
  expect(overall([channel("A", "unknown"), channel("B", "unknown")]).state).toBe("unknown");
  expect(overall([]).state).toBe("ok");
});

test("missing values print as a dash, never as zero", () => {
  expect(formatMs(null, "en")).toBe("—");
  expect(formatPercent(null, "en")).toBe("—");
  expect(formatCount(null, "en")).toBe("—");
  expect(formatCount(0, "en")).toBe("0");
  expect(ratio(3, 0)).toBeNull();
  expect(ratio(0, 4)).toBe(0);
});

test("latency switches to seconds at one second and follows the locale", () => {
  expect(formatMs(800, "en")).toContain("800");
  expect(formatMs(800, "en")).not.toContain("s ");
  expect(formatMs(2800, "en")).toContain("2.8");
  expect(formatMs(2800, "zh-TW")).toContain("2.8");
  expect(formatMs(2800, "zh-TW")).toContain("秒");
  expect(formatPercent(0.125, "en")).toBe("12.5%");
});

test("durations read in minutes under an hour and in hours above it", () => {
  expect(formatDuration(30, "en")).toContain("1");
  expect(formatDuration(1500, "en")).toContain("25");
  expect(formatDuration(13_320, "en")).toContain("3.7");
  expect(formatDuration(13_320, "zh-TW")).toContain("小時");
});

test("the peak of a series ignores gaps and is null when nothing was recorded", () => {
  expect(peakOf([3, null, 9, 4])).toBe(9);
  expect(peakOf([null, null])).toBeNull();
  expect(peakOf([])).toBeNull();
});

test("lookups fall back to the raw value and never reach into the prototype", () => {
  const styles = { a: 1 };
  expect(pick(styles, "a", 0)).toBe(1);
  expect(pick(styles, "b", 0)).toBe(0);
  expect(pick(styles, "constructor", 0)).toBe(0);
  const keys = { known: "admin_chan_ok" } as const;
  const t = ((key: string) => `T:${key}`) as never;
  expect(labelOf(keys, "known", t)).toBe("T:admin_chan_ok");
  expect(labelOf(keys, "other", t)).toBe("other");
  expect(labelOf(keys, "toString", t)).toBe("toString");
});

test("an unrecognized state counts as no data in the overall verdict", () => {
  const odd = { label: "X", usable: "paused" as never, usableSinceSec: null };
  expect(overall([odd]).state).toBe("unknown");
  expect(overall([odd, channel("B", "ok")]).state).toBe("ok");
});
