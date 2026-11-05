import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Segmented, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { Spinner } from "@/components/ui";

export const Route = createFileRoute("/t/live/$id")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/login" });
  },
  component: LivePage,
});

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

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 pl-12 md:pl-0">
        <h1 className="font-serif text-2xl font-semibold text-ink">{t("live_title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={t("live_title")}
            value={filter}
            onChange={setFilter}
            items={[
              { value: "attention", label: `${t("live_needs_attention")} ${flaggedCount}` },
              { value: "all", label: `${t("live_all")} ${students.length}` },
            ]}
          />
          <button
            type="button"
            onClick={() => void finishAndReport()}
            disabled={finish.isPending}
            className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-60"
          >
            {finish.isPending ? <Spinner /> : null}
            {t("live_finish")}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy={live.isFetching}>
        {shown.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-line bg-card px-4 py-10 text-center text-[13.5px] text-ink-faint">
            {filter === "attention" ? t("live_none_attention") : t("live_none_all")}
          </p>
        )}
        {shown.map((student) => (
          <article
            key={student.id}
            className={cn(
              "rounded-2xl border bg-card p-4 transition-shadow",
              student.flagged ? "border-flag/50" : "border-line",
              student.flagged && "anim-flag",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[15px] font-medium text-ink">{student.name}</p>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
                  student.status === "speaking" && "bg-ember-wash text-ember",
                  student.status === "active" && "bg-moss-wash text-moss",
                  student.status === "idle" && "bg-paper-deep text-ink-faint",
                )}
              >
                <StatusDot status={student.status} />
                {t(`live_${student.status}` as const)}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-2 min-h-10 text-[13.5px] leading-relaxed text-ink-soft">
              {t("live_last", { text: student.lastUtterance })}
            </p>
            <div className="mt-3 flex items-center justify-between text-[12px] text-ink-faint">
              <span>{t(student.rounds === 1 ? "live_round_one" : "live_rounds", { n: student.rounds })}</span>
              {student.flagged && (
                <span className="flex items-center gap-1.5 rounded-full bg-flag-wash px-2.5 py-0.5 font-medium text-flag">
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
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "active" | "speaking" | "idle" }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "speaking" && "bg-ember",
        status === "active" && "bg-moss",
        status === "idle" && "bg-ink-faint/50",
      )}
      aria-hidden
    />
  );
}
