import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, MessageSquare, Minus, Plus, X } from "lucide-react";
import { ACTIVITY_SLOT_MAX, type StudentLive } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { BackLink, Button, Card, PageHeader, Spinner, buttonStyles, cn } from "@/components/ui";
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
    refetchInterval: (query) => (query.state.data?.finished || query.state.error ? false : POLL_MS),
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
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

  const testMode = info.data?.mode === "test";
  const total = sorted.length;
  const active = sorted.filter((student) => student.status === "active").length;
  const silent = sorted.filter((student) => student.rounds === 0).length;
  const flagged = sorted.filter((student) => student.flags.length > 0).length;

  if (board.error instanceof ApiError && !board.data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[15px] text-ink-soft">
        <BackLink onClick={backToRoom} label={t("classroom_back_to_room")} />
        <p>{board.error.message}</p>
      </div>
    );
  }

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

        {testMode && <SlotPanel activityId={id} finished={Boolean(info.data?.finishedAt)} />}
        <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", testMode && "hidden")}>
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

        <div aria-live="polite" className={cn("flex flex-col gap-2", testMode && "hidden")}>
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

        <Card className={cn("overflow-hidden", testMode && "hidden")}>
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
        {!testMode && <p className="text-[12px] text-ink-faint">{t("live_note")}</p>}
      </div>
    </div>
  );
}

function SlotPanel({ activityId, finished }: { activityId: string; finished: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [count, setCount] = useState(1);
  const slots = useQuery({
    queryKey: ["activity-slots", activityId],
    queryFn: () => api.listActivitySlots(activityId),
  });
  const create = useMutation({
    mutationFn: (amount: number) => api.createActivitySlots(activityId, amount),
    onSuccess: (data) => {
      queryClient.setQueryData(["activity-slots", activityId], data);
      setCount(1);
    },
  });
  const list = slots.data?.slots ?? [];
  const max = slots.data?.maxSlots ?? ACTIVITY_SLOT_MAX;
  const remaining = Math.max(max - list.length, 0);
  const planned = Math.min(Math.max(count, 1), Math.max(remaining, 1));
  const locked = remaining === 0 || create.isPending || !slots.data;

  return (
    <Card data-slot-panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-[14.5px] font-semibold text-ink">{t("live_slots_title")}</h2>
        <span className="rounded-md bg-ember-wash px-2 py-0.5 text-[11.5px] font-medium text-ink">
          {t("live_test_badge")}
        </span>
        <span className="ml-auto text-[12px] tabular-nums text-ink-faint">
          {list.length} / {max}
        </span>
      </div>
      <p className="px-4 pt-3 text-[13px] leading-relaxed text-ink-soft">{t("live_test_body")}</p>

      {slots.isPending && (
        <p className="flex justify-center px-4 py-8">
          <Spinner />
        </p>
      )}
      {slots.isError && <p className="px-4 py-8 text-center text-[13.5px] text-flag">{t("common_error")}</p>}
      {slots.isSuccess && list.length === 0 && (
        <p className="px-4 py-8 text-center text-[13.5px] text-ink-faint">{t("live_slots_empty")}</p>
      )}
      {list.length > 0 && (
        <ul className="mt-3 border-t border-line">
          {list.map((slot) => (
            <li
              key={slot.id}
              data-slot={slot.id}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{slot.name}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">
                  {slot.rounds > 0 ? t("live_slot_rounds", { n: slot.rounds }) : t("live_slot_no_utterance")}
                  {slot.lastUtterance ? ` · ${slot.lastUtterance}` : ""}
                </span>
              </span>
              <Link
                to="/dialogue"
                search={{ activityId, slot: slot.id }}
                target="_blank"
                rel="noreferrer"
                aria-label={t("live_slot_open_named", { name: slot.name })}
                className={buttonStyles({ variant: "outline", size: "sm" })}
              >
                <MessageSquare className="size-3.5" aria-hidden />
                {t("live_slot_open")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-paper-deep px-4 py-3">
        {finished ? (
          <p className="text-[13px] text-ink-faint">{t("live_slots_finished")}</p>
        ) : (
          <>
            <div className="flex items-center rounded-lg border border-line-strong bg-paper">
              <button
                type="button"
                aria-label={t("live_slots_fewer")}
                disabled={locked || planned <= 1}
                onClick={() => setCount(planned - 1)}
                className="flex size-8 cursor-pointer items-center justify-center text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="size-3.5" aria-hidden />
              </button>
              <output
                aria-label={t("live_slots_count")}
                className="w-8 text-center text-[13.5px] tabular-nums text-ink"
              >
                {planned}
              </output>
              <button
                type="button"
                aria-label={t("live_slots_more")}
                disabled={locked || planned >= remaining}
                onClick={() => setCount(planned + 1)}
                className="flex size-8 cursor-pointer items-center justify-center text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            </div>
            <Button size="sm" disabled={locked} onClick={() => create.mutate(planned)}>
              {create.isPending ? <Spinner /> : <Plus className="size-3.5" />}
              {t("live_slots_create")}
            </Button>
            <p className={cn("text-[12.5px] text-ink-faint", create.isError && "text-flag")}>
              {create.isError
                ? t("common_error")
                : remaining === 0
                  ? t("live_slots_cap", { max })
                  : t("live_slots_cost", { n: list.length + planned })}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
