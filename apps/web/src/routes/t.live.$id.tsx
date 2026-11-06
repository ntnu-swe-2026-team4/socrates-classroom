import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, PageHeader, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/live/$id")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/classrooms" });
  },
  component: LivePage,
});

const COLS = "grid grid-cols-[1.3fr_.8fr_2.4fr_.6fr] items-center gap-3 max-md:grid-cols-[1fr_auto]";

function LivePage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const [filter, setFilter] = useState<"attention" | "all">("all");
  const live = useQuery({ queryKey: ["live", id], queryFn: () => api.liveStudents(id), refetchInterval: 2500 });
  const finish = useMutation({
    mutationFn: () => api.finishActivity(id),
  });

  async function finishAndReport() {
    if (finish.isPending) return;
    await finish.mutateAsync().catch(() => {});
    await navigate({ to: "/report/$id", params: { id } });
  }

  const students = live.data ?? [];
  const shown = filter === "attention" ? students.filter((student) => student.flagged) : students;
  const flaggedCount = students.filter((student) => student.flagged).length;
  const activeCount = students.filter((student) => student.status !== "idle").length;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={t("eyebrow_teacher")}
        title={t("live_title")}
        actions={
          <>
            <Segmented
              label={t("live_title")}
              value={filter}
              onChange={setFilter}
              items={[
                { value: "attention", label: `${t("live_needs_attention")} ${flaggedCount}` },
                { value: "all", label: `${t("live_all")} ${students.length}` },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => void finishAndReport()} disabled={finish.isPending}>
              {finish.isPending ? <Spinner /> : null}
              {t("live_finish")}
            </Button>
          </>
        }
      />

      <div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={t("live_all")} value={students.length} />
          <Stat label={t("live_active")} value={activeCount} />
          <Stat label={t("live_needs_attention")} value={flaggedCount} tone={flaggedCount ? "flag" : undefined} />
        </div>

        <Card className="p-2" aria-busy={live.isFetching}>
          <div className={cn(COLS, "px-3 py-2.5 text-[11.5px] text-ink-faint")}>
            <span>{t("live_col_name")}</span>
            <span className="max-md:hidden">{t("live_col_status")}</span>
            <span className="max-md:hidden">{t("live_col_last")}</span>
            <span className="text-right">{t("live_col_rounds")}</span>
          </div>
          {shown.length === 0 && (
            <p className="border-t border-line px-3 py-6 text-center text-[13px] text-ink-faint">
              {filter === "attention" ? t("live_none_attention") : t("live_none_all")}
            </p>
          )}
          {shown.map((student) => (
            <div
              key={student.id}
              className={cn(
                COLS,
                "border-t border-line px-3 py-3 text-[13px]",
                student.flagged && "anim-flag rounded-xl bg-flag-wash",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <i className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ember-wash font-serif text-xs not-italic text-ember">
                  {student.name.slice(0, 1)}
                </i>
                <span className="truncate">{student.name}</span>
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5 max-md:hidden",
                  student.status === "speaking" && "text-ember",
                  student.status === "active" && "text-moss",
                  student.status === "idle" && "text-ink-faint",
                )}
              >
                {student.status === "idle" ? "○" : "●"} {t(`live_${student.status}` as const)}
              </span>
              <span className="min-w-0 max-md:hidden">
                <span className="line-clamp-1 text-ink-soft">
                  {student.lastUtterance ? t("live_last", { text: student.lastUtterance }) : "—"}
                </span>
                {student.flagged && (
                  <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-flag-wash px-2.5 py-0.5 text-[11.5px] font-medium text-flag">
                    <svg
                      aria-hidden
                      viewBox="0 0 16 16"
                      className="h-3 w-3 fill-none stroke-flag stroke-[1.8]"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 1.5 14.5 13H1.5Z M8 6v3.5 M8 11.6v.2" />
                    </svg>
                    {student.flagReason}
                  </span>
                )}
              </span>
              <span className="text-right text-ink-soft tabular-nums">
                {t(student.rounds === 1 ? "live_round_one" : "live_rounds", { n: student.rounds })}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "flag" }) {
  return (
    <Card className="p-5">
      <div className="text-xs tracking-wider text-ink-faint">{label}</div>
      <div className={cn("mt-1 font-serif text-3xl", tone === "flag" ? "text-flag" : "text-ember")}>{value}</div>
    </Card>
  );
}
