import { useMemo, useRef, useState } from "react";
import type { ActivityLive, LiveFlag, StudentLive } from "@socrates/shared";
import { Flag } from "lucide-react";
import { Button, Card, Field, Input, cn } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n";

const PAGE_SIZE = 50;

const statusLabel = {
  not_started: "live_status_silent",
  idle: "live_status_idle",
  active: "live_status_active",
  unknown: "live_status_unknown",
} as const satisfies Record<StudentLive["status"], MessageKey>;

const flagLabel = {
  math: "live_flag_math",
  coding: "live_flag_coding",
  injection: "live_flag_injection",
  other: "live_flag_other",
} as const satisfies Record<LiveFlag["type"], MessageKey>;

const statusPriority = { not_started: 1, idle: 2, unknown: 3, active: 4 };
const attention = (student: StudentLive) => (student.flags?.length ? 0 : statusPriority[student.status]);

function updateFlags(students: StudentLive[], previous = new Map<string, string>()) {
  const seen = new Map(previous);
  let newCount = 0;
  for (const student of students) {
    for (const flag of student.flags ?? []) {
      const key = JSON.stringify([student.id, flag.type]);
      if (seen.get(key) !== flag.id) newCount++;
      seen.set(key, flag.id);
    }
  }
  return { seen, newCount };
}

export function LiveBoard({ snapshot, stale }: { snapshot: ActivityLive; stale: boolean }) {
  const { t, locale } = useI18n();
  const { students, asOf, finishedAt } = snapshot;
  const heading = useRef<HTMLHeadingElement>(null);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [alerts, setAlerts] = useState(() => ({ students, seen: updateFlags(students).seen, count: 0 }));
  if (students !== alerts.students) {
    const { seen, newCount } = updateFlags(students, alerts.seen);
    setAlerts({ students, seen, count: alerts.count + newCount });
  }

  const sorted = useMemo(() => {
    const collator = new Intl.Collator(locale, { numeric: true });
    return students.toSorted(
      (a, b) => attention(a) - attention(b) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
    );
  }, [locale, students]);
  const searchTerm = search.trim().toLocaleLowerCase(locale);
  const filtered = sorted.filter(
    (student) =>
      (!flaggedOnly || Boolean(student.flags?.length)) &&
      (status === "all" || student.status === status) &&
      student.name.toLocaleLowerCase(locale).includes(searchTerm),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleStudents = filtered.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE);
  const active = students.filter((student) => student.status === "active").length;
  const notStarted = students.filter((student) => student.status === "not_started").length;
  const flagged = students.filter((student) => student.flags?.length).length;
  const time = new Date(asOf).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const statItems = [
    ["live_stat_total", students.length],
    ["live_stat_active", active],
    ["live_stat_silent", notStarted],
    ["live_stat_flagged", flagged],
  ] as const;

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 ref={heading} tabIndex={-1} className="font-serif text-lg text-ink">
          {t("live_roster_title")}
        </h2>
        <p className="text-xs text-ink-soft">
          {t(finishedAt ? "live_ended" : stale ? "live_stale" : "live_updated", { time })}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:px-5">
        {statItems.map(([label, count]) => (
          <div key={label} className="min-w-0 border-l border-line-strong pl-3">
            <dt className="text-xs text-ink-soft">{t(label)}</dt>
            <dd
              className={cn(
                "text-xl font-semibold tabular-nums text-ink",
                label === "live_stat_flagged" && count > 0 && "text-flag",
              )}
            >
              {count.toLocaleString(locale)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 sm:px-5">
        <p role="status" className={cn("text-sm font-medium text-flag", alerts.count > 0 && "py-2")}>
          {alerts.count > 0 ? t("live_new_flags", { n: alerts.count }) : ""}
        </p>
        {alerts.count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              heading.current?.focus();
              setAlerts((current) => ({ ...current, count: 0 }));
            }}
          >
            {t("live_alert_dismiss")}
          </Button>
        )}
      </div>

      {students.length === 0 ? (
        <p className="border-t border-line p-5 text-sm text-ink-soft">{t("live_empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-y border-line bg-paper-deep p-4 sm:px-5">
            <div className="min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
              <Field label={t("live_search")}>
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                    setPage(0);
                  }}
                />
              </Field>
            </div>
            <Field label={t("live_col_status")}>
              <select
                className="h-9 max-w-full rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ink"
                value={status}
                onChange={(event) => {
                  setStatus(event.currentTarget.value);
                  setPage(0);
                }}
              >
                <option value="all">{t("live_all_statuses")}</option>
                {Object.entries(statusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant={flaggedOnly ? "primary" : "outline"}
              aria-pressed={flaggedOnly}
              className="min-h-9"
              onClick={() => {
                setFlaggedOnly(!flaggedOnly);
                setPage(0);
              }}
            >
              <Flag className="size-3.5" aria-hidden />
              {t("live_filter_flagged")}
            </Button>
          </div>
          <table className="w-full table-fixed text-left text-xs sm:text-sm">
            <caption className="sr-only">{t("live_roster_title")}</caption>
            <thead className="bg-paper-deep text-ink-soft">
              <tr>
                <th scope="col" className="w-[31%] px-2 py-2.5 sm:px-5">
                  {t("live_col_name")}
                </th>
                <th scope="col" className="w-[28%] px-2 py-2.5 sm:px-5">
                  {t("live_col_status")}
                </th>
                <th scope="col" className="w-[14%] px-1 py-2.5 text-right sm:px-3">
                  {t("live_col_rounds")}
                </th>
                <th scope="col" className="w-[27%] px-2 py-2.5 sm:px-5">
                  {t("live_col_flags")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => (
                <tr
                  key={student.id}
                  className={cn("border-t border-line", Boolean(student.flags?.length) && "bg-flag-wash")}
                >
                  <th scope="row" className="px-2 py-3 font-medium text-ink wrap-anywhere sm:px-5">
                    {student.name}
                  </th>
                  <td className="px-2 py-3 text-ink-soft wrap-anywhere sm:px-5">{t(statusLabel[student.status])}</td>
                  <td className="px-1 py-3 text-right tabular-nums text-ink wrap-anywhere sm:px-3">
                    {student.rounds?.toLocaleString(locale) ?? "—"}
                  </td>
                  <td className="px-2 py-3 text-ink-soft wrap-anywhere sm:px-5">
                    {student.flags?.length ? (
                      <ul className="flex flex-wrap gap-x-2 gap-y-1 text-ink">
                        {student.flags.map((flag) => (
                          <li key={flag.type}>{t(flagLabel[flag.type])}</li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleStudents.length === 0 && (
            <p className="border-t border-line p-5 text-sm text-ink-soft">{t("live_no_matches")}</p>
          )}
          {pageCount > 1 && (
            <nav
              aria-label={t("live_pagination")}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5"
            >
              <span className="text-sm tabular-nums text-ink-soft">
                {t("live_page", { page: visiblePage + 1, total: pageCount })}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={visiblePage === 0}
                  onClick={() => setPage(visiblePage - 1)}
                >
                  {t("live_previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={visiblePage + 1 === pageCount}
                  onClick={() => setPage(visiblePage + 1)}
                >
                  {t("live_next")}
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </Card>
  );
}
