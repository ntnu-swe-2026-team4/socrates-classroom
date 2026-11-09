import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChartNoAxesColumn, GraduationCap, MessageSquare, SquareActivity, Users } from "lucide-react";
import { api } from "@/api";
import type { ClassroomSummary } from "@socrates/shared";
import { QrBlock, absoluteUrl } from "@/components/QrBlock";
import { Button, Card, SectionTitle, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/classrooms/$classroomId")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
  },
  component: ClassroomPage,
});

function ClassroomPage() {
  const t = useT();
  const { classroomId } = Route.useParams();
  const room = useQuery({
    queryKey: ["classrooms"],
    queryFn: () => api.listClassrooms(),
    select: (list: ClassroomSummary[]) => list.find((entry) => entry.id === classroomId) ?? null,
  });

  if (room.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (room.isError || !room.data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[15px] text-ink-soft">{t("classroom_missing")}</p>
        <Link to="/classrooms" className="text-sm text-ember">
          {t("classroom_back")}
        </Link>
      </div>
    );
  }

  const data = room.data;
  const teacher = data.role === "teacher";
  return (
    <div className="min-h-full pb-16">
      <div className="mx-auto w-full max-w-5xl px-6 pt-20 md:pt-8">
        <Link
          to="/classrooms"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          {t("nav_classrooms")}
        </Link>
        <section className="relative mt-3 overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-ember-wash via-card to-card px-7 py-8 md:px-10 md:py-10">
          <GraduationCap
            aria-hidden
            className="pointer-events-none absolute -right-6 -bottom-8 size-48 text-ember opacity-[0.07]"
          />
          <p className="text-[12.5px] font-medium text-ember">
            {teacher ? t("classroom_you_teach") : t("classroom_teacher_is", { name: data.teacherName })}
          </p>
          <h1 className="mt-1.5 font-serif text-[30px] leading-tight text-ink md:text-[38px]">{data.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-soft">
            <span className="flex items-center gap-1.5">
              <Users className="size-4" />
              {t("classroom_members", { n: data.memberCount })}
            </span>
            {data.current && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px]",
                  data.current.finished ? "bg-paper-deep text-ink-faint" : "bg-moss-wash text-moss",
                )}
              >
                {data.current.finished ? t("classroom_finished") : t("classroom_running")}
              </span>
            )}
          </div>
        </section>
      </div>
      <div
        className={cn("mx-auto grid w-full max-w-5xl gap-6 px-6 pt-8", teacher && "lg:grid-cols-[minmax(0,1fr)_320px]")}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <CurrentTopic room={data} />
          {teacher && <NewTopic room={data} />}
        </div>
        {teacher && data.url && data.code && (
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <SectionTitle>{t("setup_step_share")}</SectionTitle>
            <InviteCard url={data.url} code={data.code} />
          </aside>
        )}
      </div>
    </div>
  );
}

function CurrentTopic({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const navigate = useNavigate();
  const teacher = room.role === "teacher";
  const current = room.current;
  return (
    <section>
      <SectionTitle>{t("classroom_current")}</SectionTitle>
      <Card className="p-6">
        {current ? (
          <>
            <h3 className="font-serif text-2xl leading-snug">{current.topicTitle}</h3>
            <p className="mt-4 border-l-2 border-ember-deep pl-4 font-serif text-[15px] leading-8 text-ink-soft">
              {current.topicStatement}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {teacher ? (
                <>
                  {!current.finished && (
                    <Button onClick={() => void navigate({ to: "/t/live/$id", params: { id: current.activityId } })}>
                      <SquareActivity className="size-4" />
                      {t("nav_live")}
                    </Button>
                  )}
                  <Button
                    variant={current.finished ? "primary" : "outline"}
                    onClick={() => void navigate({ to: "/report/$id", params: { id: current.activityId } })}
                  >
                    <ChartNoAxesColumn className="size-4" />
                    {t("classroom_view_report")}
                  </Button>
                </>
              ) : current.finished ? (
                <Button onClick={() => void navigate({ to: "/report/$id", params: { id: current.activityId } })}>
                  <ChartNoAxesColumn className="size-4" />
                  {t("classroom_view_report")}
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void navigate({
                      to: "/dialogue",
                      search: { activityId: current.activityId, topic: current.topicId },
                    })
                  }
                >
                  <MessageSquare className="size-4" />
                  {t("classroom_enter")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-faint">{t("classroom_no_topic")}</p>
        )}
      </Card>
    </section>
  );
}

function NewTopic({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const queryClient = useQueryClient();
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const [picked, setPicked] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (topicId: string) => api.startActivity(room.id, topicId),
    onSuccess: async () => {
      setPicked(null);
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
  const list = (topics.data ?? []).filter((topic) => topic.id !== room.current?.topicId);

  return (
    <section>
      <SectionTitle>{t("classroom_new_topic")}</SectionTitle>
      <Card className="p-5">
        <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">{t("classroom_new_topic_hint")}</p>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-0.5">
          {list.map((topic) => (
            <button
              type="button"
              key={topic.id}
              aria-pressed={picked === topic.id}
              onClick={() => setPicked(topic.id)}
              className={cn(
                "flex w-full cursor-pointer flex-col items-start rounded-xl border p-3 text-left transition-colors",
                picked === topic.id ? "border-ember-deep bg-ember-wash" : "border-transparent hover:bg-paper-deep",
              )}
            >
              <b className="font-serif text-[15px] font-medium text-ink">{topic.title}</b>
              <span className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{topic.statement}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          {start.isError ? <p className="text-[12.5px] text-flag">{t("common_error")}</p> : <span />}
          <Button disabled={!picked || start.isPending} onClick={() => picked && start.mutate(picked)}>
            {start.isPending ? <Spinner /> : t("classroom_start_topic")}
          </Button>
        </div>
      </Card>
    </section>
  );
}

function InviteCard({ url, code }: { url: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const full = absoluteUrl(url);
  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
      <QrBlock url={url} />
      <span className="font-mono text-2xl tracking-[0.3em]">{code}</span>
      <code className="max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 font-mono text-[12px] text-ink-soft">
        {full}
      </code>
      <Button variant="outline" onClick={() => void copy()}>
        {copied ? t("setup_copied") : t("setup_copy")}
      </Button>
    </Card>
  );
}
