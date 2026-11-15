import { expect, test } from "vitest";
import { LIVE_WINDOW_CELLS, formatCount, formatMs, formatPercent, lastTotal, overall, ratio } from "@/lib/ops";

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
