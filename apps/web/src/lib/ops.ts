import { OPS_AXIS_PLAN, OPS_LIVE_LATENCY_WINDOW_SEC, type OpsLiveChannel } from "@socrates/shared";

export type ChannelState = OpsLiveChannel["usable"];

export const LIVE_WINDOW_CELLS = OPS_LIVE_LATENCY_WINDOW_SEC / OPS_AXIS_PLAN.live.stepSec;

export function lastTotal(values: readonly number[], cells = LIVE_WINDOW_CELLS): number {
  return values.slice(-cells).reduce((sum, value) => sum + value, 0);
}

export interface Overall {
  state: ChannelState;
  labels: string[];
  sinceSec: number | null;
}

export function overall(channels: readonly Pick<OpsLiveChannel, "label" | "usable" | "usableSinceSec">[]): Overall {
  const pick = (state: ChannelState) => channels.filter((channel) => channel.usable === state);
  const affected = pick("down").length > 0 ? pick("down") : pick("degraded");
  if (affected.length > 0) {
    const since = affected.flatMap((channel) => (channel.usableSinceSec === null ? [] : [channel.usableSinceSec]));
    return {
      state: pick("down").length > 0 ? "down" : "degraded",
      labels: affected.map((channel) => channel.label),
      sinceSec: since.length > 0 ? Math.min(...since) : null,
    };
  }
  const allUnknown = channels.length > 0 && channels.every((channel) => channel.usable === "unknown");
  return { state: allUnknown ? "unknown" : "ok", labels: [], sinceSec: null };
}

export function formatMs(ms: number | null, locale: string): string {
  if (ms === null) return "—";
  return ms >= 1000
    ? new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 1 }).format(ms / 1000)
    : new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", maximumFractionDigits: 0 }).format(ms);
}

export function formatPercent(ratio: number | null, locale: string): string {
  if (ratio === null) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

export function formatCount(value: number | null, locale: string): string {
  return value === null ? "—" : new Intl.NumberFormat(locale).format(value);
}

export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}
