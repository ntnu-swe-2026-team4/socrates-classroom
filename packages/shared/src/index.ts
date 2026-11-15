import { z } from "zod";
import { ClassReportSchema, StudentAnalysisSchema, type ClassReport, type StudentAnalysis } from "./reports";

export type Lang = "zh" | "en" | "es";
export const LANG_NAMES: Record<Lang, string> = {
  zh: "Traditional Chinese (繁體中文)",
  en: "English",
  es: "Spanish (Español)",
};

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["student", "teacher"]),
});
export type User = z.infer<typeof UserSchema>;

export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  statement: z.string(),
  summary: z.string().optional(),
  prompts: z.array(z.string()),
});
export type Topic = z.infer<typeof TopicSchema>;

export const JoinInfoSchema = z.object({
  code: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
});
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const ClassroomCreatedSchema = z.object({
  classroomId: z.string(),
  code: z.string(),
  url: z.string(),
  activityId: z.string(),
});
export type ClassroomCreated = z.infer<typeof ClassroomCreatedSchema>;

export const ActivityInfoSchema = z.object({
  id: z.string(),
  classroomId: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
  finishedAt: z.string().nullable(),
});
export type ActivityInfo = z.infer<typeof ActivityInfoSchema>;

export const StudentLiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "speaking", "idle"]),
  rounds: z.number(),
  flagged: z.boolean(),
  flagReason: z.string().optional(),
  lastUtterance: z.string(),
});
export type StudentLive = z.infer<typeof StudentLiveSchema>;

export const VIOLATION_TYPES = ["on_topic", "math", "coding", "injection", "other"] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const ViolationSliceSchema = z.object({
  turn: z.number().int(),
  type: z.enum(VIOLATION_TYPES),
  excerpt: z.string(),
});

export interface ViolationSlice {
  turn: number;
  type: ViolationType;
  excerpt: string;
}

export const ReportPositionSchema = z.object({
  axis: z.string(),
  view: z.string(),
  end: z.enum(["low", "middle", "high"]),
  at: z.number().int().min(0).max(100),
});

export const StudentReportEntrySchema = z.object({
  pseudonym: z.string(),
  analysis: StudentAnalysisSchema.nullable(),
  violations: z.array(ViolationSliceSchema),
  positions: z.array(ReportPositionSchema),
});

export const StoredTeacherReportSchema = z.object({
  topicTitle: z.string(),
  classReport: ClassReportSchema.nullable(),
});

export const StoredStudentReportsSchema = z.record(z.string(), StudentReportEntrySchema);

export interface ReportPosition {
  axis: string;
  view: string;
  end: "low" | "middle" | "high";
  at: number;
}

export interface StudentReportEntry {
  studentId: string;
  pseudonym: string;
  analysis: StudentAnalysis | null;
  violations: ViolationSlice[];
  positions: ReportPosition[];
}

export interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport | null;
  students: StudentReportEntry[];
}

export interface StudentReport {
  topicTitle: string;
  pseudonym: string;
  analysis: StudentAnalysis | null;
  violations: ViolationSlice[];
  positions: ReportPosition[];
}
export type Report = TeacherReport | StudentReport;

export const TermExplanationSchema = z.object({ term: z.string(), markdown: z.string() });
export type TermExplanation = z.infer<typeof TermExplanationSchema>;

const emailField = z.email().transform((value) => value.toLowerCase());

export const LoginInputSchema = z.object({ email: emailField, password: z.string().min(8).max(128) });
export const RegisterInputSchema = z.object({
  code: z.string().min(4).max(32),
  email: emailField,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
  tosAccepted: z.boolean(),
});
export const JoinInputSchema = z.object({
  code: z.string().min(4).max(32),
  name: z.string().trim().max(80).optional(),
  tosAccepted: z.boolean(),
});
export const TopicCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(1).max(2000),
  summary: z.string().trim().max(500).optional(),
  prompts: z.array(z.string().trim().min(1).max(160)).max(6),
});
export const GenerateTopicsInputSchema = z.object({
  direction: z.string().trim().min(1).max(200),
});
export const ClassroomCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  topicId: z.string().min(1),
});
export const ActivityStartInputSchema = z.object({ topicId: z.string().min(1) });
export const DialogueInputSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const LookupInputSchema = z.object({ term: z.string().trim().min(1).max(30) });
export const TtsInputSchema = z.object({ text: z.string().min(1).max(2000), lang: z.enum(["zh", "en", "es"]) });
export const ClassroomSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["teacher", "student"]),
  teacherName: z.string(),
  memberCount: z.number(),
  code: z.string().nullable(),
  url: z.string().nullable(),
  current: z
    .object({
      activityId: z.string(),
      topicId: z.string(),
      topicTitle: z.string(),
      topicStatement: z.string(),
      finished: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
});
export type ClassroomSummary = z.infer<typeof ClassroomSummarySchema>;

export const ADMIN_LIST_CAP = 100;

function cappedList<T extends z.ZodType>(item: T) {
  return z
    .object({ items: z.array(item), total: z.number() })
    .refine((list) => list.items.length <= ADMIN_LIST_CAP && list.total >= list.items.length, {
      message: "items must not exceed ADMIN_LIST_CAP and total must cover items",
    });
}

export const AdminDashboardSchema = z.object({
  generatedAt: z.string(),
  stuckAfterMs: z.number(),
  counts: z.object({
    byRole: z.record(z.string(), z.number()),
    classrooms: z.number(),
    activeActivities: z.number(),
    finishedActivities: z.number(),
    memberships: z.number(),
  }),
  reports: z.object({
    byStatus: z.object({ pending: z.number(), partial: z.number(), ready: z.number(), failed: z.number() }),
    stuck: cappedList(z.object({ activityId: z.string(), updatedAt: z.string() })),
    finishedWithoutReport: cappedList(z.object({ activityId: z.string(), finishedAt: z.string() })),
  }),
  recentClassrooms: cappedList(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      members: z.number(),
      state: z.enum(["none", "active", "finished"]),
    }),
  ),
  emptyClassrooms: cappedList(z.object({ id: z.string(), name: z.string(), createdAt: z.string() })),
  hourly: z.array(z.object({ hour: z.string(), classrooms: z.number(), joins: z.number() })),
});
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;

export const OPS_PURPOSES = ["dialogue", "judgment", "avatar", "speech", "search", "other"] as const;
export const OpsPurposeSchema = z.enum(OPS_PURPOSES);
export type OpsPurpose = z.infer<typeof OpsPurposeSchema>;

export const OPS_RANGES = ["1h", "6h", "24h", "72h", "7d"] as const;
export const OpsRangeSchema = z.enum(OPS_RANGES);
export type OpsRange = z.infer<typeof OpsRangeSchema>;
export const OpsRangeQuerySchema = z.object({ range: OpsRangeSchema });

export const OPS_AXIS_PLAN = {
  live: { stepSec: 5, points: 180 },
  "1h": { stepSec: 60, points: 60 },
  "6h": { stepSec: 120, points: 180 },
  "24h": { stepSec: 300, points: 288 },
  "72h": { stepSec: 900, points: 288 },
  "7d": { stepSec: 1800, points: 336 },
} as const satisfies Record<"live" | OpsRange, { stepSec: number; points: number }>;
export const OPS_MAX_POINTS = 360;
export const OPS_MIN_SAMPLES = 5;
export const OPS_LIVE_LATENCY_WINDOW_SEC = 60;
export const OPS_DEGRADED_TTFT_MS = 5000;
export const OPS_DEGRADED_ERROR_RATE = 0.05;

const SECONDS_PER_DAY = 86_400;
const opsSec = z.number().int().min(0);
const opsCount = z.number().int().min(0);
const opsCounts = z.array(opsCount);
const opsLatencies = z.array(z.number().min(0).nullable());
const opsSource = z.enum(["fixture", "live"]);

export const OpsAxisSchema = z
  .object({
    fromSec: opsSec,
    stepSec: z.number().int().min(1),
    points: z.number().int().min(1).max(OPS_MAX_POINTS),
  })
  .refine((axis) => axis.fromSec % axis.stepSec === 0, { message: "fromSec must be aligned to stepSec" });
export type OpsAxis = z.infer<typeof OpsAxisSchema>;

export const OpsChannelSeriesSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  label: z.string().min(1),
  purposes: z.array(OpsPurposeSchema).min(1),
  requests: opsCounts,
  errors: opsCounts,
  ttftP95Ms: opsLatencies,
});
export type OpsChannelSeries = z.infer<typeof OpsChannelSeriesSchema>;

export const OpsSystemSeriesSchema = z.object({
  turns: opsCounts,
  failedTurns: opsCounts,
  activeUsers: z.array(opsCount.nullable()),
});
export type OpsSystemSeries = z.infer<typeof OpsSystemSeriesSchema>;

export const OpsPurposeSeriesSchema = z.object({
  purpose: OpsPurposeSchema,
  requests: opsCounts,
  errors: opsCounts,
});
export type OpsPurposeSeries = z.infer<typeof OpsPurposeSeriesSchema>;

export const OpsEventSchema = z.object({
  atSec: opsSec,
  channelId: z.string().min(1),
  purpose: OpsPurposeSchema,
  kind: z.enum(["failover", "breaker_open", "breaker_closed", "reassign"]),
  reason: z.enum(["rate_limited", "timeout", "upstream_5xx", "quota_exhausted", "payment_required", "other"]),
  threads: opsCount,
});
export type OpsEvent = z.infer<typeof OpsEventSchema>;

export const OpsSummarySchema = z.object({
  requests: opsCount,
  errors: opsCount,
  ttftP95Ms: z.number().min(0).nullable(),
  totalP95Ms: z.number().min(0).nullable(),
});
export type OpsSummary = z.infer<typeof OpsSummarySchema>;

const opsQuotaBase = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  appliesTo: z.array(z.string().min(1)).min(1),
  source: z.enum(["provider", "estimated", "inferred"]),
  asOfSec: opsSec,
  series: z.array(z.number().min(0).nullable()),
});

export const OpsQuotaSchema = z.discriminatedUnion("model", [
  opsQuotaBase.extend({
    model: z.literal("allowance"),
    unit: z.literal("neurons"),
    used: z.number().min(0),
    limit: z.number().positive(),
    resetsAtSec: opsSec,
    usedIsLowerBound: z.boolean(),
  }),
  opsQuotaBase.extend({
    model: z.literal("rate"),
    unit: z.literal("requests_per_min"),
    used: z.number().min(0),
    limit: z.number().positive(),
  }),
]);
export type OpsQuota = z.infer<typeof OpsQuotaSchema>;

export const OpsLiveChannelSchema = OpsChannelSeriesSchema.extend({
  usable: z.enum(["ok", "degraded", "down", "unknown"]),
  usableReason: z
    .enum(["error_rate", "latency", "breaker_open", "quota_exhausted", "payment_required", "no_data"])
    .nullable(),
  usableSinceSec: opsSec.nullable(),
  breaker: z.enum(["closed", "open", "half_open"]).nullable(),
  inFlight: opsCount.nullable(),
  concurrencyLimit: opsCount.nullable(),
});
export type OpsLiveChannel = z.infer<typeof OpsLiveChannelSchema>;

type OpsRefinementCtx = z.RefinementCtx;
type OpsPath = (string | number)[];

function opsFail(ctx: OpsRefinementCtx, path: OpsPath, message: string) {
  ctx.addIssue({ code: "custom", message, path });
}

function opsCheckLastCell(ctx: OpsRefinementCtx, generatedAtSec: number, axis: OpsAxis) {
  const lastStart = axis.fromSec + (axis.points - 1) * axis.stepSec;
  if (generatedAtSec < lastStart || generatedAtSec >= lastStart + axis.stepSec) {
    opsFail(ctx, ["generatedAtSec"], "generatedAtSec must fall inside the last cell of the axis");
  }
}

function opsCheckLength(ctx: OpsRefinementCtx, path: OpsPath, values: readonly unknown[], axis: OpsAxis) {
  if (values.length !== axis.points) opsFail(ctx, path, `length must equal axis.points (${axis.points})`);
}

function opsCheckAxisPlan(
  ctx: OpsRefinementCtx,
  axis: OpsAxis,
  plan: { stepSec: number; points: number },
  exact: boolean,
) {
  if (axis.stepSec !== plan.stepSec) opsFail(ctx, ["axis", "stepSec"], `stepSec must be ${plan.stepSec}`);
  if (exact ? axis.points !== plan.points : axis.points > plan.points) {
    opsFail(ctx, ["axis", "points"], `points must be ${exact ? "" : "at most "}${plan.points}`);
  }
}

function opsCheckChannels(ctx: OpsRefinementCtx, channels: OpsChannelSeries[], axis: OpsAxis, windowed: boolean) {
  const seen = new Set<string>();
  channels.forEach((channel, i) => {
    const at: OpsPath = ["channels", i];
    if (seen.has(channel.id)) opsFail(ctx, [...at, "id"], "duplicate channel id");
    seen.add(channel.id);
    opsCheckLength(ctx, [...at, "requests"], channel.requests, axis);
    opsCheckLength(ctx, [...at, "errors"], channel.errors, axis);
    opsCheckLength(ctx, [...at, "ttftP95Ms"], channel.ttftP95Ms, axis);
    channel.requests.forEach((requests, j) => {
      if ((channel.errors[j] ?? 0) > requests) opsFail(ctx, [...at, "errors", j], "errors must not exceed requests");
      if (!windowed && requests === 0 && (channel.ttftP95Ms[j] ?? null) !== null) {
        opsFail(ctx, [...at, "ttftP95Ms", j], "ttftP95Ms must be null when there were no requests");
      }
    });
  });
}

function opsCheckPurposes(
  ctx: OpsRefinementCtx,
  purposes: OpsPurposeSeries[],
  channels: OpsChannelSeries[],
  axis: OpsAxis,
) {
  let lastRank = -1;
  purposes.forEach((series, i) => {
    const at: OpsPath = ["purposes", i];
    const rank = OPS_PURPOSES.indexOf(series.purpose);
    if (rank <= lastRank) opsFail(ctx, [...at, "purpose"], "purposes must be unique and in the fixed order");
    lastRank = rank;
    opsCheckLength(ctx, [...at, "requests"], series.requests, axis);
    opsCheckLength(ctx, [...at, "errors"], series.errors, axis);
    series.requests.forEach((requests, j) => {
      if ((series.errors[j] ?? 0) > requests) opsFail(ctx, [...at, "errors", j], "errors must not exceed requests");
    });
  });
  for (let j = 0; j < axis.points; j++) {
    const sum = (rows: { requests: number[]; errors: number[] }[], key: "requests" | "errors") =>
      rows.reduce((total, row) => total + (row[key][j] ?? 0), 0);
    if (
      sum(purposes, "requests") !== sum(channels, "requests") ||
      sum(purposes, "errors") !== sum(channels, "errors")
    ) {
      opsFail(ctx, ["purposes"], `purpose totals must equal channel totals at cell ${j}`);
      break;
    }
  }
}

function opsCheckTurns(ctx: OpsRefinementCtx, turns: number[], failedTurns: number[], axis: OpsAxis, at: OpsPath) {
  opsCheckLength(ctx, [...at, "turns"], turns, axis);
  opsCheckLength(ctx, [...at, "failedTurns"], failedTurns, axis);
  turns.forEach((count, j) => {
    if ((failedTurns[j] ?? 0) > count) opsFail(ctx, [...at, "failedTurns", j], "failedTurns must not exceed turns");
  });
}

function opsCheckSystem(ctx: OpsRefinementCtx, system: OpsSystemSeries, axis: OpsAxis) {
  opsCheckTurns(ctx, system.turns, system.failedTurns, axis, ["system"]);
  opsCheckLength(ctx, ["system", "activeUsers"], system.activeUsers, axis);
}

function opsCheckQuotas(ctx: OpsRefinementCtx, quotas: OpsQuota[], channelIds: Set<string>, axis: OpsAxis) {
  const seen = new Set<string>();
  quotas.forEach((quota, i) => {
    const at: OpsPath = ["quotas", i];
    if (seen.has(quota.id)) opsFail(ctx, [...at, "id"], "duplicate quota id");
    seen.add(quota.id);
    opsCheckLength(ctx, [...at, "series"], quota.series, axis);
    quota.appliesTo.forEach((channelId, k) => {
      if (!channelIds.has(channelId))
        opsFail(ctx, [...at, "appliesTo", k], "appliesTo must reference an existing channel");
    });
    if (quota.model !== "allowance") return;
    if (quota.source === "provider" && quota.usedIsLowerBound) {
      opsFail(ctx, [...at, "usedIsLowerBound"], "a provider-reported value is exact, not a lower bound");
    }
    if (quota.resetsAtSec % SECONDS_PER_DAY !== 0 || quota.resetsAtSec <= quota.asOfSec) {
      opsFail(ctx, [...at, "resetsAtSec"], "resetsAtSec must be a later 00:00 UTC");
    }
    let previous: number | null = null;
    let previousDay = -1;
    quota.series.forEach((value, j) => {
      if (value === null) return;
      const day = Math.floor((axis.fromSec + j * axis.stepSec) / SECONDS_PER_DAY);
      if (day === previousDay && previous !== null && value < previous) {
        opsFail(ctx, [...at, "series", j], "allowance series must not decrease within a UTC day");
      }
      previous = value;
      previousDay = day;
    });
  });
}

function opsCheckSummaries(
  ctx: OpsRefinementCtx,
  path: string,
  summaries: { key: string; summary: OpsSummary }[],
  series: { key: string; requests: number[]; errors: number[] }[],
) {
  if (summaries.length !== series.length || summaries.some((entry, i) => entry.key !== series[i]?.key)) {
    opsFail(ctx, [path], "summaries must list the same entries as the series, in the same order");
    return;
  }
  const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
  summaries.forEach((entry, i) => {
    const row = series[i];
    if (!row) return;
    if (entry.summary.requests !== total(row.requests) || entry.summary.errors !== total(row.errors)) {
      opsFail(ctx, [path, i], "summary requests and errors must equal the series totals");
    }
  });
}

function opsCheckSortedDescending(ctx: OpsRefinementCtx, path: OpsPath, values: number[], message: string) {
  values.forEach((value, i) => {
    if (i > 0 && value > (values[i - 1] ?? value)) opsFail(ctx, [...path, i], message);
  });
}

export const OpsLiveResponseSchema = z
  .object({
    source: opsSource,
    generatedAtSec: opsSec,
    latencyWindowSec: z.literal(OPS_LIVE_LATENCY_WINDOW_SEC),
    now: z.object({
      concurrentUsers: opsCount.nullable(),
      turnsPerSec: z.number().min(0),
      failedTurns1m: opsCount,
      errorRate1m: z.number().min(0).max(1).nullable(),
      ttftP95Ms5m: z.number().min(0).nullable(),
      activeActivities: opsCount,
      reportsPending: opsCount,
      spendUsdPerHour: z.number().min(0).nullable(),
      quotaEta: z.array(z.object({ quotaId: z.string().min(1), etaSec: opsCount.nullable() })),
    }),
    channels: z.array(OpsLiveChannelSchema),
    purposes: z.array(OpsPurposeSeriesSchema),
    quotas: z.array(OpsQuotaSchema),
    system: OpsSystemSeriesSchema,
    axis: OpsAxisSchema,
    events: cappedList(OpsEventSchema),
  })
  .superRefine((live, ctx) => {
    opsCheckAxisPlan(ctx, live.axis, OPS_AXIS_PLAN.live, false);
    opsCheckLastCell(ctx, live.generatedAtSec, live.axis);
    opsCheckChannels(ctx, live.channels, live.axis, true);
    opsCheckPurposes(ctx, live.purposes, live.channels, live.axis);
    opsCheckSystem(ctx, live.system, live.axis);
    opsCheckQuotas(ctx, live.quotas, new Set(live.channels.map((channel) => channel.id)), live.axis);
    const quotaIds = new Set(live.quotas.map((quota) => quota.id));
    live.now.quotaEta.forEach((eta, i) => {
      if (!quotaIds.has(eta.quotaId))
        opsFail(ctx, ["now", "quotaEta", i, "quotaId"], "quotaId must reference an existing quota");
    });
    live.channels.forEach((channel, i) => {
      if ((channel.usable === "ok") !== (channel.usableReason === null)) {
        opsFail(ctx, ["channels", i, "usableReason"], "usableReason must be null exactly when usable is ok");
      }
    });
    opsCheckSortedDescending(
      ctx,
      ["events", "items"],
      live.events.items.map((event) => event.atSec),
      "items must be sorted newest first",
    );
  });
export type OpsLiveResponse = z.infer<typeof OpsLiveResponseSchema>;

export const OpsMetricsResponseSchema = z
  .object({
    source: opsSource,
    range: OpsRangeSchema,
    generatedAtSec: opsSec,
    latencyWindowSec: z.number().int().min(1),
    axis: OpsAxisSchema,
    channels: z.array(OpsChannelSeriesSchema),
    channelSummary: z.array(z.object({ channelId: z.string().min(1), summary: OpsSummarySchema })),
    purposes: z.array(OpsPurposeSeriesSchema),
    purposeSummary: z.array(z.object({ purpose: OpsPurposeSchema, summary: OpsSummarySchema })),
    quotas: z.array(OpsQuotaSchema),
    system: OpsSystemSeriesSchema,
    systemSummary: z.object({ turns: opsCount, failedTurns: opsCount, peakActiveUsers: opsCount.nullable() }),
    events: cappedList(OpsEventSchema),
    classUsage: cappedList(
      z.object({
        classroomId: z.string().min(1),
        name: z.string(),
        turns: opsCount,
        failedTurns: opsCount,
        errors: opsCount,
        tokens: opsCount.nullable(),
        costUsd: z.number().min(0).nullable(),
      }),
    ),
    violations: z.object({
      byType: z.array(z.object({ type: z.enum(VIOLATION_TYPES).exclude(["on_topic"]), count: opsCount })),
      counts: opsCounts,
    }),
    cost: z.object({ totalUsd: z.number().min(0).nullable(), usd: opsLatencies }),
  })
  .superRefine((metrics, ctx) => {
    opsCheckAxisPlan(ctx, metrics.axis, OPS_AXIS_PLAN[metrics.range], true);
    opsCheckLastCell(ctx, metrics.generatedAtSec, metrics.axis);
    if (metrics.latencyWindowSec !== metrics.axis.stepSec) {
      opsFail(ctx, ["latencyWindowSec"], "latencyWindowSec must equal axis.stepSec");
    }
    opsCheckChannels(ctx, metrics.channels, metrics.axis, false);
    opsCheckPurposes(ctx, metrics.purposes, metrics.channels, metrics.axis);
    opsCheckSystem(ctx, metrics.system, metrics.axis);
    opsCheckQuotas(ctx, metrics.quotas, new Set(metrics.channels.map((channel) => channel.id)), metrics.axis);
    opsCheckSummaries(
      ctx,
      "channelSummary",
      metrics.channelSummary.map((entry) => ({ key: entry.channelId, summary: entry.summary })),
      metrics.channels.map((channel) => ({ key: channel.id, requests: channel.requests, errors: channel.errors })),
    );
    opsCheckSummaries(
      ctx,
      "purposeSummary",
      metrics.purposeSummary.map((entry) => ({ key: entry.purpose, summary: entry.summary })),
      metrics.purposes.map((series) => ({ key: series.purpose, requests: series.requests, errors: series.errors })),
    );
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
    if (
      metrics.systemSummary.turns !== total(metrics.system.turns) ||
      metrics.systemSummary.failedTurns !== total(metrics.system.failedTurns)
    ) {
      opsFail(ctx, ["systemSummary"], "systemSummary must equal the system series totals");
    }
    opsCheckLength(ctx, ["violations", "counts"], metrics.violations.counts, metrics.axis);
    opsCheckLength(ctx, ["cost", "usd"], metrics.cost.usd, metrics.axis);
    if (metrics.cost.usd.every((value) => value === null) && metrics.cost.totalUsd !== null) {
      opsFail(ctx, ["cost", "totalUsd"], "totalUsd must be null when no cell has a cost");
    }
    opsCheckSortedDescending(
      ctx,
      ["events", "items"],
      metrics.events.items.map((event) => event.atSec),
      "items must be sorted newest first",
    );
    opsCheckSortedDescending(
      ctx,
      ["classUsage", "items"],
      metrics.classUsage.items.map((row) => row.turns),
      "items must be sorted by turns, descending",
    );
  });
export type OpsMetricsResponse = z.infer<typeof OpsMetricsResponseSchema>;

export const OpsClassroomMetricsResponseSchema = z
  .object({
    source: opsSource,
    classroom: z.object({ id: z.string().min(1), name: z.string() }),
    range: OpsRangeSchema,
    generatedAtSec: opsSec,
    latencyWindowSec: z.number().int().min(1),
    axis: OpsAxisSchema,
    channels: z.array(OpsChannelSeriesSchema),
    channelSummary: z.array(z.object({ channelId: z.string().min(1), summary: OpsSummarySchema })),
    turns: opsCounts,
    failedTurns: opsCounts,
    recentFailures: cappedList(
      z.object({
        atSec: opsSec,
        channelId: z.string().min(1),
        purpose: OpsPurposeSchema,
        reason: OpsEventSchema.shape.reason,
        ttftMs: z.number().min(0).nullable(),
      }),
    ),
  })
  .superRefine((metrics, ctx) => {
    opsCheckAxisPlan(ctx, metrics.axis, OPS_AXIS_PLAN[metrics.range], true);
    opsCheckLastCell(ctx, metrics.generatedAtSec, metrics.axis);
    if (metrics.latencyWindowSec !== metrics.axis.stepSec) {
      opsFail(ctx, ["latencyWindowSec"], "latencyWindowSec must equal axis.stepSec");
    }
    opsCheckChannels(ctx, metrics.channels, metrics.axis, false);
    opsCheckTurns(ctx, metrics.turns, metrics.failedTurns, metrics.axis, []);
    opsCheckSummaries(
      ctx,
      "channelSummary",
      metrics.channelSummary.map((entry) => ({ key: entry.channelId, summary: entry.summary })),
      metrics.channels.map((channel) => ({ key: channel.id, requests: channel.requests, errors: channel.errors })),
    );
    opsCheckSortedDescending(
      ctx,
      ["recentFailures", "items"],
      metrics.recentFailures.items.map((failure) => failure.atSec),
      "items must be sorted newest first",
    );
  });
export type OpsClassroomMetricsResponse = z.infer<typeof OpsClassroomMetricsResponseSchema>;

export const TeacherKeyStatusSchema = z.object({
  provider: z.string(),
  model: z.string(),
  last4: z.string(),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
export type TeacherKeyStatus = z.infer<typeof TeacherKeyStatusSchema>;

export const ViolationChoiceSchema = z.object({
  type: z.string(),
  probability: z.number().min(0).max(1),
});

export const SttResultSchema = z.object({ text: z.string() });
export type SttResult = z.infer<typeof SttResultSchema>;

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation",
  "rate_limited",
  "internal_error",
  "join_code_invalid",
  "tos_required",
  "name_taken",
  "only_student",
  "already_streaming",
  "activity_finished",
  "llm_unavailable",
  "llm_rate_limited",
  "llm_timeout",
  "report_pending",
  "report_failed",
  "byok_provider_invalid",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}
export * from "./reports";
