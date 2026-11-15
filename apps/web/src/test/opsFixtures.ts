import {
  OPS_AXIS_PLAN,
  OPS_LIVE_LATENCY_WINDOW_SEC,
  type OpsClassroomMetricsResponse,
  type OpsEvent,
  type OpsLiveResponse,
  type OpsMetricsResponse,
} from "@socrates/shared";

export const DAY = 86_400;
export const NOON = 20_407 * DAY + 12 * 3600;

export const filled = <T>(length: number, value: T) => Array.from({ length }, () => value);

export const event = (atSec: number): OpsEvent => ({
  atSec,
  channelId: "workers-ai/glm-5.3-flash",
  purpose: "dialogue",
  kind: "failover",
  reason: "rate_limited",
  threads: 1,
});

export function seriesBlock(points: number) {
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

export function quotasFor(points: number, asOfSec: number) {
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

export function liveResponse(): OpsLiveResponse {
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

export function metricsResponse(): OpsMetricsResponse {
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

export function classroomResponse(): OpsClassroomMetricsResponse {
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
