import { OPS_DEGRADED_TTFT_MS, type OpsAxis, type OpsChannelSeries, type OpsSystemSeries } from "@socrates/shared";

export interface CellRow {
  startSec: number;
  partial: boolean;
}

export interface TurnRow extends CellRow {
  ok: number;
  failed: number;
}

export type LatencyRow = CellRow & Record<string, number | boolean | null>;

export const partialKey = (channelId: string) => `${channelId}\u0000partial`;

export function cellRows(axis: OpsAxis): CellRow[] {
  return Array.from({ length: axis.points }, (_, i) => ({
    startSec: axis.fromSec + i * axis.stepSec,
    partial: i === axis.points - 1,
  }));
}

export function cellDivisor(row: CellRow, axis: OpsAxis, generatedAtSec: number): number {
  return row.partial ? Math.max(1, generatedAtSec - row.startSec) : axis.stepSec;
}

export function turnRows(
  system: Pick<OpsSystemSeries, "turns" | "failedTurns">,
  axis: OpsAxis,
  generatedAtSec: number,
  perSecond: boolean,
): TurnRow[] {
  return cellRows(axis).map((row, i) => {
    const turns = system.turns[i] ?? 0;
    const failed = Math.min(system.failedTurns[i] ?? 0, turns);
    const divisor = perSecond ? cellDivisor(row, axis, generatedAtSec) : 1;
    return { ...row, ok: (turns - failed) / divisor, failed: failed / divisor };
  });
}

export function latencyRows(
  channels: readonly Pick<OpsChannelSeries, "id" | "ttftP95Ms">[],
  axis: OpsAxis,
): LatencyRow[] {
  return cellRows(axis).map((row, i) => {
    const out: LatencyRow = { ...row };
    for (const channel of channels) {
      const value = channel.ttftP95Ms[i] ?? null;
      const last = i === axis.points - 1;
      out[channel.id] = last ? null : value;
      out[partialKey(channel.id)] = last ? value : i === axis.points - 2 ? value : null;
    }
    return out;
  });
}

export function latencyYMax(channels: readonly Pick<OpsChannelSeries, "ttftP95Ms">[]): number {
  const highest = Math.max(
    0,
    ...channels.flatMap((channel) => channel.ttftP95Ms.filter((v): v is number => v !== null)),
  );
  const ceiling = Math.max(OPS_DEGRADED_TTFT_MS * 1.2, highest * 1.1);
  return Math.ceil(ceiling / 500) * 500;
}

export function axisTickFormat(axis: OpsAxis, locale: string): (startSec: number) => string {
  const spanSec = axis.stepSec * axis.points;
  const options: Intl.DateTimeFormatOptions =
    spanSec > 2 * 86_400
      ? { month: "numeric", day: "numeric", hour: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
  const formatter = new Intl.DateTimeFormat(locale, options);
  return (startSec) => formatter.format(new Date(startSec * 1000));
}
