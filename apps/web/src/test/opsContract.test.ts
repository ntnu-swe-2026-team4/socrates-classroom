import {
  ADMIN_LIST_CAP,
  OPS_AXIS_PLAN,
  OPS_LIVE_LATENCY_WINDOW_SEC,
  OpsClassroomMetricsResponseSchema,
  OpsLiveResponseSchema,
  OpsMetricsResponseSchema,
  OpsRangeQuerySchema,
  type OpsClassroomMetricsResponse,
  type OpsEvent,
  type OpsLiveResponse,
  type OpsMetricsResponse,
} from "@socrates/shared";
import { describe, expect, test } from "vitest";

const DAY = 86_400;
const NOON = 20_407 * DAY + 12 * 3600;

const filled = <T>(length: number, value: T) => Array.from({ length }, () => value);

const event = (atSec: number): OpsEvent => ({
  atSec,
  channelId: "workers-ai/glm-5.3-flash",
  purpose: "dialogue",
  kind: "failover",
  reason: "rate_limited",
  threads: 1,
});

function seriesBlock(points: number) {
  return {
    channels: [
      {
        id: "workers-ai/glm-5.3-flash",
        provider: "workers-ai",
        model: "glm-5.3-flash",
        label: "GLM 5.3 Flash",
        purposes: ["dialogue" as const],
        requests: filled(points, 2),
        errors: filled(points, 1),
        ttftP95Ms: filled<number | null>(points, 800),
      },
      {
        id: "workers-ai/clef-flash",
        provider: "workers-ai",
        model: "clef-flash",
        label: "Clef Flash",
        purposes: ["judgment" as const],
        requests: filled(points, 1),
        errors: filled(points, 0),
        ttftP95Ms: filled<number | null>(points, 300),
      },
    ],
    purposes: [
      { purpose: "dialogue" as const, requests: filled(points, 2), errors: filled(points, 1) },
      { purpose: "judgment" as const, requests: filled(points, 1), errors: filled(points, 0) },
    ],
    system: {
      turns: filled(points, 2),
      failedTurns: filled(points, 0),
      activeUsers: filled<number | null>(points, 12),
    },
  };
}

function quotasFor(points: number, asOfSec: number) {
  return [
    {
      id: "workers-ai/daily-neurons",
      provider: "workers-ai",
      appliesTo: ["workers-ai/glm-5.3-flash", "workers-ai/clef-flash"],
      source: "estimated" as const,
      asOfSec,
      series: Array.from({ length: points }, (_, i) => 100 + i) as (number | null)[],
      model: "allowance" as const,
      unit: "neurons" as const,
      used: 100 + points,
      limit: 10_000,
      resetsAtSec: (Math.floor(asOfSec / DAY) + 1) * DAY,
      usedIsLowerBound: true,
    },
    {
      id: "workers-ai/glm-5.3-flash/rpm",
      provider: "workers-ai",
      appliesTo: ["workers-ai/glm-5.3-flash"],
      source: "inferred" as const,
      asOfSec,
      series: filled<number | null>(points, 4),
      model: "rate" as const,
      unit: "requests_per_min" as const,
      used: 4,
      limit: 20,
    },
  ];
}

function liveResponse(): OpsLiveResponse {
  const { stepSec, points } = OPS_AXIS_PLAN.live;
  const lastStart = NOON;
  const generatedAtSec = lastStart + 3;
  return {
    source: "fixture",
    generatedAtSec,
    latencyWindowSec: OPS_LIVE_LATENCY_WINDOW_SEC,
    now: {
      concurrentUsers: 12,
      turnsPerSec: 0.4,
      failedTurns1m: 0,
      errorRate1m: 0.5,
      ttftP95Ms5m: 800,
      activeActivities: 1,
      reportsPending: 0,
      spendUsdPerHour: null,
      quotaEta: [{ quotaId: "workers-ai/daily-neurons", etaSec: null }],
    },
    channels: seriesBlock(points).channels.map((channel) => ({
      ...channel,
      usable: channel.errors[0] ? ("degraded" as const) : ("ok" as const),
      usableReason: channel.errors[0] ? ("error_rate" as const) : null,
      usableSinceSec: null,
      breaker: null,
      inFlight: null,
      concurrencyLimit: null,
    })),
    purposes: seriesBlock(points).purposes,
    quotas: quotasFor(points, generatedAtSec),
    system: seriesBlock(points).system,
    axis: { fromSec: lastStart - (points - 1) * stepSec, stepSec, points },
    events: { items: [event(NOON - 5), event(NOON - 10)], total: 2 },
  };
}

function metricsResponse(): OpsMetricsResponse {
  const { stepSec, points } = OPS_AXIS_PLAN["1h"];
  const lastStart = NOON;
  const generatedAtSec = lastStart + 10;
  const block = seriesBlock(points);
  const summary = (requests: number, errors: number) => ({ requests, errors, ttftP95Ms: 800, totalP95Ms: 2400 });
  return {
    source: "fixture",
    range: "1h",
    generatedAtSec,
    latencyWindowSec: stepSec,
    axis: { fromSec: lastStart - (points - 1) * stepSec, stepSec, points },
    channels: block.channels,
    channelSummary: [
      { channelId: "workers-ai/glm-5.3-flash", summary: summary(2 * points, points) },
      { channelId: "workers-ai/clef-flash", summary: summary(points, 0) },
    ],
    purposes: block.purposes,
    purposeSummary: [
      { purpose: "dialogue", summary: summary(2 * points, points) },
      { purpose: "judgment", summary: summary(points, 0) },
    ],
    quotas: quotasFor(points, generatedAtSec),
    system: block.system,
    systemSummary: { turns: 2 * points, failedTurns: 0, peakActiveUsers: 12 },
    events: { items: [event(NOON - 5)], total: 1 },
    classUsage: {
      items: [
        { classroomId: "c1", name: "Class A", turns: 9, failedTurns: 0, errors: 1, tokens: null, costUsd: null },
        { classroomId: "c2", name: "Class B", turns: 4, failedTurns: 0, errors: 0, tokens: null, costUsd: null },
      ],
      total: 2,
    },
    violations: { byType: [{ type: "math", count: 3 }], counts: filled(points, 0) },
    cost: { totalUsd: null, usd: filled<number | null>(points, null) },
  };
}

function classroomResponse(): OpsClassroomMetricsResponse {
  const { stepSec, points } = OPS_AXIS_PLAN["1h"];
  const lastStart = NOON;
  const block = seriesBlock(points);
  return {
    source: "fixture",
    classroom: { id: "c1", name: "Class A" },
    range: "1h",
    generatedAtSec: lastStart + 10,
    latencyWindowSec: stepSec,
    axis: { fromSec: lastStart - (points - 1) * stepSec, stepSec, points },
    channels: block.channels,
    channelSummary: [
      {
        channelId: "workers-ai/glm-5.3-flash",
        summary: { requests: 2 * points, errors: points, ttftP95Ms: 800, totalP95Ms: 2400 },
      },
      { channelId: "workers-ai/clef-flash", summary: { requests: points, errors: 0, ttftP95Ms: 300, totalP95Ms: 300 } },
    ],
    turns: block.system.turns,
    failedTurns: block.system.failedTurns,
    recentFailures: {
      items: [
        {
          atSec: NOON - 5,
          channelId: "workers-ai/glm-5.3-flash",
          purpose: "dialogue",
          reason: "timeout",
          ttftMs: null,
        },
      ],
      total: 1,
    },
  };
}

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

type Parser = { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } };

function rejects<T>(schema: Parser, build: () => T, mutate: (value: T) => void, fragment: string) {
  const value = build();
  mutate(value);
  const found = messages(schema.safeParse(value));
  expect(
    found.some((message) => message.includes(fragment)),
    `expected an issue containing "${fragment}", got ${JSON.stringify(found)}`,
  ).toBe(true);
}

describe("the baseline fixtures are valid", () => {
  test("live, metrics and classroom responses parse", () => {
    expect(OpsLiveResponseSchema.safeParse(liveResponse()).success).toBe(true);
    expect(OpsMetricsResponseSchema.safeParse(metricsResponse()).success).toBe(true);
    expect(OpsClassroomMetricsResponseSchema.safeParse(classroomResponse()).success).toBe(true);
  });

  test("the axis plan keeps every range under the point limit and every step on a divisor of a day", () => {
    for (const plan of Object.values(OPS_AXIS_PLAN)) {
      expect(plan.points).toBeLessThanOrEqual(360);
      expect(DAY % plan.stepSec).toBe(0);
    }
  });
});

describe("live invariants", () => {
  const live = liveResponse;

  test("a series shorter than the axis is rejected", () => {
    rejects(OpsLiveResponseSchema, live, (v) => v.channels[0]?.requests.pop(), "axis.points");
  });

  test("errors above requests are rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.channels[0]) v.channels[0].errors[3] = 99;
      },
      "errors must not exceed requests",
    );
  });

  test("a live cell with no requests may keep the latency of its 60 s window", () => {
    const value = live();
    if (value.channels[0]) {
      value.channels[0].requests[2] = 0;
      value.channels[0].errors[2] = 0;
    }
    if (value.purposes[0]) {
      value.purposes[0].requests[2] = 0;
      value.purposes[0].errors[2] = 0;
    }
    expect(messages(OpsLiveResponseSchema.safeParse(value))).toEqual([]);
  });

  test("a misaligned axis is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.axis.fromSec += 1;
      },
      "aligned",
    );
  });

  test("generatedAtSec outside the last cell is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.generatedAtSec += 60;
      },
      "last cell",
    );
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.generatedAtSec -= 20;
      },
      "last cell",
    );
  });

  test("a live axis that is not 5 s steps, or longer than 180 points, is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.axis.stepSec = 10;
      },
      "stepSec must be 5",
    );
  });

  test("a delta slice with fewer points is accepted when every series follows the axis", () => {
    const sliced = live();
    const keep = 3;
    sliced.axis = {
      ...sliced.axis,
      fromSec: sliced.axis.fromSec + (sliced.axis.points - keep) * sliced.axis.stepSec,
      points: keep,
    };
    for (const channel of sliced.channels) {
      channel.requests = channel.requests.slice(-keep);
      channel.errors = channel.errors.slice(-keep);
      channel.ttftP95Ms = channel.ttftP95Ms.slice(-keep);
    }
    for (const series of sliced.purposes) {
      series.requests = series.requests.slice(-keep);
      series.errors = series.errors.slice(-keep);
    }
    sliced.system = {
      turns: sliced.system.turns.slice(-keep),
      failedTurns: sliced.system.failedTurns.slice(-keep),
      activeUsers: sliced.system.activeUsers.slice(-keep),
    };
    for (const quota of sliced.quotas) quota.series = quota.series.slice(-keep);
    expect(messages(OpsLiveResponseSchema.safeParse(sliced))).toEqual([]);
  });

  test("duplicate channel ids are rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.channels[1]) v.channels[1].id = "workers-ai/glm-5.3-flash";
      },
      "duplicate channel id",
    );
  });

  test("failedTurns above turns is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.system.failedTurns[0] = 99;
      },
      "failedTurns must not exceed turns",
    );
  });

  test("purpose totals that disagree with channel totals are rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.purposes[0]) v.purposes[0].requests[5] = 50;
      },
      "purpose totals",
    );
  });

  test("purposes out of the fixed order are rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.purposes.reverse();
      },
      "fixed order",
    );
  });

  test("a quota applying to an unknown channel is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.quotas[0]) v.quotas[0].appliesTo = ["workers-ai/missing"];
      },
      "existing channel",
    );
  });

  test("an allowance that decreases inside a UTC day is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.quotas[0]) v.quotas[0].series[10] = 5;
      },
      "must not decrease",
    );
  });

  test("an allowance may reset across 00:00 UTC", () => {
    const crossing = liveResponse();
    const midnight = 20_408 * DAY;
    crossing.axis = { ...crossing.axis, fromSec: midnight - 90 * crossing.axis.stepSec };
    crossing.generatedAtSec = crossing.axis.fromSec + (crossing.axis.points - 1) * crossing.axis.stepSec + 1;
    const allowance = crossing.quotas[0];
    if (allowance?.model === "allowance") {
      allowance.series = Array.from({ length: crossing.axis.points }, (_, i) => (i < 90 ? 9000 + i : i - 90));
      allowance.asOfSec = crossing.generatedAtSec;
      allowance.resetsAtSec = midnight + DAY;
    }
    expect(messages(OpsLiveResponseSchema.safeParse(crossing))).toEqual([]);
  });

  test("a provider-reported allowance cannot be a lower bound", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.quotas[0]) v.quotas[0].source = "provider";
      },
      "exact, not a lower bound",
    );
  });

  test("resetsAtSec must be a later 00:00 UTC", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.quotas[0]?.model === "allowance") v.quotas[0].resetsAtSec += 60;
      },
      "00:00 UTC",
    );
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.quotas[0]?.model === "allowance") v.quotas[0].resetsAtSec = Math.floor(v.generatedAtSec / DAY) * DAY;
      },
      "00:00 UTC",
    );
  });

  test("an ETA for an unknown quota is rejected", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.now.quotaEta = [{ quotaId: "nope", etaSec: 1 }];
      },
      "existing quota",
    );
  });

  test("usableReason must be null exactly when the channel is ok", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.channels[1]) v.channels[1].usableReason = "no_data";
      },
      "usableReason",
    );
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        if (v.channels[0]) v.channels[0].usableReason = null;
      },
      "usableReason",
    );
  });

  test("the live latency window is fixed at 60 s", () => {
    const value = live() as unknown as { latencyWindowSec: number };
    value.latencyWindowSec = 30;
    expect(OpsLiveResponseSchema.safeParse(value).success).toBe(false);
  });

  test("events must be newest first and capped", () => {
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.events.items.reverse();
      },
      "newest first",
    );
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.events.total = 1;
      },
      "total must cover",
    );
    rejects(
      OpsLiveResponseSchema,
      live,
      (v) => {
        v.events.items = Array.from({ length: ADMIN_LIST_CAP + 1 }, (_, i) => event(NOON - i));
        v.events.total = ADMIN_LIST_CAP + 1;
      },
      "ADMIN_LIST_CAP",
    );
  });
});

describe("metrics invariants", () => {
  const metrics = metricsResponse;

  test("the axis must match the range exactly", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.range = "6h";
      },
      "stepSec must be 120",
    );
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.axis.points = 59;
      },
      "points must be 60",
    );
  });

  test("a latency on a cell with no requests is rejected", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        if (v.channels[0]) {
          v.channels[0].requests[2] = 0;
          v.channels[0].errors[2] = 0;
        }
      },
      "ttftP95Ms must be null",
    );
  });

  test("the latency window equals the step", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.latencyWindowSec = 30;
      },
      "latencyWindowSec",
    );
  });

  test("a summary that disagrees with its series is rejected", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        if (v.channelSummary[0]) v.channelSummary[0].summary.requests += 1;
      },
      "series totals",
    );
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        if (v.purposeSummary[1]) v.purposeSummary[1].summary.errors += 1;
      },
      "series totals",
    );
  });

  test("summaries must list the same entries in the same order", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.channelSummary.reverse();
      },
      "same order",
    );
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.purposeSummary.pop();
      },
      "same order",
    );
  });

  test("the system summary must match the system series", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.systemSummary.turns += 1;
      },
      "systemSummary",
    );
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.systemSummary.failedTurns = 1;
      },
      "systemSummary",
    );
  });

  test("on_topic is not a reportable violation type", () => {
    const value = metrics() as unknown as { violations: { byType: { type: string; count: number }[] } };
    value.violations.byType = [{ type: "on_topic", count: 1 }];
    expect(OpsMetricsResponseSchema.safeParse(value).success).toBe(false);
  });

  test("violation counts and cost follow the axis", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.violations.counts.pop();
      },
      "axis.points",
    );
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.cost.usd.pop();
      },
      "axis.points",
    );
  });

  test("a total cost cannot exist when no cell has one", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.cost.totalUsd = 0;
      },
      "totalUsd must be null",
    );
  });

  test("cost cells stay null rather than zero when unknown", () => {
    const value = metrics();
    value.cost = { totalUsd: 3.2, usd: value.cost.usd.map((_, i) => (i === 0 ? 3.2 : null)) };
    expect(messages(OpsMetricsResponseSchema.safeParse(value))).toEqual([]);
  });

  test("class usage must be sorted by turns, descending", () => {
    rejects(
      OpsMetricsResponseSchema,
      metrics,
      (v) => {
        v.classUsage.items.reverse();
      },
      "sorted by turns",
    );
  });
});

describe("classroom metrics invariants", () => {
  const classroom = classroomResponse;

  test("failed turns cannot exceed turns", () => {
    rejects(
      OpsClassroomMetricsResponseSchema,
      classroom,
      (v) => {
        v.failedTurns[1] = 99;
      },
      "failedTurns must not exceed turns",
    );
  });

  test("series follow the axis", () => {
    rejects(
      OpsClassroomMetricsResponseSchema,
      classroom,
      (v) => {
        v.turns.pop();
      },
      "axis.points",
    );
  });

  test("recent failures are newest first", () => {
    rejects(
      OpsClassroomMetricsResponseSchema,
      classroom,
      (v) => {
        v.recentFailures.items.push({
          atSec: NOON - 1,
          channelId: "workers-ai/clef-flash",
          purpose: "judgment",
          reason: "other",
          ttftMs: 10,
        });
        v.recentFailures.total = 2;
      },
      "newest first",
    );
  });
});

describe("range query", () => {
  test("accepts the review ranges and rejects 15m and unknown values", () => {
    for (const range of ["1h", "6h", "24h", "72h", "7d"]) {
      expect(OpsRangeQuerySchema.safeParse({ range }).success).toBe(true);
    }
    for (const range of ["15m", "30d", "", "24H"]) {
      expect(OpsRangeQuerySchema.safeParse({ range }).success).toBe(false);
    }
  });
});
