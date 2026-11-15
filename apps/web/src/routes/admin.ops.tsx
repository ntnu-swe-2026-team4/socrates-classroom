import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { OPS_AXIS_PLAN, OPS_RANGES, OpsRangeSchema, type OpsRange } from "@socrates/shared";
import { api } from "@/api";
import { AdminTabs } from "@/components/AdminTabs";
import { Button, PageHeader, Segmented, Spinner, cn } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n";
import { formatDateTime } from "@/lib/adminTime";

type OpsSearch = { mode?: "review"; range?: OpsRange };
type OpsMode = "live" | "review";

const DEFAULT_RANGE: OpsRange = "24h";
const RANGE_KEYS = {
  "1h": "admin_range_1h",
  "6h": "admin_range_6h",
  "24h": "admin_range_24h",
  "72h": "admin_range_72h",
  "7d": "admin_range_7d",
} as const satisfies Record<OpsRange, MessageKey>;

export const Route = createFileRoute("/admin/ops")({
  validateSearch: (search: Record<string, unknown>): OpsSearch => {
    const range = OpsRangeSchema.safeParse(search.range);
    return {
      mode: search.mode === "review" ? "review" : undefined,
      range: range.success && range.data !== DEFAULT_RANGE ? range.data : undefined,
    };
  },
  component: OpsPage,
});

function OpsPage() {
  const { t, locale } = useI18n();
  const { mode, range = DEFAULT_RANGE } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const live = mode !== "review";
  const livePlan = OPS_AXIS_PLAN.live;

  const liveQuery = useQuery({
    queryKey: ["admin-live"],
    queryFn: () => api.adminLive(),
    enabled: live,
    refetchInterval: livePlan.stepSec * 1000,
  });
  const metricsQuery = useQuery({
    queryKey: ["admin-metrics", range],
    queryFn: () => api.adminMetrics(range),
    enabled: !live,
    staleTime: 15_000,
  });
  const query = live ? liveQuery : metricsQuery;
  const data = query.data;

  const setMode = (next: OpsMode) =>
    void navigate({ search: (prev) => ({ ...prev, mode: next === "review" ? "review" : undefined }), replace: true });
  const setRange = (next: OpsRange) =>
    void navigate({ search: (prev) => ({ ...prev, range: next === DEFAULT_RANGE ? undefined : next }), replace: true });

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        eyebrow={t("admin_eyebrow")}
        title={t("admin_ops_title")}
        description={t("admin_ops_intro")}
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AdminTabs />
            {data && (
              <span className="text-[12.5px] text-ink-faint">
                {t("admin_updated_at", {
                  time: formatDateTime(new Date(data.generatedAtSec * 1000).toISOString(), locale, timeZone),
                })}
              </span>
            )}
            {!live && (
              <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? <Spinner /> : <RefreshCw className="size-4" />}
                {t("admin_refresh")}
              </Button>
            )}
          </div>
        }
      />
      <div
        aria-busy={query.isFetching}
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8",
          !live && query.isFetching && query.data && "opacity-70",
        )}
      >
        {data?.source === "fixture" && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-line-strong bg-card px-3 py-2 text-[13px] text-ink-soft"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("admin_fixture_notice")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented<OpsMode>
            label={t("admin_mode_label")}
            value={live ? "live" : "review"}
            onChange={setMode}
            items={[
              { value: "live", label: t("admin_mode_live") },
              { value: "review", label: t("admin_mode_review") },
            ]}
          />
          {!live && (
            <Segmented<OpsRange>
              label={t("admin_range_label")}
              value={range}
              onChange={setRange}
              items={OPS_RANGES.map((value) => ({ value, label: t(RANGE_KEYS[value]) }))}
            />
          )}
          <span className="text-[13px] text-ink-faint">
            {live
              ? t("admin_live_hint", { seconds: livePlan.stepSec, minutes: (livePlan.stepSec * livePlan.points) / 60 })
              : t("admin_review_hint", { minutes: OPS_AXIS_PLAN[range].stepSec / 60 })}
          </span>
        </div>
        {query.isPending && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {query.isError && <p className="text-[14px] text-flag">{t("admin_load_failed")}</p>}
      </div>
    </div>
  );
}
