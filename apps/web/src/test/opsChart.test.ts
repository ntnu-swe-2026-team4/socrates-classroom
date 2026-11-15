import { OPS_DEGRADED_TTFT_MS } from "@socrates/shared";
import { expect, test } from "vitest";
import { axisTickFormat, cellDivisor, cellRows, latencyRows, latencyYMax, partialKey, turnRows } from "@/lib/opsChart";

const axis = { fromSec: 1000, stepSec: 5, points: 4 };

test("cell rows follow the axis and only the last cell is in progress", () => {
  expect(cellRows(axis)).toEqual([
    { startSec: 1000, partial: false },
    { startSec: 1005, partial: false },
    { startSec: 1010, partial: false },
    { startSec: 1015, partial: true },
  ]);
});

test("a finished cell divides by its step, the in-progress cell by the time elapsed in it", () => {
  const rows = cellRows(axis);
  expect(cellDivisor(rows[0]!, axis, 1017)).toBe(5);
  expect(cellDivisor(rows[3]!, axis, 1017)).toBe(2);
  expect(cellDivisor(rows[3]!, axis, 1015)).toBe(1);
});

test("live turns become per-second rates, with the failed share split out of the total", () => {
  const rows = turnRows({ turns: [10, 5, 0, 4], failedTurns: [0, 5, 0, 2] }, axis, 1017, true);
  expect(rows.map((row) => row.ok)).toEqual([2, 0, 0, 1]);
  expect(rows.map((row) => row.failed)).toEqual([0, 1, 0, 1]);
  expect(rows[3]?.partial).toBe(true);
});

test("review turns stay as counts per cell", () => {
  const rows = turnRows({ turns: [10, 5, 0, 4], failedTurns: [1, 0, 0, 0] }, axis, 1017, false);
  expect(rows.map((row) => row.ok)).toEqual([9, 5, 0, 4]);
  expect(rows.map((row) => row.failed)).toEqual([1, 0, 0, 0]);
});

test("failed turns can never exceed the turns they belong to", () => {
  const rows = turnRows({ turns: [2, 0, 0, 0], failedTurns: [5, 3, 0, 0] }, axis, 1017, false);
  expect(rows[0]).toMatchObject({ ok: 0, failed: 2 });
  expect(rows[1]).toMatchObject({ ok: 0, failed: 0 });
});

test("latency keeps gaps as null and moves the last point onto the dashed series", () => {
  const rows = latencyRows([{ id: "a", ttftP95Ms: [100, null, 300, 400] }], axis);
  expect(rows.map((row) => row.a)).toEqual([100, null, 300, null]);
  expect(rows.map((row) => row[partialKey("a")])).toEqual([null, null, 300, 400]);
});

test("a last point with no previous value is drawn as a lone dashed point, and an empty last cell draws nothing", () => {
  const lone = latencyRows([{ id: "a", ttftP95Ms: [100, 200, null, 400] }], axis);
  expect(lone.map((row) => row[partialKey("a")])).toEqual([null, null, null, 400]);
  const empty = latencyRows([{ id: "a", ttftP95Ms: [100, 200, 300, null] }], axis);
  expect(empty.map((row) => row[partialKey("a")])).toEqual([null, null, 300, null]);
});

test("the latency axis always reaches past the degraded threshold and past the highest value", () => {
  expect(latencyYMax([{ ttftP95Ms: [100, null] }])).toBeGreaterThan(OPS_DEGRADED_TTFT_MS);
  expect(latencyYMax([{ ttftP95Ms: [null, null] }])).toBeGreaterThan(OPS_DEGRADED_TTFT_MS);
  expect(latencyYMax([{ ttftP95Ms: [20_000] }])).toBeGreaterThanOrEqual(22_000);
});

test("short ranges label ticks with the time, ranges over two days with the date", () => {
  const stamp = Date.UTC(2026, 10, 16, 5, 30) / 1000;
  const short = axisTickFormat({ fromSec: 0, stepSec: 5, points: 180 }, "en")(stamp);
  const long = axisTickFormat({ fromSec: 0, stepSec: 1800, points: 336 }, "en")(stamp);
  expect(short).toMatch(/\d{1,2}:\d{2}/);
  expect(long).toMatch(/\d{1,2}\/\d{1,2}/);
});
