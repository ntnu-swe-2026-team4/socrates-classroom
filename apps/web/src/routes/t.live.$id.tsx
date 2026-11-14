import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import type { StudentLive } from "@socrates/shared";
import { api } from "@/api";
import { BackLink, Button, Card, PageHeader, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/live/$id")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me || me.guest) throw redirect({ to: "/classrooms" });
  },
  component: LivePage,
});

const POLL_MS = 5000;
const QUIET_MS = 3 * 60 * 1000;

type Alert = { key: string; studentId: string; name: string; kind: "flag" | "quiet"; detail: string };

function attention(student: StudentLive, now: number): number {
  if (student.flags.length > 0) return 0;
  if (student.rounds === 0) return 1;
  if (student.lastActiveAt && now - Date.parse(student.lastActiveAt) > QUIET_MS) return 2;
  return student.status === "idle" ? 3 : 4;
}

function LivePage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const finish = useMutation({ mutationFn: () => api.finishActivity(id) });
  const info = useQuery({ queryKey: ["activity", id], queryFn: () => api.activityInfo(id), staleTime: Infinity });
  const board = useQuery({
    queryKey: ["live", id],
    queryFn: () => api.liveBoard(id),
    refetchInterval: (query) => (query.state.data?.finished ? false : POLL_MS),
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const known = useRef<Set<string> | null>(null);

  const students = board.data?.students;
  const sorted = useMemo(() => {
    const now = Date.now();
    return [...(students ?? [])].sort(
      (a, b) => attention(a, now) - attention(b, now) || a.rounds - b.rounds || a.name.localeCompare(b.name),
    );
  }, [students]);

  useEffect(() => {
    if (!students) return;
    const now = Date.now();
    const current: Alert[] = [];
    for (const student of students) {
      for (const flag of student.flags) {
        current.push({
          key: `flag:${student.id}:${flag.turn}:${flag.type}`,
          studentId: student.id,
          name: student.name,
          kind: "flag",
          detail: flag.excerpt,
        });
      }
      if (student.rounds > 0 && student.lastActiveAt && now - Date.parse(student.lastActiveAt) > QUIET_MS) {
        current.push({
          key: `quiet:${student.id}:${student.rounds}`,
          studentId: student.id,
          name: student.name,
          kind: "quiet",
          detail: "",
        });
      }
    }
    if (known.current === null) {
      known.current = new Set(current.map((alert) => alert.key));
      return;
    }
    const fresh = current.filter((alert) => !known.current?.has(alert.key));
    if (fresh.length === 0) return;
    for (const alert of fresh) known.current.add(alert.key);
    setAlerts((list) => [...fresh, ...list].slice(0, 6));
  }, [students]);

  const backToRoom = () =>
    info.data?.classroomId
      ? void navigate({ to: "/classrooms/$classroomId", params: { classroomId: info.data.classroomId } })
      : void navigate({ to: "/classrooms", search: { view: "teacher" } });

  async function finishAndReport() {
    if (finish.isPending) return;
    try {
      await finish.mutateAsync();
    } catch {
      return;
    }
    await navigate({ to: "/report/$id", params: { id } });
  }

  const total = sorted.length;
  const active = sorted.filter((student) => student.status === "active").length;
  const silent = sorted.filter((student) => student.rounds === 0).length;
  const flagged = sorted.filter((student) => student.flags.length > 0).length;

  return (
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <PageHeader
        width="max-w-6xl"
        eyebrow={<BackLink onClick={backToRoom} label={t("classroom_back_to_room")} />}
        title={t("live_title")}
        description={info.data?.topic.title}
        actions={
          <Button onClick={() => void finishAndReport()} disabled={finish.isPending}>
            {finish.isPending ? <Spinner /> : null}
            {t("live_finish")}
          </Button>
        }
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-5 md:px-6">
        {finish.isError && (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              ["live_stat_total", total, false],
              ["live_stat_active", active, false],
              ["live_stat_silent", silent, false],
              ["live_stat_flagged", flagged, flagged > 0],
            ] as const
          ).map(([label, value, alarm]) => (
            <Card key={label} className="px-4 py-3">
              <p className="text-[12px] text-ink-faint">{t(label)}</p>
              <p className={cn("text-[26px] leading-tight font-semibold", alarm ? "text-flag" : "text-ink")}>{value}</p>
            </Card>
          ))}
        </div>

        <div aria-live="polite" className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <div
              key={alert.key}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-[13.5px]",
                alert.kind === "flag"
                  ? "border-flag/40 bg-flag-wash text-flag"
                  : "border-line-strong bg-paper text-ink",
              )}
            >
              <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">
                  {t(alert.kind === "flag" ? "live_alert_flag" : "live_alert_quiet", { name: alert.name })}
                </span>
                {alert.detail && <span className="mt-0.5 block truncate opacity-80">{alert.detail}</span>}
              </p>
              <button
                type="button"
                aria-label={t("live_alert_dismiss")}
                onClick={() => setAlerts((list) => list.filter((item) => item.key !== alert.key))}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-paper-deep"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="border-b border-line text-[12px] text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t("live_col_name")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("live_col_status")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("live_col_rounds")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("live_col_flags")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("live_col_last")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((student) => (
                  <tr
                    key={student.id}
                    data-student={student.id}
                    className={cn("border-b border-line last:border-b-0", student.flags.length > 0 && "bg-flag-wash")}
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-ink">{student.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-ink-soft">
                        <span
                          aria-hidden
                          className={cn(
                            "size-2 rounded-full",
                            student.status === "active" ? "bg-moss" : "bg-paper-shade",
                          )}
                        />
                        {student.rounds === 0
                          ? t("live_status_silent")
                          : student.status === "active"
                            ? t("live_status_active")
                            : t("live_status_idle")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{student.rounds}</td>
                    <td className="px-4 py-3">
                      {student.flags.length > 0 ? (
                        <span
                          title={student.flags.map((flag) => flag.excerpt).join("\n")}
                          className="inline-flex items-center rounded-md bg-flag px-2 py-0.5 text-[12px] font-semibold text-paper"
                        >
                          {t("live_flag_count", { n: student.flags.length })}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3 text-ink-soft">{student.lastUtterance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {board.isSuccess && total === 0 && (
            <p className="px-4 py-10 text-center text-[13.5px] text-ink-faint">{t("live_empty")}</p>
          )}
          {board.isPending && (
            <p className="flex justify-center px-4 py-10">
              <Spinner />
            </p>
          )}
          {board.isError && <p className="px-4 py-10 text-center text-[13.5px] text-flag">{t("common_error")}</p>}
        </Card>
        <p className="text-[12px] text-ink-faint">{t("live_note")}</p>
      </div>
    </div>
  );
}
