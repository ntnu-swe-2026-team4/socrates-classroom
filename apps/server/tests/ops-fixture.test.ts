import {
  OPS_AXIS_PLAN,
  OPS_RANGES,
  OpsClassroomMetricsResponseSchema,
  OpsLiveResponseSchema,
  OpsMetricsResponseSchema,
  type OpsRange,
} from "@socrates/shared";
import { describe, expect, test } from "vitest";
import { buildClassroomMetrics, buildLive, buildMetrics, FIXTURE_CLASSROOMS } from "../src/ops-fixture";

const DAY = 86_400;
const WEEKDAY_NOON = Date.UTC(2026, 10, 16, 5, 7, 33) / 1000;
const SAMPLES = [
  WEEKDAY_NOON,
  WEEKDAY_NOON + 1,
  Date.UTC(2026, 10, 16, 0, 0, 0) / 1000 + 600,
  Date.UTC(2026, 10, 16, 0, 0, 0) / 1000,
  Date.UTC(2026, 10, 15, 23, 59, 59) / 1000,
  Date.UTC(2026, 10, 15, 3, 30, 12) / 1000,
  Date.UTC(2026, 10, 17, 17, 45, 0) / 1000,
];

function issues(result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? []);
}

describe("every fixture response satisfies the contract", () => {
  test("live", () => {
    for (const nowSec of SAMPLES) expect(issues(OpsLiveResponseSchema.safeParse(buildLive(nowSec)))).toEqual([]);
  });

  test("metrics for every range", () => {
    for (const nowSec of SAMPLES) {
      for (const range of OPS_RANGES) {
        expect(issues(OpsMetricsResponseSchema.safeParse(buildMetrics(range, nowSec)))).toEqual([]);
      }
    }
  });

  test("classroom metrics for every classroom and range", () => {
    for (const range of OPS_RANGES) {
      for (const classroom of FIXTURE_CLASSROOMS) {
        const response = buildClassroomMetrics(classroom.id, range, WEEKDAY_NOON);
        expect(issues(OpsClassroomMetricsResponseSchema.safeParse(response))).toEqual([]);
      }
    }
  });

  test("an unknown classroom has no metrics", () => {
    expect(buildClassroomMetrics("nope", "1h", WEEKDAY_NOON)).toBeNull();
  });
});

describe("determinism and stability", () => {
  test("the same input gives byte-identical output", () => {
    expect(JSON.stringify(buildLive(WEEKDAY_NOON))).toBe(JSON.stringify(buildLive(WEEKDAY_NOON)));
    expect(JSON.stringify(buildMetrics("24h", WEEKDAY_NOON))).toBe(JSON.stringify(buildMetrics("24h", WEEKDAY_NOON)));
  });

  test("a cell that has completed does not change on the next poll", () => {
    const first = buildLive(WEEKDAY_NOON);
    const second = buildLive(WEEKDAY_NOON + 5);
    const keep = first.axis.points - 1;
    expect(second.axis.fromSec).toBe(first.axis.fromSec + first.axis.stepSec);
    const shifted = (series: number[]) => [series.slice(1, keep), series.slice(0, keep - 1)] as const;
    for (const [index, channel] of first.channels.entries()) {
      const next = second.channels[index]!;
      expect(shifted(channel.requests)[0]).toEqual(shifted(next.requests)[1]);
      expect(shifted(channel.errors)[0]).toEqual(shifted(next.errors)[1]);
      expect(channel.ttftP95Ms.slice(13, keep)).toEqual(next.ttftP95Ms.slice(12, keep - 1));
    }
    expect(shifted(first.system.turns)[0]).toEqual(shifted(second.system.turns)[1]);
    expect(shifted(first.system.failedTurns)[0]).toEqual(shifted(second.system.failedTurns)[1]);
    expect(first.quotas[0]!.series.slice(1, keep)).toEqual(second.quotas[0]!.series.slice(0, keep - 1));
  });

  test("the in-progress cell only grows while the cell fills", () => {
    const cellStart = Math.floor(WEEKDAY_NOON / 60) * 60;
    let previous = -1;
    for (let offset = 0; offset < 60; offset += 4) {
      const turns = buildMetrics("1h", cellStart + offset).system.turns.at(-1)!;
      expect(turns).toBeGreaterThanOrEqual(previous);
      previous = turns;
    }
  });

  test("a completed cell is the same in a longer range and the next minute", () => {
    const early = buildMetrics("6h", WEEKDAY_NOON);
    const later = buildMetrics("6h", WEEKDAY_NOON + 120);
    expect(early.system.turns.slice(1, -1)).toEqual(later.system.turns.slice(0, -2));
  });
});

describe("what the data says", () => {
  test("the daily allowance resets across 00:00 UTC and never exceeds the contract rules", () => {
    const midnight = Date.UTC(2026, 10, 16) / 1000;
    const live = buildLive(midnight + 600);
    const series = live.quotas[0]!.series as number[];
    expect(series[0]).toBeGreaterThan(series.at(-1)!);
    const allowance = live.quotas[0]!;
    expect(allowance.model === "allowance" && allowance.resetsAtSec).toBe(midnight + DAY);
  });

  test("a weekday afternoon is busier than a weekday night, and a weekend is quiet", () => {
    const busy = buildMetrics("1h", Date.UTC(2026, 10, 16, 5, 30) / 1000);
    const night = buildMetrics("1h", Date.UTC(2026, 10, 15, 18, 30) / 1000);
    const weekend = buildMetrics("1h", Date.UTC(2026, 10, 14, 5, 30) / 1000);
    expect(busy.systemSummary.turns).toBeGreaterThan(night.systemSummary.turns * 5);
    expect(busy.systemSummary.turns).toBeGreaterThan(weekend.systemSummary.turns * 3);
  });

  test("over a weekday the channels show ok, degraded and down at different times", () => {
    const states = new Set<string>();
    const reasons = new Set<string | null>();
    const start = Date.UTC(2026, 10, 16) / 1000;
    for (let offset = 0; offset < DAY; offset += 300) {
      for (const channel of buildLive(start + offset).channels) {
        states.add(channel.usable);
        reasons.add(channel.usableReason);
      }
    }
    expect([...states].sort()).toEqual(["degraded", "down", "ok", "unknown"]);
    expect(reasons.has("breaker_open")).toBe(true);
    expect(reasons.has("error_rate")).toBe(true);
  });

  test("failed turns stay below one error in ten on a normal busy day", () => {
    const day = buildMetrics("24h", Date.UTC(2026, 10, 16, 16) / 1000);
    expect(day.systemSummary.failedTurns).toBeLessThan(day.systemSummary.turns / 10);
  });

  test("class usage adds up to the busiest classroom first and matches the classroom drill-down", () => {
    const metrics = buildMetrics("24h", WEEKDAY_NOON);
    const rows = metrics.classUsage.items;
    expect(rows).toHaveLength(FIXTURE_CLASSROOMS.length);
    expect(rows.map((row) => row.turns)).toEqual([...rows.map((row) => row.turns)].sort((a, b) => b - a));
    const first = rows[0]!;
    const drill = buildClassroomMetrics(first.classroomId, "24h", WEEKDAY_NOON)!;
    expect(drill.turns.reduce((sum, value) => sum + value, 0)).toBe(first.turns);
    expect(drill.failedTurns.reduce((sum, value) => sum + value, 0)).toBe(first.failedTurns);
  });

  test("violation totals by type add up to the per-cell series", () => {
    const metrics = buildMetrics("24h", WEEKDAY_NOON);
    const byType = metrics.violations.byType.reduce((sum, row) => sum + row.count, 0);
    expect(byType).toBe(metrics.violations.counts.reduce((sum, value) => sum + value, 0));
  });

  test("cost stays unknown instead of being invented", () => {
    const metrics = buildMetrics("24h", WEEKDAY_NOON);
    expect(metrics.cost.totalUsd).toBeNull();
    expect(metrics.cost.usd.every((value) => value === null)).toBe(true);
    expect(buildLive(WEEKDAY_NOON).now.spendUsdPerHour).toBeNull();
  });

  test("a summary percentile comes from the merged distribution, not from the cell values", () => {
    const metrics = buildMetrics("24h", WEEKDAY_NOON);
    for (const [index, entry] of metrics.channelSummary.entries()) {
      const cells = metrics.channels[index]!.ttftP95Ms.filter((value): value is number => value !== null);
      if (cells.length === 0 || entry.summary.ttftP95Ms === null) continue;
      const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
      expect(entry.summary.ttftP95Ms).not.toBe(Math.round(mean));
      expect(entry.summary.totalP95Ms).toBeGreaterThanOrEqual(entry.summary.ttftP95Ms);
    }
  });
});

describe("size and privacy", () => {
  test("payloads stay within the budget of the contract", () => {
    expect(JSON.stringify(buildLive(WEEKDAY_NOON)).length).toBeLessThan(30_000);
    for (const range of OPS_RANGES) {
      const plan = OPS_AXIS_PLAN[range];
      expect(plan.points).toBeLessThanOrEqual(360);
      expect(JSON.stringify(buildMetrics(range as OpsRange, WEEKDAY_NOON)).length).toBeLessThan(70_000);
    }
  });

  test("nothing that identifies a person or an invitation appears", () => {
    const text = JSON.stringify([
      buildLive(WEEKDAY_NOON),
      buildMetrics("7d", WEEKDAY_NOON),
      buildClassroomMetrics("fixture-class-a", "7d", WEEKDAY_NOON),
    ]);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/u_[0-9a-f]{32}/);
    expect(text.toLowerCase()).not.toContain("password");
    expect(text.toLowerCase()).not.toContain("invite");
  });
});
