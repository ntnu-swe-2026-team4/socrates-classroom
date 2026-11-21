import { useState } from "react";
import { activitySlotsOptions, classroomsOptions, teacherActivityOptions } from "@/api/queries";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { ACTIVITY_SLOT_MAX } from "@socrates/shared";
import { api } from "@/api";
import { meOf } from "@/api/me";
import { Button, buttonStyles, Card, Field, Input, PageHeader, SectionTitle, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/live/$id")({
  beforeLoad: async ({ context, params }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/classrooms" });
    const activity = await context.queryClient.ensureQueryData(teacherActivityOptions(params.id)).catch(() => {
      throw redirect({ to: "/classrooms" });
    });
    const rooms = await context.queryClient.ensureQueryData(classroomsOptions);
    const room = rooms.find((entry) => entry.id === activity.classroomId);
    if (room?.role !== "teacher") {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: activity.classroomId } });
    }
  },
  component: LivePage,
});

function LivePage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const activity = useQuery(teacherActivityOptions(id));
  const finish = useMutation({
    mutationFn: () => api.finishActivity(id),
  });

  async function finishAndReport() {
    if (finish.isPending) return;
    try {
      await finish.mutateAsync();
    } catch {
      return;
    }
    await navigate({ to: "/report/$id", params: { id } });
  }

  const topic = activity.data?.topic;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={t("eyebrow_teacher")}
        title={t("live_title")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void finishAndReport()} disabled={finish.isPending}>
            {finish.isPending ? <Spinner /> : null}
            {t("live_finish")}
          </Button>
        }
      />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        {finish.isError && (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        )}
        {topic && (
          <Card className="p-6">
            <p className="text-[12.5px] font-medium text-ember">
              {activity.data?.mode === "test" ? t("live_test_badge") : t("live_live_badge")}
            </p>
            <h2 className="mt-1.5 font-serif text-2xl leading-snug text-ink">{topic.title}</h2>
            <p className="mt-3 border-l-2 border-ember-deep pl-4 font-serif text-[15px] leading-8 text-ink-soft">
              {topic.statement}
            </p>
          </Card>
        )}

        {activity.data?.mode === "test" ? (
          <SlotPanel activityId={id} finished={Boolean(activity.data.finishedAt)} />
        ) : (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="font-serif text-[15.5px] text-ink">{t("live_pending_title")}</p>
            <p className="max-w-md text-[12.5px] leading-relaxed text-ink-faint">{t("live_pending_body")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SlotPanel({ activityId, finished }: { activityId: string; finished: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [count, setCount] = useState(1);
  const slots = useQuery(activitySlotsOptions(activityId));
  const create = useMutation({
    mutationFn: (n: number) => api.createActivitySlots(activityId, n),
    onSuccess: (data) => {
      queryClient.setQueryData(activitySlotsOptions(activityId).queryKey, data);
      setCount(1);
    },
  });

  const list = slots.data?.slots ?? [];
  const max = slots.data?.maxSlots ?? ACTIVITY_SLOT_MAX;
  const remaining = Math.max(max - list.length, 0);
  const planned = Math.min(Math.max(count, 1), Math.max(remaining, 1));
  const analyses = list.length + (remaining > 0 ? planned : 0);

  return (
    <section>
      <SectionTitle>{t("live_slots_title")}</SectionTitle>
      <Card className="p-6">
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("live_test_body")}</p>
        <p className="mt-1.5 text-[12px] text-ink-faint">{t("live_slots_cap", { max })}</p>

        {slots.isError && <p className="mt-4 text-[13px] text-flag">{t("common_error")}</p>}
        {!slots.isError && list.length === 0 && (
          <p className="mt-6 rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-faint">
            {t("live_slots_empty")}
          </p>
        )}

        <ul className="mt-4 flex flex-col gap-2">
          {list.map((slot) => (
            <li key={slot.id}>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper-deep px-4 py-3">
                <span className="min-w-0 flex-1">
                  <b className="block font-serif text-[15px] font-medium text-ink">{slot.name}</b>
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
                  className={buttonStyles({ variant: "outline", size: "sm" })}
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  <span className="sr-only">{t("live_slot_open_named", { name: slot.name })}</span>
                  <span aria-hidden>{t("live_slot_open")}</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>

        {finished ? (
          <p className="mt-5 text-[13px] text-ink-faint">{t("live_slots_finished")}</p>
        ) : (
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Field label={t("live_slots_count")}>
                <Input
                  type="number"
                  min={1}
                  max={Math.max(remaining, 1)}
                  value={planned}
                  disabled={remaining === 0 || create.isPending}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </Field>
            </div>
            <Button
              disabled={remaining === 0 || create.isPending || !slots.data}
              onClick={() => create.mutate(planned)}
            >
              {create.isPending ? <Spinner /> : t("live_slots_create")}
            </Button>
            <p className={cn("text-[12.5px] text-ink-faint", create.isError && "text-flag")}>
              {create.isError ? t("common_error") : t("live_slots_cost", { n: analyses })}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}
