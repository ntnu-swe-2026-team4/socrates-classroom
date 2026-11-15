import {
  OPS_AXIS_PLAN,
  OPS_DEGRADED_ERROR_RATE,
  OPS_DEGRADED_TTFT_MS,
  OPS_LIVE_LATENCY_WINDOW_SEC,
  OPS_MIN_SAMPLES,
  OPS_PURPOSES,
  ADMIN_LIST_CAP,
  type OpsChannelSeries,
  type OpsClassroomMetricsResponse,
  type OpsEvent,
  type OpsLiveChannel,
  type OpsLiveResponse,
  type OpsMetricsResponse,
  type OpsPurpose,
  type OpsPurposeSeries,
  type OpsQuota,
  type OpsRange,
  type OpsSummary,
} from "@socrates/shared";

const DAY = 86_400;
const LOCAL_OFFSET_SEC = 8 * 3600;
const LIVE_WINDOW_CELLS = OPS_LIVE_LATENCY_WINDOW_SEC / OPS_AXIS_PLAN.live.stepSec;
const DAILY_NEURON_LIMIT = 10_000;
const FIXTURE_NEURONS_PER_TURN = 0.95;
const LATENCY_EDGES = [50, 100, 150, 250, 400, 600, 900, 1400, 2000, 3000, 5000, 8000, 15_000, 30_000];
const HISTOGRAM_SIZE = LATENCY_EDGES.length + 1;

const CHANNELS = [
  {
    id: "workers-ai/glm-5.3-flash",
    provider: "workers-ai",
    model: "glm-5.3-flash",
    label: "GLM 5.3 Flash",
    purposes: ["dialogue"] as OpsPurpose[],
    medianMs: 900,
    sigma: 0.45,
    totalFactor: 3.1,
  },
  {
    id: "workers-ai/glm-4.7-flash",
    provider: "workers-ai",
    model: "glm-4.7-flash",
    label: "GLM 4.7 Flash",
    purposes: ["dialogue"] as OpsPurpose[],
    medianMs: 700,
    sigma: 0.4,
    totalFactor: 3.1,
  },
  {
    id: "workers-ai/clef-flash",
    provider: "workers-ai",
    model: "clef-flash",
    label: "Clef Flash",
    purposes: ["judgment", "avatar"] as OpsPurpose[],
    medianMs: 220,
    sigma: 0.35,
    totalFactor: 1,
  },
  {
    id: "workers-ai/whisper-large-v3-turbo",
    provider: "workers-ai",
    model: "whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    purposes: ["speech"] as OpsPurpose[],
    medianMs: 550,
    sigma: 0.4,
    totalFactor: 1,
  },
];
const GLM53 = 0;
const GLM47 = 1;
const CLEF = 2;
const WHISPER = 3;

const ACTIVE_PURPOSES = OPS_PURPOSES.filter((purpose) => purpose !== "search" && purpose !== "other");
const PURPOSE_TOTAL_FACTOR: Record<OpsPurpose, number> = {
  dialogue: 3.1,
  judgment: 1,
  avatar: 1,
  speech: 1,
  search: 1,
  other: 1,
};

export const FIXTURE_CLASSROOMS = [
  { id: "fixture-class-a", name: "示範班 A", weight: 0.24 },
  { id: "fixture-class-b", name: "示範班 B", weight: 0.18 },
  { id: "fixture-class-c", name: "示範班 C", weight: 0.15 },
  { id: "fixture-class-d", name: "示範班 D", weight: 0.13 },
  { id: "fixture-class-e", name: "示範班 E", weight: 0.11 },
  { id: "fixture-class-f", name: "示範班 F", weight: 0.08 },
  { id: "fixture-class-g", name: "示範班 G", weight: 0.06 },
  { id: "fixture-class-h", name: "示範班 H", weight: 0.05 },
];

const VIOLATION_SHARES: { type: "math" | "coding" | "injection" | "other"; share: number }[] = [
  { type: "math", share: 0.35 },
  { type: "coding", share: 0.25 },
  { type: "injection", share: 0.15 },
  { type: "other", share: 0.25 },
];

type IncidentSpec = {
  key: string;
  slotSec: number;
  probability: number;
  offsetMin: number;
  offsetSpan: number;
  durationMin: number;
  durationSpan: number;
};

const RATE_LIMIT_INCIDENT: IncidentSpec = {
  key: "rate-limit",
  slotSec: 900,
  probability: 0.4,
  offsetMin: 60,
  offsetSpan: 300,
  durationMin: 240,
  durationSpan: 300,
};

const CLEF_INCIDENT: IncidentSpec = {
  key: "clef-outage",
  slotSec: 3600,
  probability: 0.2,
  offsetMin: 300,
  offsetSpan: 1200,
  durationMin: 300,
  durationSpan: 300,
};

function hash32(text: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

function unit(...parts: (string | number)[]): number {
  return hash32(parts.join(":")) / 4_294_967_296;
}

function stochastic(value: number, draw: number): number {
  return Math.floor(Math.max(0, value) + draw);
}

function incidentWindow(spec: IncidentSpec, slot: number): { start: number; end: number } | null {
  if (unit(spec.key, slot, "present") >= spec.probability) return null;
  const start = slot * spec.slotSec + spec.offsetMin + Math.floor(unit(spec.key, slot, "offset") * spec.offsetSpan);
  const end = start + spec.durationMin + Math.floor(unit(spec.key, slot, "duration") * spec.durationSpan);
  return { start, end };
}

function incidentAt(spec: IncidentSpec, sec: number): { start: number; end: number } | null {
  const window = incidentWindow(spec, Math.floor(sec / spec.slotSec));
  return window && sec >= window.start && sec < window.end ? window : null;
}

function incidentOverlap(spec: IncidentSpec, startSec: number, stepSec: number): number {
  let overlap = 0;
  for (
    let slot = Math.floor(startSec / spec.slotSec);
    slot <= Math.floor((startSec + stepSec - 1) / spec.slotSec);
    slot++
  ) {
    const window = incidentWindow(spec, slot);
    if (window) overlap += Math.max(0, Math.min(window.end, startSec + stepSec) - Math.max(window.start, startSec));
  }
  return overlap / stepSec;
}

function clefBreakerOpen(sec: number): boolean {
  const window = incidentAt(CLEF_INCIDENT, sec);
  return window !== null && sec >= window.start + 60;
}

function schoolActivity(sec: number): number {
  const local = sec + LOCAL_OFFSET_SEC;
  const hour = (local % DAY) / 3600;
  const weekday = (Math.floor(local / DAY) + 4) % 7;
  const weekend = weekday === 0 || weekday === 6;
  return Math.exp(-(((hour - 13) / 3.2) ** 2)) * (weekend ? 0.12 : 1);
}

function turnRate(sec: number): number {
  return 0.02 + 0.3 * schoolActivity(sec);
}

function presence(sec: number): number {
  return 3 + 36 * schoolActivity(sec);
}

function dayMultiplier(dayIndex: number): number {
  return 0.7 + 0.75 * unit("day", dayIndex);
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? 1 - tail : tail;
}

function histogram(samples: number, medianMs: number, sigma: number): number[] {
  const counts = new Array<number>(HISTOGRAM_SIZE).fill(0);
  let assigned = 0;
  LATENCY_EDGES.forEach((edge, i) => {
    const cumulative = Math.round(normalCdf((Math.log(edge) - Math.log(medianMs)) / sigma) * samples);
    counts[i] = Math.max(0, cumulative - assigned);
    assigned += counts[i] ?? 0;
  });
  counts[HISTOGRAM_SIZE - 1] = Math.max(0, samples - assigned);
  return counts;
}

function mergeHistograms(parts: number[][]): number[] {
  const merged = new Array<number>(HISTOGRAM_SIZE).fill(0);
  for (const part of parts) for (let i = 0; i < HISTOGRAM_SIZE; i++) merged[i] = (merged[i] ?? 0) + (part[i] ?? 0);
  return merged;
}

function percentile95(counts: number[]): number | null {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < OPS_MIN_SAMPLES) return null;
  const target = total * 0.95;
  let accumulated = 0;
  for (let i = 0; i < HISTOGRAM_SIZE; i++) {
    const count = counts[i] ?? 0;
    if (count > 0 && accumulated + count >= target) {
      const low = i === 0 ? 0 : (LATENCY_EDGES[i - 1] ?? 0);
      const high = LATENCY_EDGES[i] ?? (LATENCY_EDGES[LATENCY_EDGES.length - 1] ?? 0) * 2;
      return Math.round(low + (high - low) * ((target - accumulated) / count));
    }
    accumulated += count;
  }
  return LATENCY_EDGES[LATENCY_EDGES.length - 1] ?? null;
}

type ChannelCell = { requests: number; errors: number; hist: number[] };
type SystemCell = {
  startSec: number;
  turns: number;
  failedTurns: number;
  activeUsers: number;
  violations: number;
  channels: ChannelCell[];
  purposes: Record<OpsPurpose, { requests: number; errors: number }>;
};

function systemCell(startSec: number, stepSec: number, fraction: number): SystemCell {
  const draw = (name: string) => unit(name, startSec, stepSec);
  const middle = startSec + stepSec / 2;
  const turns = stochastic(turnRate(middle) * stepSec * fraction * (0.75 + 0.5 * draw("turns")), draw("turns-round"));
  const direct47 = stochastic(turns * 0.1, draw("direct47"));
  const direct53 = turns - direct47;
  const limited = incidentOverlap(RATE_LIMIT_INCIDENT, startSec, stepSec);
  const errors53 = Math.min(direct53, stochastic(direct53 * (0.02 + 0.33 * limited), draw("errors53")));
  const attempts47 = direct47 + errors53;
  const errors47 = Math.min(attempts47, stochastic(attempts47 * 0.015, draw("errors47")));
  const outage = incidentOverlap(CLEF_INCIDENT, startSec, stepSec);
  const classifierCalls = turns * 2;
  const classifierErrors = Math.min(
    classifierCalls,
    stochastic(classifierCalls * (0.005 + 0.795 * outage), draw("clef")),
  );
  const judgmentErrors = Math.min(turns, Math.ceil(classifierErrors / 2));
  const avatarErrors = classifierErrors - judgmentErrors;
  const speechRequests = stochastic(turns * 0.12, draw("speech"));
  const speechErrors = Math.min(speechRequests, stochastic(speechRequests * 0.01, draw("speech-errors")));

  const cell = (requests: number, errors: number, channelIndex: number, latencyScale: number): ChannelCell => {
    const channel = CHANNELS[channelIndex]!;
    const jitter = 0.9 + 0.2 * draw(`latency-${channelIndex}`);
    return {
      requests,
      errors,
      hist: histogram(requests - errors, channel.medianMs * latencyScale * jitter, channel.sigma),
    };
  };

  return {
    startSec,
    turns,
    failedTurns: errors47,
    activeUsers: Math.round(presence(middle) * (0.9 + 0.2 * draw("presence"))),
    violations: stochastic(turns * 0.025, draw("violations")),
    channels: [
      cell(direct53, errors53, GLM53, 1 + 1.2 * limited),
      cell(attempts47, errors47, GLM47, 1),
      cell(classifierCalls, classifierErrors, CLEF, 1),
      cell(speechRequests, speechErrors, WHISPER, 1),
    ],
    purposes: {
      dialogue: { requests: direct53 + attempts47, errors: errors53 + errors47 },
      judgment: { requests: turns, errors: judgmentErrors },
      avatar: { requests: turns, errors: avatarErrors },
      speech: { requests: speechRequests, errors: speechErrors },
      search: { requests: 0, errors: 0 },
      other: { requests: 0, errors: 0 },
    },
  };
}

function scaleCell(cell: SystemCell, weight: number): SystemCell {
  const scale = (value: number) => Math.round(value * weight);
  const purposes = {} as SystemCell["purposes"];
  for (const purpose of OPS_PURPOSES) {
    purposes[purpose] = {
      requests: scale(cell.purposes[purpose].requests),
      errors: scale(cell.purposes[purpose].errors),
    };
  }
  const channels = cell.channels.map((channel) => ({
    requests: scale(channel.requests),
    errors: scale(channel.errors),
    hist: channel.hist.map(scale),
  }));
  return {
    startSec: cell.startSec,
    turns: scale(cell.turns),
    failedTurns: scale(cell.failedTurns),
    activeUsers: cell.activeUsers,
    violations: scale(cell.violations),
    channels,
    purposes,
  };
}

function buildCells(fromSec: number, stepSec: number, points: number, nowSec: number): SystemCell[] {
  const lastStart = fromSec + (points - 1) * stepSec;
  return Array.from({ length: points }, (_, i) => {
    const start = fromSec + i * stepSec;
    const fraction = start === lastStart ? Math.min(1, (nowSec - start + 1) / stepSec) : 1;
    return systemCell(start, stepSec, fraction);
  });
}

function axisFor(plan: { stepSec: number; points: number }, nowSec: number) {
  const lastStart = Math.floor(nowSec / plan.stepSec) * plan.stepSec;
  return { fromSec: lastStart - (plan.points - 1) * plan.stepSec, stepSec: plan.stepSec, points: plan.points };
}

function channelSeries(cells: SystemCell[], windowCells: number): OpsChannelSeries[] {
  return CHANNELS.map((channel, index) => ({
    id: channel.id,
    provider: channel.provider,
    model: channel.model,
    label: channel.label,
    purposes: [...channel.purposes],
    requests: cells.map((cell) => cell.channels[index]!.requests),
    errors: cells.map((cell) => cell.channels[index]!.errors),
    ttftP95Ms: cells.map((_, i) =>
      percentile95(
        mergeHistograms(cells.slice(Math.max(0, i - windowCells + 1), i + 1).map((cell) => cell.channels[index]!.hist)),
      ),
    ),
  }));
}

function purposeSeries(cells: SystemCell[]): OpsPurposeSeries[] {
  return ACTIVE_PURPOSES.map((purpose) => ({
    purpose,
    requests: cells.map((cell) => cell.purposes[purpose].requests),
    errors: cells.map((cell) => cell.purposes[purpose].errors),
  }));
}

function systemSeries(cells: SystemCell[]) {
  return {
    turns: cells.map((cell) => cell.turns),
    failedTurns: cells.map((cell) => cell.failedTurns),
    activeUsers: cells.map((cell) => cell.activeUsers),
  };
}

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

function summaryOf(requests: number[], errors: number[], hist: number[], totalFactor: number): OpsSummary {
  const ttft = percentile95(hist);
  return {
    requests: total(requests),
    errors: total(errors),
    ttftP95Ms: ttft,
    totalP95Ms: ttft === null ? null : Math.round(ttft * totalFactor),
  };
}

function channelSummaries(cells: SystemCell[], series: OpsChannelSeries[]) {
  return series.map((channel, index) => ({
    channelId: channel.id,
    summary: summaryOf(
      channel.requests,
      channel.errors,
      mergeHistograms(cells.map((cell) => cell.channels[index]!.hist)),
      CHANNELS[index]!.totalFactor,
    ),
  }));
}

function purposeSummaries(cells: SystemCell[], series: OpsPurposeSeries[]) {
  return series.map((entry) => {
    const channelIndexes = CHANNELS.flatMap((channel, index) =>
      channel.purposes.includes(entry.purpose) ? [index] : [],
    );
    const hist = mergeHistograms(cells.flatMap((cell) => channelIndexes.map((index) => cell.channels[index]!.hist)));
    return {
      purpose: entry.purpose,
      summary: summaryOf(entry.requests, entry.errors, hist, PURPOSE_TOTAL_FACTOR[entry.purpose]),
    };
  });
}

function dayPrefix(dayIndex: number): Float64Array {
  const prefix = new Float64Array(1441);
  const multiplier = dayMultiplier(dayIndex);
  for (let minute = 0; minute < 1440; minute++) {
    const middle = dayIndex * DAY + minute * 60 + 30;
    prefix[minute + 1] = (prefix[minute] ?? 0) + turnRate(middle) * 60 * FIXTURE_NEURONS_PER_TURN * multiplier;
  }
  return prefix;
}

function neuronLedger() {
  const prefixes = new Map<number, Float64Array>();
  return (sec: number): number => {
    const dayIndex = Math.floor(sec / DAY);
    let prefix = prefixes.get(dayIndex);
    if (!prefix) {
      prefix = dayPrefix(dayIndex);
      prefixes.set(dayIndex, prefix);
    }
    const into = sec - dayIndex * DAY;
    const minute = Math.min(1439, Math.floor(into / 60));
    const whole = prefix[minute] ?? 0;
    const next = prefix[minute + 1] ?? whole;
    return Math.round(whole + (next - whole) * ((into - minute * 60) / 60));
  };
}

function quotasFor(
  axis: { fromSec: number; stepSec: number; points: number },
  nowSec: number,
  series: OpsChannelSeries[],
  ledger: (sec: number) => number,
  liveRate: boolean,
): OpsQuota[] {
  const cumulative = Array.from({ length: axis.points }, (_, i) =>
    ledger(Math.min(axis.fromSec + (i + 1) * axis.stepSec - 1, nowSec)),
  );
  const perMinute = (channelIndex: number, factorSeed: string) =>
    (series[channelIndex]?.requests ?? []).map((requests, i) =>
      Math.round(requests * (60 / axis.stepSec) * (1 + 0.25 * unit(factorSeed, axis.fromSec + i * axis.stepSec))),
    );
  const used = (channelIndex: number) => {
    const requests = series[channelIndex]?.requests ?? [];
    const lastCells = liveRate ? Math.max(1, Math.round(60 / axis.stepSec)) : 1;
    return Math.round((total(requests.slice(-lastCells)) * 60) / (lastCells * axis.stepSec));
  };
  return [
    {
      id: "workers-ai/daily-neurons",
      provider: "workers-ai",
      appliesTo: CHANNELS.map((channel) => channel.id),
      source: "estimated",
      asOfSec: nowSec,
      series: cumulative,
      model: "allowance",
      unit: "neurons",
      used: ledger(nowSec),
      limit: DAILY_NEURON_LIMIT,
      resetsAtSec: (Math.floor(nowSec / DAY) + 1) * DAY,
      usedIsLowerBound: true,
    },
    {
      id: "workers-ai/glm-5.3-flash/rpm",
      provider: "workers-ai",
      appliesTo: [CHANNELS[GLM53]!.id],
      source: "estimated",
      asOfSec: nowSec,
      series: perMinute(GLM53, "rpm-53"),
      model: "rate",
      unit: "requests_per_min",
      used: used(GLM53),
      limit: 20,
    },
    {
      id: "workers-ai/glm-4.7-flash/rpm",
      provider: "workers-ai",
      appliesTo: [CHANNELS[GLM47]!.id],
      source: "estimated",
      asOfSec: nowSec,
      series: perMinute(GLM47, "rpm-47"),
      model: "rate",
      unit: "requests_per_min",
      used: used(GLM47),
      limit: 300,
    },
  ];
}

function eventsFor(cells: SystemCell[], stepSec: number, fromSec: number, nowSec: number) {
  const events: OpsEvent[] = [];
  for (const cell of cells) {
    const failed = cell.channels[GLM53]!.errors;
    if (failed > 0) {
      events.push({
        atSec: Math.min(cell.startSec + Math.floor(stepSec / 2), nowSec),
        channelId: CHANNELS[GLM53]!.id,
        purpose: "dialogue",
        kind: "failover",
        reason: "rate_limited",
        threads: failed,
      });
    }
  }
  for (
    let slot = Math.floor(fromSec / CLEF_INCIDENT.slotSec);
    slot <= Math.floor(nowSec / CLEF_INCIDENT.slotSec);
    slot++
  ) {
    const window = incidentWindow(CLEF_INCIDENT, slot);
    if (!window) continue;
    const opened = window.start + 60;
    const base = {
      channelId: CHANNELS[CLEF]!.id,
      purpose: "judgment" as const,
      reason: "upstream_5xx" as const,
      threads: 0,
    };
    if (opened >= fromSec && opened <= nowSec) events.push({ ...base, atSec: opened, kind: "breaker_open" });
    if (window.end >= fromSec && window.end <= nowSec)
      events.push({ ...base, atSec: window.end, kind: "breaker_closed" });
  }
  events.sort((a, b) => b.atSec - a.atSec);
  return { items: events.slice(0, ADMIN_LIST_CAP), total: events.length };
}

type ChannelState = { usable: OpsLiveChannel["usable"]; reason: OpsLiveChannel["usableReason"] };

function classify(cells: SystemCell[], channelIndex: number, endIndex: number): ChannelState {
  const window = cells.slice(Math.max(0, endIndex - LIVE_WINDOW_CELLS + 1), endIndex + 1);
  const endSec = (cells[endIndex]?.startSec ?? 0) + OPS_AXIS_PLAN.live.stepSec - 1;
  const requests = total(window.map((cell) => cell.channels[channelIndex]!.requests));
  const errors = total(window.map((cell) => cell.channels[channelIndex]!.errors));
  if (channelIndex === CLEF && clefBreakerOpen(endSec)) return { usable: "down", reason: "breaker_open" };
  if (requests === 0) return { usable: "unknown", reason: "no_data" };
  if (errors === requests) return { usable: "down", reason: "error_rate" };
  if (errors / requests >= OPS_DEGRADED_ERROR_RATE) return { usable: "degraded", reason: "error_rate" };
  const p95 = percentile95(mergeHistograms(window.map((cell) => cell.channels[channelIndex]!.hist)));
  if (p95 !== null && p95 > OPS_DEGRADED_TTFT_MS) return { usable: "degraded", reason: "latency" };
  return { usable: "ok", reason: null };
}

export function buildLive(nowSec: number): OpsLiveResponse {
  const axis = axisFor(OPS_AXIS_PLAN.live, nowSec);
  const cells = buildCells(axis.fromSec, axis.stepSec, axis.points, nowSec);
  const lastIndex = cells.length - 1;
  const series = channelSeries(cells, LIVE_WINDOW_CELLS);
  const ledger = neuronLedger();
  const quotas = quotasFor(axis, nowSec, series, ledger, true);
  const lastCell = cells[lastIndex]!;

  const channels: OpsLiveChannel[] = series.map((channel, index) => {
    const state = classify(cells, index, lastIndex);
    let since = lastIndex;
    while (since > 0 && classify(cells, index, since - 1).usable === state.usable) since--;
    return {
      ...channel,
      usable: state.usable,
      usableReason: state.reason,
      usableSinceSec: state.usable === "ok" ? null : cells[since]!.startSec,
      breaker: index === CLEF ? (clefBreakerOpen(nowSec) ? "open" : "closed") : "closed",
      inFlight: Math.round(
        unit("in-flight", index, Math.floor(nowSec / 5)) * 3 * (series[index]?.requests[lastIndex] ? 1 : 0),
      ),
      concurrencyLimit: null,
    };
  });

  const lastMinute = cells.slice(-LIVE_WINDOW_CELLS);
  const minuteRequests = total(lastMinute.flatMap((cell) => cell.channels.map((channel) => channel.requests)));
  const minuteErrors = total(lastMinute.flatMap((cell) => cell.channels.map((channel) => channel.errors)));
  const dialogueHist = mergeHistograms(
    cells.slice(-60).flatMap((cell) => [cell.channels[GLM53]!.hist, cell.channels[GLM47]!.hist]),
  );
  const allowance = quotas[0]!;
  const burnPerSec = (ledger(nowSec) - ledger(nowSec - 900)) / 900;
  const remaining = allowance.model === "allowance" ? allowance.limit - allowance.used : 0;
  const etaSec = burnPerSec > 0 ? Math.max(0, Math.round(remaining / burnPerSec)) : null;

  return {
    source: "fixture",
    generatedAtSec: nowSec,
    latencyWindowSec: OPS_LIVE_LATENCY_WINDOW_SEC,
    now: {
      concurrentUsers: lastCell.activeUsers,
      turnsPerSec: Math.round((total(cells.slice(-6).map((cell) => cell.turns)) / 30) * 100) / 100,
      failedTurns1m: total(lastMinute.map((cell) => cell.failedTurns)),
      errorRate1m: minuteRequests === 0 ? null : Math.round((minuteErrors / minuteRequests) * 1000) / 1000,
      ttftP95Ms5m: percentile95(dialogueHist),
      activeActivities: Math.max(1, Math.round(lastCell.activeUsers / 22)),
      reportsPending: stochastic(0.4, unit("reports", Math.floor(nowSec / 60))),
      spendUsdPerHour: null,
      quotaEta: [
        {
          quotaId: allowance.id,
          etaSec:
            etaSec === null || nowSec + etaSec >= (allowance.model === "allowance" ? allowance.resetsAtSec : 0)
              ? null
              : etaSec,
        },
      ],
    },
    channels,
    purposes: purposeSeries(cells),
    quotas,
    system: systemSeries(cells),
    axis,
    events: eventsFor(cells, axis.stepSec, axis.fromSec, nowSec),
  };
}

function allocate(totalCount: number, weights: number[]): number[] {
  const raw = weights.map((weight) => weight * totalCount);
  const floors = raw.map(Math.floor);
  let remainder = totalCount - total(floors);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    remainder--;
  }
  return floors;
}

export function buildMetrics(range: OpsRange, nowSec: number): OpsMetricsResponse {
  const plan = OPS_AXIS_PLAN[range];
  const axis = axisFor(plan, nowSec);
  const cells = buildCells(axis.fromSec, axis.stepSec, axis.points, nowSec);
  const series = channelSeries(cells, 1);
  const purposes = purposeSeries(cells);
  const system = systemSeries(cells);
  const violationCounts = cells.map((cell) => cell.violations);
  const typeTotals = allocate(
    total(violationCounts),
    VIOLATION_SHARES.map((entry) => entry.share),
  );

  const classUsage = FIXTURE_CLASSROOMS.map((classroom) => {
    const scaled = cells.map((cell) => scaleCell(cell, classroom.weight));
    return {
      classroomId: classroom.id,
      name: classroom.name,
      turns: total(scaled.map((cell) => cell.turns)),
      failedTurns: total(scaled.map((cell) => cell.failedTurns)),
      errors: total(scaled.flatMap((cell) => cell.channels.map((channel) => channel.errors))),
      tokens: null,
      costUsd: null,
    };
  }).sort((a, b) => b.turns - a.turns);

  return {
    source: "fixture",
    range,
    generatedAtSec: nowSec,
    latencyWindowSec: axis.stepSec,
    axis,
    channels: series,
    channelSummary: channelSummaries(cells, series),
    purposes,
    purposeSummary: purposeSummaries(cells, purposes),
    quotas: quotasFor(axis, nowSec, series, neuronLedger(), false),
    system,
    systemSummary: {
      turns: total(system.turns),
      failedTurns: total(system.failedTurns),
      peakActiveUsers: Math.max(...system.activeUsers),
    },
    events: eventsFor(cells, axis.stepSec, axis.fromSec, nowSec),
    classUsage: { items: classUsage, total: classUsage.length },
    violations: {
      byType: VIOLATION_SHARES.map((entry, index) => ({ type: entry.type, count: typeTotals[index] ?? 0 })),
      counts: violationCounts,
    },
    cost: { totalUsd: null, usd: cells.map(() => null) },
  };
}

export function buildClassroomMetrics(
  classroomId: string,
  range: OpsRange,
  nowSec: number,
): OpsClassroomMetricsResponse | null {
  const classroom = FIXTURE_CLASSROOMS.find((entry) => entry.id === classroomId);
  if (!classroom) return null;
  const axis = axisFor(OPS_AXIS_PLAN[range], nowSec);
  const cells = buildCells(axis.fromSec, axis.stepSec, axis.points, nowSec).map((cell) =>
    scaleCell(cell, classroom.weight),
  );
  const series = channelSeries(cells, 1);
  const failures: OpsClassroomMetricsResponse["recentFailures"]["items"] = [];
  let failureTotal = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i]!;
    cell.channels.forEach((channel, channelIndex) => {
      for (let k = 0; k < channel.errors; k++) {
        failureTotal++;
        if (failures.length < ADMIN_LIST_CAP) {
          failures.push({
            atSec: Math.min(cell.startSec + Math.floor(((k + 1) / (channel.errors + 1)) * axis.stepSec), nowSec),
            channelId: CHANNELS[channelIndex]!.id,
            purpose: CHANNELS[channelIndex]!.purposes[0]!,
            reason: channelIndex === GLM53 ? "rate_limited" : "upstream_5xx",
            ttftMs: null,
          });
        }
      }
    });
  }
  failures.sort((a, b) => b.atSec - a.atSec);
  return {
    source: "fixture",
    classroom: { id: classroom.id, name: classroom.name },
    range,
    generatedAtSec: nowSec,
    latencyWindowSec: axis.stepSec,
    axis,
    channels: series,
    channelSummary: channelSummaries(cells, series),
    turns: cells.map((cell) => cell.turns),
    failedTurns: cells.map((cell) => cell.failedTurns),
    recentFailures: { items: failures, total: failureTotal },
  };
}
