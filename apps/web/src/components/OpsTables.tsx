import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";
import { OPS_AXIS_PLAN, type OpsEvent, type OpsMetricsResponse, type OpsRange } from "@socrates/shared";
import { ApiError, api } from "@/api";
import { Pagination, SortableTh, useTable } from "@/components/DataTable";
import { PURPOSE_KEYS } from "@/components/OpsPanels";
import { Card, SectionTitle, Spinner, TrapDialog, cn } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n";
import { formatCount, formatMs, formatPercent, labelOf, pick, ratio } from "@/lib/ops";

const NO_SORT = {} as const;
const UNRECOGNIZED_KIND = { label: undefined, tone: "bg-paper-deep text-ink-soft" } as const;

const KIND_STYLE = {
  failover: { label: "admin_event_failover", tone: "bg-ember-wash text-ember-deep" },
  breaker_open: { label: "admin_event_breaker_open", tone: "bg-flag-wash text-flag" },
  breaker_closed: { label: "admin_event_breaker_closed", tone: "bg-moss-wash text-moss" },
  reassign: { label: "admin_event_reassign", tone: "bg-ember-wash text-ember-deep" },
} as const satisfies Record<OpsEvent["kind"], { label: MessageKey; tone: string }>;

interface EventsPanelProps {
  events: { items: OpsEvent[]; total: number };
  channels: { id: string; label: string }[];
  live: boolean;
}

export function EventsPanel({ events, channels, live }: EventsPanelProps) {
  const { t, locale } = useI18n();
  const table = useTable(events.items, NO_SORT);
  const clock = new Intl.DateTimeFormat(
    locale,
    live ? { timeStyle: "medium" } : { dateStyle: "short", timeStyle: "short" },
  );
  const minutes = (OPS_AXIS_PLAN.live.stepSec * OPS_AXIS_PLAN.live.points) / 60;
  return (
    <section aria-labelledby="ops-events">
      <SectionTitle>
        <span id="ops-events">{t("admin_events_title")}</span>{" "}
        <span className="font-sans text-[12.5px] font-normal text-ink-faint">
          {live ? t("admin_events_live_note", { minutes }) : t("admin_events_review_note")}
        </span>
      </SectionTitle>
      <Card className="overflow-hidden">
        {events.items.length === 0 ? (
          <p className="p-5 text-[13px] text-ink-faint">{t("admin_events_none")}</p>
        ) : (
          <ul className="divide-y divide-line px-5">
            {table.rows.map((event) => {
              const kind = pick<{ label?: MessageKey; tone: string }>(KIND_STYLE, event.kind, UNRECOGNIZED_KIND);
              const channel = channels.find((entry) => entry.id === event.channelId)?.label ?? event.channelId;
              return (
                <li
                  key={`${event.atSec}-${event.channelId}-${event.kind}-${event.purpose}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]"
                >
                  <time
                    dateTime={new Date(event.atSec * 1000).toISOString()}
                    className="w-32 shrink-0 tabular-nums text-ink-faint"
                  >
                    {clock.format(new Date(event.atSec * 1000))}
                  </time>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", kind.tone)}>
                    {kind.label ? t(kind.label) : event.kind}
                  </span>
                  <span className="text-ink">
                    {channel} <span className="text-ink-faint">· {labelOf(PURPOSE_KEYS, event.purpose, t)}</span>
                  </span>
                  <code className="font-mono text-[12px] text-ink-soft">{event.reason}</code>
                  {event.threads > 0 && (
                    <span className="text-[12px] text-ink-faint">
                      {t("admin_event_threads", { count: event.threads })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination table={table} capped={{ loaded: events.items.length, total: events.total }} />
      </Card>
    </section>
  );
}

type ClassUsageRow = OpsMetricsResponse["classUsage"]["items"][number];

const CLASS_SORTS = {
  name: (row: ClassUsageRow) => row.name,
  turns: (row: ClassUsageRow) => row.turns,
  failedTurns: (row: ClassUsageRow) => row.failedTurns,
  errors: (row: ClassUsageRow) => row.errors,
};

export function ClassUsagePanel({
  usage,
  onOpen,
}: {
  usage: OpsMetricsResponse["classUsage"];
  onOpen: (classroomId: string) => void;
}) {
  const { t, locale } = useI18n();
  const table = useTable(usage.items, CLASS_SORTS, { key: "turns", dir: "desc" });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  return (
    <section aria-labelledby="ops-classes">
      <SectionTitle>
        <span id="ops-classes">{t("admin_class_title")}</span>{" "}
        <span className="font-sans text-[12.5px] font-normal text-ink-faint">{t("admin_class_hint")}</span>
      </SectionTitle>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead>
              <tr className="text-[12px]">
                <SortableTh column="name" label={t("admin_col_class")} table={table} />
                <SortableTh column="turns" label={t("admin_col_turns")} table={table} />
                <SortableTh column="failedTurns" label={t("admin_col_failed_turns")} table={table} />
                <SortableTh column="errors" label={t("admin_col_errors")} table={table} />
                <th className="px-3 py-2 font-medium text-ink-faint">{t("admin_col_tokens")}</th>
                <th className="px-3 py-2 font-medium text-ink-faint">{t("admin_col_cost")}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr
                  key={row.classroomId}
                  onClick={() => onOpen(row.classroomId)}
                  className="cursor-pointer border-t border-line hover:bg-paper-deep"
                >
                  <td className="px-3 py-2">
                    <button type="button" className="cursor-pointer text-left font-medium text-ink">
                      {row.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatCount(row.turns, locale)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatCount(row.failedTurns, locale)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatCount(row.errors, locale)}</td>
                  <td className="px-3 py-2 tabular-nums text-ink-soft">{formatCount(row.tokens, locale)}</td>
                  <td className="px-3 py-2 tabular-nums text-ink-soft">
                    {row.costUsd === null ? "—" : money.format(row.costUsd)}
                  </td>
                  <td className="px-2 text-ink-faint">
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination table={table} capped={{ loaded: usage.items.length, total: usage.total }} />
      </Card>
    </section>
  );
}

export function ClassroomDrilldown({
  classroomId,
  range,
  rangeLabel,
  onClose,
}: {
  classroomId: string;
  range: OpsRange;
  rangeLabel: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["admin-classroom", classroomId, range],
    queryFn: () => api.adminClassroomMetrics(classroomId, range),
    staleTime: 15_000,
  });
  const data = query.data;
  const failures = useTable(data?.recentFailures.items ?? [], NO_SORT);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const clock = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" });
  const totalOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
  const turns = data ? totalOf(data.turns) : 0;
  const failed = data ? totalOf(data.failedTurns) : 0;

  return (
    <TrapDialog
      ref={dialogRef}
      ariaLabelledBy="ops-drill-title"
      onClose={onClose}
      className="anim-sheet absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-line bg-paper p-6 shadow-xl"
    >
      <button
        type="button"
        aria-label={t("admin_drill_close")}
        onClick={onClose}
        className="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-paper-deep hover:text-ink"
      >
        <X className="size-4" />
      </button>
      <div className="pr-10">
        <h2 id="ops-drill-title" className="font-serif text-lg text-ink">
          {data ? data.classroom.name : classroomId} · {rangeLabel}
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-faint">{t("admin_drill_privacy")}</p>
      </div>
      {query.isPending && (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      )}
      {query.isError && (
        <p className="text-[14px] text-flag">
          {query.error instanceof ApiError && query.error.code === "not_found"
            ? t("admin_drill_not_found")
            : t("admin_load_failed")}
        </p>
      )}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <dt className="text-[12px] text-ink-faint">{t("admin_col_turns")}</dt>
              <dd className="mt-1 text-[24px] font-semibold tabular-nums text-ink">{formatCount(turns, locale)}</dd>
            </Card>
            <Card className="border-ink-soft p-4">
              <dt className="text-[12px] text-ink-faint">{t("admin_col_failed_turns")}</dt>
              <dd className="mt-1 text-[24px] font-semibold tabular-nums text-ink">{formatCount(failed, locale)}</dd>
            </Card>
          </dl>
          <section aria-labelledby="ops-drill-channels">
            <h3 id="ops-drill-channels" className="mb-2 text-[13.5px] font-semibold text-ink">
              {t("admin_drill_channels")}
            </h3>
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-card px-3">
              {data.channelSummary.map((entry) => {
                const label = data.channels.find((channel) => channel.id === entry.channelId)?.label ?? entry.channelId;
                return (
                  <li key={entry.channelId} className="py-2 text-[12.5px] text-ink-soft">
                    <span className="font-medium text-ink">{label}</span>
                    <p>
                      {t("admin_card_range", {
                        requests: formatCount(entry.summary.requests, locale),
                        errors: formatCount(entry.summary.errors, locale),
                        rate: formatPercent(ratio(entry.summary.errors, entry.summary.requests), locale),
                      })}
                    </p>
                    <p>{t("admin_card_ttft_range", { value: formatMs(entry.summary.ttftP95Ms, locale) })}</p>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="ops-drill-failures">
            <h3 id="ops-drill-failures" className="mb-2 text-[13.5px] font-semibold text-ink">
              {t("admin_drill_failures")}
            </h3>
            <Card className="overflow-hidden">
              {data.recentFailures.items.length === 0 ? (
                <p className="p-4 text-[13px] text-ink-faint">{t("admin_drill_none")}</p>
              ) : (
                <ul className="divide-y divide-line px-4">
                  {failures.rows.map((failure) => (
                    <li
                      key={`${failure.atSec}-${failure.channelId}-${failure.purpose}-${failure.reason}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12.5px]"
                    >
                      <time
                        dateTime={new Date(failure.atSec * 1000).toISOString()}
                        className="tabular-nums text-ink-faint"
                      >
                        {clock.format(new Date(failure.atSec * 1000))}
                      </time>
                      <span className="text-ink">
                        {data.channels.find((channel) => channel.id === failure.channelId)?.label ?? failure.channelId}{" "}
                        <span className="text-ink-faint">· {labelOf(PURPOSE_KEYS, failure.purpose, t)}</span>
                      </span>
                      <code className="font-mono text-ink-soft">{failure.reason}</code>
                    </li>
                  ))}
                </ul>
              )}
              <Pagination
                table={failures}
                capped={{ loaded: data.recentFailures.items.length, total: data.recentFailures.total }}
              />
            </Card>
          </section>
        </>
      )}
    </TrapDialog>
  );
}
