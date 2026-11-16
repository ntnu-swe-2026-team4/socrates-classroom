import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChartNoAxesColumn, GraduationCap, MessageSquare, SquareActivity, Users } from "lucide-react";
import { api } from "@/api";
import type { ClassroomSummary } from "@socrates/shared";
import { AddTopic, CopyTopic, StartActivity, useClassroomTopics } from "@/components/ClassroomTopics";
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
          {teacher && <Topics room={data} />}
          {teacher && <NewActivity room={data} />}
        </div>
        {teacher && data.url && data.code && (
          <aside className="flex flex-col gap-8 lg:sticky lg:top-6 lg:self-start">
            <div>
              <SectionTitle>{t("setup_step_share")}</SectionTitle>
              <InviteCard url={data.url} code={data.code} />
              {data.current && !data.current.finished && (
                <div className="mt-4">
                  <ActivityInviteCard activityId={data.current.activityId} />
                </div>
              )}
            </div>
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
                      search: { activityId: current.activityId },
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

function Topics({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const topics = useClassroomTopics(room.id);
  return (
    <section>
      <SectionTitle>{t("classroom_topics")}</SectionTitle>
      <Card className="p-5">
        {(topics.data ?? []).length === 0 ? (
          <p className="text-[13px] text-ink-faint">{t("classroom_no_topics")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(topics.data ?? []).map((topic) => (
              <li key={topic.id} className="rounded-xl bg-paper-deep p-3">
                <b className="block font-serif text-[15px] font-medium text-ink">{topic.title}</b>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{topic.statement}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-3 text-[13px] text-ink-soft">{t("classroom_add_topic")}</p>
          <AddTopic classroomId={room.id} />
        </div>
        <CopyTopic classroomId={room.id} />
      </Card>
    </section>
  );
}

function NewActivity({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <section>
      <SectionTitle>{t("classroom_new_topic")}</SectionTitle>
      <StartActivity
        classroomId={room.id}
        allowTest
        onStarted={(started) => {
          if (started.mode === "test") void navigate({ to: "/t/live/$id", params: { id: started.activityId } });
        }}
      />
    </section>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(url));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button variant="outline" onClick={() => void copy()}>
      {copied ? t("setup_copied") : t("setup_copy")}
    </Button>
  );
}

function InviteCard({ url, code }: { url: string; code: string }) {
  const t = useT();
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_share_hint")}</p>
      <QrBlock url={url} />
      <span className="font-mono text-2xl tracking-[0.3em]">{code}</span>
      <code className="max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 font-mono text-[12px] text-ink-soft">
        {absoluteUrl(url)}
      </code>
      <CopyLinkButton url={url} />
    </Card>
  );
}

function ActivityInviteCard({ activityId }: { activityId: string }) {
  const t = useT();
  const create = useMutation({
    mutationFn: () => api.createActivityInvite(activityId),
  });
  const url = create.data?.url;
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center">
      <p className="text-[13px] leading-relaxed text-ink-soft">{t("classroom_activity_invite_hint")}</p>
      {url ? (
        <>
          <QrBlock url={url} size={160} />
          <code className="max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 font-mono text-[12px] text-ink-soft">
            {absoluteUrl(url)}
          </code>
          <CopyLinkButton url={url} />
        </>
      ) : (
        <>
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : t("classroom_activity_invite")}
          </Button>
          {create.isError && <p className="text-[12.5px] text-flag">{t("common_error")}</p>}
        </>
      )}
    </Card>
  );
}
