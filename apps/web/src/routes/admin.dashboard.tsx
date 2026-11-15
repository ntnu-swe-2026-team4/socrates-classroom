import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api, type AdminDashboard } from "@/api";
import { AdminTabs } from "@/components/AdminTabs";
import { Pagination, SortableTh, useTable } from "@/components/DataTable";
import { Button, Card, PageHeader, SectionTitle, Spinner, cn } from "@/components/ui";
import { useI18n, type MessageKey } from "@/i18n";
import { bucketByDay, formatDateTime } from "@/lib/adminTime";

export const Route = createFileRoute("/admin/dashboard")({
  component: DashboardPage,
});

const TREND_DAYS = 7;
const REPORT_STATUS_KEYS = {
  pending: "admin_report_pending",
  partial: "admin_report_partial",
  ready: "admin_report_ready",
  failed: "admin_report_failed",
} as const satisfies Record<keyof AdminDashboard["reports"]["byStatus"], MessageKey>;
const STATE_KEYS = {
  none: "admin_state_none",
  active: "admin_state_active",
  finished: "admin_state_finished",
} as const satisfies Record<AdminDashboard["recentClassrooms"]["items"][number]["state"], MessageKey>;
const ROLE_KEYS: Record<string, MessageKey> = { student: "role_student", teacher: "role_teacher" };

function DashboardPage() {
  const { t, locale } = useI18n();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const query = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.adminDashboard(),
    staleTime: 30_000,
  });
  const data = query.data;
  const minutes = data ? Math.round(data.stuckAfterMs / 60_000) : 0;
  const when = (iso: string) => formatDateTime(iso, locale, timeZone);

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        eyebrow={t("admin_eyebrow")}
        title={t("admin_dashboard_title")}
        description={t("admin_dashboard_intro")}
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AdminTabs />
            {data && (
              <span className="text-[12.5px] text-ink-faint">
                {t("admin_updated_at", { time: when(data.generatedAt) })}
              </span>
            )}
            <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? <Spinner /> : <RefreshCw className="size-4" />}
              {t("admin_refresh")}
            </Button>
          </div>
        }
      />
      <div
        aria-busy={query.isFetching}
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 transition-opacity",
          query.isFetching && query.data && "opacity-70",
        )}
      >
        {query.isPending && (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {query.isError && <p className="text-[14px] text-flag">{t("admin_load_failed")}</p>}
        {data && (
          <>
            <section aria-labelledby="admin-counts">
              <SectionTitle>
                <span id="admin-counts">{t("admin_counts_title")}</span>
              </SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t("admin_count_classrooms")} value={data.counts.classrooms} />
                <Stat label={t("admin_count_active")} value={data.counts.activeActivities} />
                <Stat label={t("admin_count_finished")} value={data.counts.finishedActivities} />
                <Stat label={t("admin_count_memberships")} value={data.counts.memberships} />
              </div>
              <p className="mt-4 mb-2 text-[12.5px] text-ink-faint">{t("admin_roles_title")}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.counts.byRole).map(([role, count]) => (
                  <span
                    key={role}
                    className="rounded-full border border-line bg-card px-3 py-1 text-[13px] text-ink-soft"
                  >
                    {ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role} · {count}
                  </span>
                ))}
              </div>
            </section>

            <section aria-labelledby="admin-reports">
              <SectionTitle>
                <span id="admin-reports">{t("admin_reports_title")}</span>
              </SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(Object.keys(REPORT_STATUS_KEYS) as Array<keyof typeof REPORT_STATUS_KEYS>).map((status) => (
                  <Stat
                    key={status}
                    label={t(REPORT_STATUS_KEYS[status])}
                    value={data.reports.byStatus[status]}
                    tone={status === "failed" && data.reports.byStatus.failed > 0 ? "alert" : "normal"}
                  />
                ))}
              </div>
              <div className="mt-5 grid items-start gap-5 md:grid-cols-2">
                <RecordList
                  title={t("admin_stuck_title")}
                  hint={t("admin_stuck_hint", { minutes })}
                  empty={t("admin_stuck_none")}
                  rows={data.reports.stuck.items.map((item) => ({
                    key: item.activityId,
                    label: item.activityId,
                    mono: true,
                    at: when(item.updatedAt),
                  }))}
                  total={data.reports.stuck.total}
                />
                <RecordList
                  title={t("admin_no_report_title")}
                  hint={t("admin_no_report_hint", { minutes })}
                  empty={t("admin_no_report_none")}
                  rows={data.reports.finishedWithoutReport.items.map((item) => ({
                    key: item.activityId,
                    label: item.activityId,
                    mono: true,
                    at: when(item.finishedAt),
                  }))}
                  total={data.reports.finishedWithoutReport.total}
                />
              </div>
            </section>

            <section aria-labelledby="admin-recent">
              <SectionTitle>
                <span id="admin-recent">{t("admin_recent_title")}</span>
              </SectionTitle>
              <RecentTable list={data.recentClassrooms} when={when} />
              <div className="mt-5">
                <RecordList
                  title={t("admin_empty_title")}
                  hint={t("admin_empty_hint")}
                  empty={t("admin_empty_none")}
                  rows={data.emptyClassrooms.items.map((item) => ({
                    key: item.id,
                    label: item.name,
                    at: when(item.createdAt),
                  }))}
                  total={data.emptyClassrooms.total}
                />
              </div>
            </section>

            <section aria-labelledby="admin-trend">
              <SectionTitle>
                <span id="admin-trend">{t("admin_trend_title")}</span>
              </SectionTitle>
              <Trend data={data} timeZone={timeZone} t={t} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "alert" }) {
  return (
    <Card className="p-4">
      <p className="text-[12.5px] text-ink-faint">{label}</p>
      <p className={cn("mt-1 font-serif text-3xl", tone === "alert" ? "text-flag" : "text-ink")}>{value}</p>
    </Card>
  );
}

interface RecordRow {
  key: string;
  label: string;
  mono?: boolean;
  at: string;
}

const NO_SORT = {} as const;

function RecordList({
  title,
  hint,
  empty,
  rows,
  total,
}: {
  title: string;
  hint: string;
  empty: string;
  rows: RecordRow[];
  total: number;
}) {
  const table = useTable<RecordRow>(rows, NO_SORT);
  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <h3 className="font-serif text-[14.5px] text-ink">{title}</h3>
        <p className="mt-0.5 mb-3 text-[12px] text-ink-faint">{hint}</p>
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {table.rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
                {row.mono ? (
                  <code className="min-w-0 truncate font-mono text-[12px] text-ink-soft" title={row.label}>
                    {row.label}
                  </code>
                ) : (
                  <span className="min-w-0 truncate text-ink">{row.label}</span>
                )}
                <span className="shrink-0 text-ink-faint">{row.at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Pagination table={table} capped={{ loaded: rows.length, total }} />
    </Card>
  );
}

type RecentClassroom = AdminDashboard["recentClassrooms"]["items"][number];

const RECENT_SORTS = {
  name: (row: RecentClassroom) => row.name,
  members: (row: RecentClassroom) => row.members,
  state: (row: RecentClassroom) => row.state,
  createdAt: (row: RecentClassroom) => Date.parse(row.createdAt),
};

function RecentTable({ list, when }: { list: AdminDashboard["recentClassrooms"]; when: (iso: string) => string }) {
  const { t } = useI18n();
  const table = useTable(list.items, RECENT_SORTS, { key: "createdAt", dir: "desc" });
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[520px] text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px]">
              <SortableTh column="name" label={t("admin_col_name")} table={table} />
              <SortableTh column="members" label={t("admin_col_members")} table={table} />
              <SortableTh column="state" label={t("admin_col_state")} table={table} />
              <SortableTh column="createdAt" label={t("admin_col_created")} table={table} />
            </tr>
          </thead>
          <tbody>
            {list.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-ink-faint">
                  {t("admin_no_data")}
                </td>
              </tr>
            )}
            {table.rows.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{item.name}</td>
                <td className="px-3 py-2 text-ink-soft">{item.members}</td>
                <td className="px-3 py-2 text-ink-soft">{t(STATE_KEYS[item.state])}</td>
                <td className="px-3 py-2 text-ink-soft">{when(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination table={table} capped={{ loaded: list.items.length, total: list.total }} />
    </Card>
  );
}

function Trend({ data, timeZone, t }: { data: AdminDashboard; timeZone: string; t: (key: MessageKey) => string }) {
  const days = bucketByDay(data.hourly, timeZone, TREND_DAYS);
  const peak = Math.max(1, ...days.map((day) => Math.max(day.classrooms, day.joins)));
  return (
    <Card className="overflow-x-auto p-2">
      <table className="w-full min-w-[420px] text-left text-[13.5px]">
        <thead>
          <tr className="text-[12px] text-ink-faint">
            <th className="px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">{t("admin_trend_classrooms")}</th>
            <th className="px-3 py-2 font-medium">{t("admin_trend_joins")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day} className="border-t border-line">
              <th scope="row" className="px-3 py-2 font-normal text-ink-soft">
                {day.day.slice(5)}
              </th>
              <td className="px-3 py-2">
                <Bar value={day.classrooms} peak={peak} />
              </td>
              <td className="px-3 py-2">
                <Bar value={day.joins} peak={peak} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Bar({ value, peak }: { value: number; peak: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-paper-deep">
        <div className="h-full rounded-full bg-ember" style={{ width: `${(value / peak) * 100}%` }} />
      </div>
      <span className="w-6 text-ink-soft">{value}</span>
    </div>
  );
}
