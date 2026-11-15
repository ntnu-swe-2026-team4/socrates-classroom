import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import type {
  OpsChannelSeries,
  OpsLiveChannel,
  OpsLiveResponse,
  OpsMetricsResponse,
  OpsPurpose,
  OpsQuota,
} from "@socrates/shared";
import { Card, SectionTitle, cn } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n";
import {
  type ChannelState,
  formatCount,
  formatDuration,
  formatMs,
  formatPercent,
  labelOf,
  lastTotal,
  overall,
  peakOf,
  pick,
  ratio,
} from "@/lib/ops";

const SERIES_SWATCH = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4"];
const swatch = (index: number) => SERIES_SWATCH[index] ?? "bg-ink-faint";

const STATE_STYLE = {
  ok: { icon: CircleCheck, tone: "bg-moss-wash text-moss", label: "admin_chan_ok" },
  degraded: { icon: TriangleAlert, tone: "bg-ember-wash text-ember-deep", label: "admin_chan_degraded" },
  down: { icon: CircleX, tone: "bg-flag-wash text-flag", label: "admin_chan_down" },
  unknown: { icon: CircleHelp, tone: "bg-paper-deep text-ink-soft", label: "admin_chan_unknown" },
} as const satisfies Record<ChannelState, { icon: LucideIcon; tone: string; label: MessageKey }>;

const REASON_KEYS = {
  error_rate: "admin_reason_error_rate",
  latency: "admin_reason_latency",
  breaker_open: "admin_reason_breaker_open",
  quota_exhausted: "admin_reason_quota_exhausted",
  payment_required: "admin_reason_payment_required",
  no_data: "admin_reason_no_data",
} as const satisfies Record<NonNullable<OpsLiveChannel["usableReason"]>, MessageKey>;

export const PURPOSE_KEYS = {
  dialogue: "admin_purpose_dialogue",
  judgment: "admin_purpose_judgment",
  avatar: "admin_purpose_avatar",
  speech: "admin_purpose_speech",
  search: "admin_purpose_search",
  other: "admin_purpose_other",
} as const satisfies Record<OpsPurpose, MessageKey>;

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const UNRECOGNIZED_STATE = { icon: CircleHelp, tone: "bg-paper-deep text-ink-soft", label: undefined } as const;

function StateBadge({ state, t }: { state: string; t: Translate }) {
  const style = pick<{ icon: LucideIcon; tone: string; label?: MessageKey }>(STATE_STYLE, state, UNRECOGNIZED_STATE);
  const Icon = style.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium", style.tone)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {style.label ? t(style.label) : state}
    </span>
  );
}

interface TileData {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}

function Tiles({ tiles }: { tiles: TileData[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <Card key={tile.label} className={cn("p-4", tile.emphasis && "border-ink-soft")}>
          <dt className="text-[12px] text-ink-faint">{tile.label}</dt>
          <dd className="mt-1 text-[26px] font-semibold tabular-nums leading-tight text-ink">{tile.value}</dd>
          <dd className="mt-0.5 text-[12px] text-ink-faint">{tile.note}</dd>
        </Card>
      ))}
    </dl>
  );
}

interface CardData {
  id: string;
  label: string;
  index: number;
  purposes: OpsPurpose[];
  lines: string[];
  badge?: ReactNode;
  status?: string;
}

function ChannelCards({ cards, t }: { cards: CardData[]; t: Translate }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <li key={card.id}>
          <Card className="h-full p-4">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <span className={cn("size-2.5 shrink-0 rounded-[3px]", swatch(card.index))} aria-hidden="true" />
              <span className="min-w-0 truncate">{card.label}</span>
            </div>
            {card.badge && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {card.badge}
                {card.status && <span className="text-[12px] text-ink-faint">{card.status}</span>}
              </div>
            )}
            <div className="mt-3 flex flex-col gap-1 text-[12.5px] text-ink-soft">
              {card.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p>
                {t("admin_card_purposes", {
                  purposes: card.purposes.map((purpose) => labelOf(PURPOSE_KEYS, purpose, t)).join(" · "),
                })}
              </p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function LiveSummary({ data }: { data: OpsLiveResponse }) {
  const { t, locale } = useI18n();
  const summary = overall(data.channels);
  const list = new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(summary.labels);
  const verdict = STATE_STYLE[summary.state];
  const VerdictIcon = verdict.icon;
  const headline =
    summary.state === "degraded"
      ? t("admin_verdict_degraded", { channels: list })
      : summary.state === "down"
        ? t("admin_verdict_down", { channels: list })
        : summary.state === "unknown"
          ? t("admin_verdict_unknown")
          : t("admin_verdict_ok");
  const students =
    data.now.failedTurns1m === 0
      ? t("admin_verdict_students_ok")
      : t("admin_verdict_students_hit", { count: formatCount(data.now.failedTurns1m, locale) });
  const since =
    summary.sinceSec === null
      ? ""
      : t("admin_verdict_since", { minutes: Math.max(1, Math.round((data.generatedAtSec - summary.sinceSec) / 60)) });

  const tiles: TileData[] = [
    {
      label: t("admin_tile_users"),
      value: formatCount(data.now.concurrentUsers, locale),
      note: t("admin_tile_users_note"),
    },
    {
      label: t("admin_tile_rate"),
      value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(data.now.turnsPerSec),
      note: t("admin_tile_rate_note"),
    },
    {
      label: t("admin_tile_failed"),
      value: formatCount(data.now.failedTurns1m, locale),
      note: t("admin_tile_failed_note"),
      emphasis: true,
    },
    {
      label: t("admin_tile_error_rate"),
      value: formatPercent(data.now.errorRate1m, locale),
      note: t("admin_tile_error_rate_note"),
    },
    { label: t("admin_tile_ttft"), value: formatMs(data.now.ttftP95Ms5m, locale), note: t("admin_tile_ttft_note") },
  ];

  const cards: CardData[] = data.channels.map((channel, index) => {
    const requests = lastTotal(channel.requests);
    const errors = lastTotal(channel.errors);
    const rate = formatPercent(ratio(errors, requests), locale);
    return {
      id: channel.id,
      label: channel.label,
      index,
      purposes: channel.purposes,
      badge: <StateBadge state={channel.usable} t={t} />,
      status: channel.usableReason ? labelOf(REASON_KEYS, channel.usableReason, t, { rate }) : undefined,
      lines: [
        requests === 0
          ? t("admin_card_recent", { requests: "—", errors: "—" })
          : t("admin_card_recent", {
              requests: formatCount(requests, locale),
              errors: formatCount(errors, locale),
            }),
        t("admin_card_ttft", { value: formatMs(channel.ttftP95Ms.at(-1) ?? null, locale) }),
        channel.concurrencyLimit === null
          ? t("admin_card_no_limit")
          : t("admin_card_inflight", { inflight: channel.inFlight ?? "—", limit: channel.concurrencyLimit }),
      ],
    };
  });

  return (
    <>
      <section
        aria-labelledby="ops-verdict"
        className={cn("flex items-start gap-3 rounded-xl px-4 py-3", verdict.tone)}
      >
        <VerdictIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="ops-verdict" className="text-[15px] font-semibold">
            {headline}
          </h2>
          <p className="text-[12.5px] opacity-90">{[students, since].filter(Boolean).join(" · ")}</p>
        </div>
      </section>
      <Tiles tiles={tiles} />
      <section aria-labelledby="ops-channels">
        <SectionTitle>
          <span id="ops-channels">{t("admin_channels_title")}</span>{" "}
          <span className="font-sans text-[12.5px] font-normal text-ink-faint">{t("admin_channels_live_note")}</span>
        </SectionTitle>
        <ChannelCards cards={cards} t={t} />
      </section>
    </>
  );
}

export function ReviewSummary({ data }: { data: OpsMetricsResponse }) {
  const { t, locale } = useI18n();
  const requests = data.channelSummary.reduce((sum, entry) => sum + entry.summary.requests, 0);
  const errors = data.channelSummary.reduce((sum, entry) => sum + entry.summary.errors, 0);
  const dialogue = data.purposeSummary.find((entry) => entry.purpose === "dialogue");
  const share = formatPercent(ratio(data.systemSummary.failedTurns, data.systemSummary.turns), locale);

  const tiles: TileData[] = [
    {
      label: t("admin_tile_turns"),
      value: formatCount(data.systemSummary.turns, locale),
      note: t("admin_tile_turns_note"),
    },
    {
      label: t("admin_tile_failed"),
      value: formatCount(data.systemSummary.failedTurns, locale),
      note: t("admin_tile_failed_range_note", { share }),
      emphasis: true,
    },
    {
      label: t("admin_tile_peak"),
      value: formatCount(data.systemSummary.peakActiveUsers, locale),
      note: t("admin_tile_peak_note"),
    },
    {
      label: t("admin_tile_error_rate"),
      value: formatPercent(ratio(errors, requests), locale),
      note: t("admin_tile_error_rate_range_note"),
    },
    {
      label: t("admin_tile_ttft"),
      value: formatMs(dialogue?.summary.ttftP95Ms ?? null, locale),
      note: t("admin_tile_ttft_range_note"),
    },
  ];

  const cards: CardData[] = data.channels.map((channel, index) => {
    const summary = data.channelSummary.find((entry) => entry.channelId === channel.id)?.summary;
    return {
      id: channel.id,
      label: channel.label,
      index,
      purposes: channel.purposes,
      lines: summary
        ? [
            t("admin_card_range", {
              requests: formatCount(summary.requests, locale),
              errors: formatCount(summary.errors, locale),
              rate: formatPercent(ratio(summary.errors, summary.requests), locale),
            }),
            t("admin_card_ttft_range", { value: formatMs(summary.ttftP95Ms, locale) }),
            t("admin_card_total_range", { value: formatMs(summary.totalP95Ms, locale) }),
          ]
        : [],
    };
  });

  return (
    <>
      <Tiles tiles={tiles} />
      <section aria-labelledby="ops-channels">
        <SectionTitle>
          <span id="ops-channels">{t("admin_channels_title")}</span>{" "}
          <span className="font-sans text-[12.5px] font-normal text-ink-faint">{t("admin_channels_review_note")}</span>
        </SectionTitle>
        <ChannelCards cards={cards} t={t} />
      </section>
    </>
  );
}

const SOURCE_KEYS = {
  estimated: "admin_quota_source_estimated",
  provider: "admin_quota_source_provider",
  inferred: "admin_quota_source_inferred",
} as const satisfies Record<OpsQuota["source"], MessageKey>;

interface QuotaPanelProps {
  quotas: OpsQuota[];
  channels: Pick<OpsChannelSeries, "id" | "label">[];
  live: boolean;
  etas?: { quotaId: string; etaSec: number | null }[];
}

export function QuotaPanel({ quotas, channels, live, etas = [] }: QuotaPanelProps) {
  const { t, locale } = useI18n();
  if (quotas.length === 0) return null;
  const number = new Intl.NumberFormat(locale);
  const resetFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <section aria-labelledby="ops-quotas">
      <SectionTitle>
        <span id="ops-quotas">{t("admin_quotas_title")}</span>{" "}
        <span className="font-sans text-[12.5px] font-normal text-ink-faint">
          {live ? t("admin_quotas_live_note") : t("admin_quotas_review_note")}
        </span>
      </SectionTitle>
      <Card className="flex flex-col gap-5 p-5">
        {quotas.map((quota) => {
          const model: string = quota.model;
          if (model !== "allowance" && model !== "rate") {
            const other = quota as { id: string; source: string };
            return (
              <div key={other.id} className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13.5px] font-semibold text-ink">{other.id}</h3>
                <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11.5px] text-ink-soft">
                  {labelOf(SOURCE_KEYS, other.source, t)}
                </span>
              </div>
            );
          }
          const channel = channels.find((entry) => entry.id === quota.appliesTo[0]);
          const title =
            quota.model === "allowance"
              ? t("admin_quota_allowance", { unit: quota.unit.charAt(0).toUpperCase() + quota.unit.slice(1) })
              : t("admin_quota_rate", { channel: channel?.label ?? quota.appliesTo[0] ?? "" });
          const used = live ? quota.used : peakOf(quota.series);
          const share = used === null ? null : used / quota.limit;
          const over = share !== null && share > 1;
          const eta = etas.find((entry) => entry.quotaId === quota.id)?.etaSec ?? null;
          return (
            <div key={quota.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
                  <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11.5px] text-ink-soft">
                    {labelOf(SOURCE_KEYS, quota.source, t)}
                  </span>
                  {!live && (
                    <span className="text-[12px] text-ink-faint">
                      {quota.model === "allowance" ? t("admin_quota_peak_day") : t("admin_quota_peak_minute")}
                    </span>
                  )}
                </div>
                <p className="text-[13px] tabular-nums text-ink-soft">
                  {used === null ? "—" : number.format(used)} / {number.format(quota.limit)}
                  {share !== null && <span className="ml-2 text-ink-faint">{formatPercent(share, locale)}</span>}
                </p>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden="true">
                <div
                  className={cn("h-full rounded-full", over ? "bg-flag" : "bg-ink-soft")}
                  style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }}
                />
              </div>
              <meter
                className="sr-only"
                min={0}
                max={quota.limit}
                value={Math.min(used ?? 0, quota.limit)}
                aria-label={title}
              />
              <div className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-ink-faint">
                {over && <p className="font-medium text-flag">{t("admin_quota_over")}</p>}
                {live && quota.model === "allowance" && (
                  <p>
                    {t("admin_quota_resets", { time: resetFormat.format(new Date(quota.resetsAtSec * 1000)) })}
                    {eta !== null && ` · ${t("admin_quota_eta", { duration: formatDuration(eta, locale) })}`}
                  </p>
                )}
                {quota.model === "allowance" && quota.usedIsLowerBound && <p>{t("admin_quota_lower_bound")}</p>}
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function BarRow({ label, detail, parts }: { label: string; detail: string; parts: { share: number; tone: string }[] }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-ink-soft">{detail}</span>
      </div>
      <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden="true">
        {parts.map((part) => (
          <div
            key={part.tone}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", part.tone)}
            style={{ width: `${Math.max(0, Math.min(100, part.share * 100))}%` }}
          />
        ))}
      </div>
    </li>
  );
}

export function BreakdownPanels({ data }: { data: OpsMetricsResponse }) {
  const { t, locale } = useI18n();
  const violationTotal = data.violations.byType.reduce((sum, entry) => sum + entry.count, 0);
  const violationMax = Math.max(1, ...data.violations.byType.map((entry) => entry.count));
  const purposeMax = Math.max(1, ...data.purposeSummary.map((entry) => entry.summary.requests));
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section aria-labelledby="ops-violations">
          <SectionTitle>
            <span id="ops-violations">{t("admin_violations_title")}</span>
          </SectionTitle>
          <Card className="px-5 py-3">
            {violationTotal === 0 ? (
              <p className="py-2 text-[13px] text-ink-faint">{t("admin_violations_none")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.violations.byType.map((entry) => (
                  <BarRow
                    key={entry.type}
                    label={entry.type}
                    detail={formatCount(entry.count, locale)}
                    parts={[{ share: entry.count / violationMax, tone: "bg-ink-soft" }]}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section aria-labelledby="ops-purposes">
          <SectionTitle>
            <span id="ops-purposes">{t("admin_purposes_title")}</span>
          </SectionTitle>
          <Card className="px-5 py-3">
            <ul className="divide-y divide-line">
              {data.purposeSummary.map((entry) => (
                <BarRow
                  key={entry.purpose}
                  label={labelOf(PURPOSE_KEYS, entry.purpose, t)}
                  detail={t("admin_card_range", {
                    requests: formatCount(entry.summary.requests, locale),
                    errors: formatCount(entry.summary.errors, locale),
                    rate: formatPercent(ratio(entry.summary.errors, entry.summary.requests), locale),
                  })}
                  parts={[
                    { share: (entry.summary.requests - entry.summary.errors) / purposeMax, tone: "bg-ink-soft" },
                    { share: entry.summary.errors / purposeMax, tone: "bg-flag" },
                  ]}
                />
              ))}
            </ul>
          </Card>
        </section>
      </div>
      <section aria-labelledby="ops-cost">
        <SectionTitle>
          <span id="ops-cost">{t("admin_cost_title")}</span>
        </SectionTitle>
        <Card className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
          <span className="text-[24px] font-semibold tabular-nums text-ink">
            {data.cost.totalUsd === null ? "—" : money.format(data.cost.totalUsd)}
          </span>
          {data.cost.totalUsd === null && (
            <span className="text-[12.5px] text-ink-faint">{t("admin_cost_unknown")}</span>
          )}
        </Card>
      </section>
    </>
  );
}
