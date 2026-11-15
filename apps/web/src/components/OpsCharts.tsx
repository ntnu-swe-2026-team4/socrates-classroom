import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  OPS_DEGRADED_TTFT_MS,
  OPS_LIVE_LATENCY_WINDOW_SEC,
  type OpsAxis,
  type OpsChannelSeries,
  type OpsSystemSeries,
} from "@socrates/shared";
import { useState } from "react";
import { Pagination, useTable } from "@/components/DataTable";
import { Card } from "@/components/ui";
import { useI18n } from "@/i18n";
import { formatMs } from "@/lib/ops";
import { axisTickFormat, latencyRows, latencyYMax, partialKey, turnRows, type TurnRow } from "@/lib/opsChart";

const SERIES_COLORS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
];
const seriesColor = (index: number) => SERIES_COLORS[index] ?? "var(--color-ink-faint)";
const CHART_HEIGHT = 190;

interface Props {
  live: boolean;
  axis: OpsAxis;
  generatedAtSec: number;
  channels: OpsChannelSeries[];
  system: Pick<OpsSystemSeries, "turns" | "failedTurns">;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-1 mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface TableRowData {
  key: number;
  time: string;
  partial: boolean;
  cells: string[];
}

const NO_SORT = {} as const;

function ChartTable({ title, columns, rows }: { title: string; columns: string[]; rows: TableRowData[] }) {
  const { t } = useI18n();
  const table = useTable(rows, NO_SORT);
  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-ink-faint">
              <th scope="col" className="px-2 py-1.5 font-medium">
                {t("admin_chart_col_time")}
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-2 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <th scope="row" className="px-2 py-1.5 text-left font-normal tabular-nums text-ink-soft">
                  {row.time}
                  {row.partial && <span className="ml-1.5 text-ink-faint">({t("admin_chart_in_progress")})</span>}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.key}-${columns[index]}`} className="px-2 py-1.5 tabular-nums text-ink">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination table={table} />
    </div>
  );
}

function ChartCard({
  title,
  table,
  children,
}: {
  title: string;
  table: { columns: string[]; rows: TableRowData[] };
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((current) => !current)}
          className="shrink-0 cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink-soft hover:text-ink"
        >
          {asTable ? t("admin_chart_table_hide") : t("admin_chart_table_show")}
        </button>
      </div>
      {asTable ? <ChartTable title={title} columns={table.columns} rows={table.rows} /> : children}
    </Card>
  );
}

interface TipRow {
  label: string;
  value: string;
  color: string;
}

function Tip({ title, rows, partial, note }: { title: string; rows: TipRow[]; partial: boolean; note: string }) {
  return (
    <div className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[12px] shadow-md">
      <p className="font-semibold text-ink">
        {title}
        {partial && <span className="ml-1.5 font-normal text-ink-faint">{note}</span>}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: row.color }} aria-hidden="true" />
            {row.label} {row.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OpsCharts({ live, axis, generatedAtSec, channels, system }: Props) {
  const { t, locale } = useI18n();
  const tick = axisTickFormat(axis, locale);
  const fullTime = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: live ? "medium" : "short" });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: live ? 2 : 0 });
  const turns = turnRows(system, axis, generatedAtSec, live);
  const latency = latencyRows(channels, axis);
  const colorOf = (id: string) => seriesColor(channels.findIndex((channel) => channel.id === id));
  const inProgress = t("admin_chart_in_progress");
  const okLabel = t("admin_chart_ok_turns");
  const failedLabel = t("admin_chart_failed_turns");

  const newestFirst = <T,>(rows: T[]) => [...rows].reverse();
  const turnsTable = {
    columns: [okLabel, failedLabel],
    rows: newestFirst(
      turns.map((row) => ({
        key: row.startSec,
        time: fullTime.format(new Date(row.startSec * 1000)),
        partial: row.partial,
        cells: [number.format(row.ok), number.format(row.failed)],
      })),
    ),
  };
  const latencyTable = {
    columns: channels.map((channel) => channel.label),
    rows: newestFirst(
      latency.map((row, index) => ({
        key: row.startSec,
        time: fullTime.format(new Date(row.startSec * 1000)),
        partial: row.partial,
        cells: channels.map((channel) => formatMs(channel.ttftP95Ms[index] ?? null, locale)),
      })),
    ),
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title={live ? t("admin_chart_turns_live") : t("admin_chart_turns_range")} table={turnsTable}>
        <Legend
          items={[
            { label: okLabel, color: "var(--color-ink-soft)" },
            { label: failedLabel, color: "var(--color-flag)" },
          ]}
        />
        <div role="img" aria-label={live ? t("admin_chart_turns_live") : t("admin_chart_turns_range")}>
          <ResponsiveContainer
            width="100%"
            height={CHART_HEIGHT}
            initialDimension={{ width: 480, height: CHART_HEIGHT }}
          >
            <BarChart data={turns} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="startSec"
                tickFormatter={tick}
                interval="preserveStartEnd"
                minTickGap={48}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                width={40}
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => number.format(value)}
                allowDecimals={live}
              />
              <Tooltip
                cursor={{ fill: "var(--color-paper-deep)" }}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as TurnRow | undefined;
                  if (!row) return null;
                  return (
                    <Tip
                      title={fullTime.format(new Date(row.startSec * 1000))}
                      partial={row.partial}
                      note={inProgress}
                      rows={[
                        { label: okLabel, value: number.format(row.ok), color: "var(--color-ink-soft)" },
                        { label: failedLabel, value: number.format(row.failed), color: "var(--color-flag)" },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="ok" stackId="turns" fill="var(--color-ink-soft)" isAnimationActive={false}>
                {turns.map((row) => (
                  <Cell key={row.startSec} fillOpacity={row.partial ? 0.45 : 1} />
                ))}
              </Bar>
              <Bar dataKey="failed" stackId="turns" fill="var(--color-flag)" isAnimationActive={false}>
                {turns.map((row) => (
                  <Cell key={row.startSec} fillOpacity={row.partial ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t("admin_chart_ttft")} table={latencyTable}>
        <Legend
          items={channels.slice(0, 3).map((channel, index) => ({ label: channel.label, color: seriesColor(index) }))}
        />
        <p className="-mt-1 mb-1 text-[11.5px] text-ink-faint">
          {live
            ? t("admin_chart_ttft_window_live", { seconds: OPS_LIVE_LATENCY_WINDOW_SEC })
            : t("admin_chart_ttft_window_range")}
        </p>
        <div role="img" aria-label={t("admin_chart_ttft")}>
          <ResponsiveContainer
            width="100%"
            height={CHART_HEIGHT}
            initialDimension={{ width: 480, height: CHART_HEIGHT }}
          >
            <LineChart data={latency} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="startSec"
                tickFormatter={tick}
                interval="preserveStartEnd"
                minTickGap={48}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                width={48}
                tick={{ fontSize: 11 }}
                domain={[0, latencyYMax(channels)]}
                tickFormatter={(value: number) => formatMs(value, locale)}
              />
              <ReferenceLine
                y={OPS_DEGRADED_TTFT_MS}
                stroke="var(--color-flag)"
                strokeDasharray="4 4"
                label={{
                  value: t("admin_chart_threshold"),
                  position: "insideTopRight",
                  fill: "var(--color-flag)",
                  fontSize: 11,
                }}
              />
              <Tooltip
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof latency)[number] | undefined;
                  if (!row) return null;
                  return (
                    <Tip
                      title={fullTime.format(new Date(row.startSec * 1000))}
                      partial={row.partial}
                      note={inProgress}
                      rows={channels.map((channel) => ({
                        label: channel.label,
                        value: formatMs(
                          (row[channel.id] as number | null) ?? (row[partialKey(channel.id)] as number | null),
                          locale,
                        ),
                        color: colorOf(channel.id),
                      }))}
                    />
                  );
                }}
              />
              {channels.slice(0, 3).map((channel, index) => (
                <Line
                  key={channel.id}
                  dataKey={channel.id}
                  stroke={seriesColor(index)}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {channels.slice(0, 3).map((channel, index) => (
                <Line
                  key={partialKey(channel.id)}
                  dataKey={partialKey(channel.id)}
                  stroke={seriesColor(index)}
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
