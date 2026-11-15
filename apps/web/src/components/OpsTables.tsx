import { OPS_AXIS_PLAN, type OpsEvent } from "@socrates/shared";
import { Pagination, useTable } from "@/components/DataTable";
import { PURPOSE_KEYS } from "@/components/OpsPanels";
import { Card, SectionTitle, cn } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n";
import { labelOf, pick } from "@/lib/ops";

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
