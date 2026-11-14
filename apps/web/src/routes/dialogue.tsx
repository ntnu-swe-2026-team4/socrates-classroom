import { useCallback } from "react";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChartNoAxesColumn } from "lucide-react";
import { api } from "@/api";
import { readActivityId } from "@/api/local";
import { ChatLayout, SidebarHeader } from "@/components/ChatLayout";
import { DialogueView } from "@/components/DialogueView";
import { cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

export const Route = createFileRoute("/dialogue")({
  validateSearch: (search: Record<string, unknown>): { activityId?: string; q?: string; term?: string } => ({
    activityId: typeof search.activityId === "string" ? search.activityId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  beforeLoad: async ({ search, context, location }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login", search: { next: location.href } });
    const activityId = search.activityId ?? readActivityId();
    if (!activityId) throw redirect({ to: "/classrooms" });
    if (me.preview) return;
    const info = await context.queryClient.fetchQuery({
      queryKey: ["activity", activityId],
      queryFn: () => api.activityInfo(activityId),
      staleTime: Infinity,
    });
    const room = await context.queryClient.fetchQuery({
      queryKey: ["classroom", info.classroomId],
      queryFn: () => api.getClassroom(info.classroomId),
    });
    if (room.role === "teacher") {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: info.classroomId } });
    }
  },
  component: DialoguePage,
});

function DialoguePage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const { activityId: activityParam, q, term } = Route.useSearch();
  const activityId = activityParam ?? readActivityId() ?? "";
  const activityQuery = useQuery({
    queryKey: ["activity", activityId],
    queryFn: () => api.activityInfo(activityId),
    enabled: activityId !== "",
    staleTime: Infinity,
  });
  const activityRefetch = useCallback(() => void activityQuery.refetch(), [activityQuery.refetch]);
  const info = activityQuery.data;
  const topic = info?.topic;
  const finished = Boolean(info?.finishedAt);

  return (
    <ChatLayout
      sidebar={
        me.data?.guest && !me.data.preview ? (
          <ActivityTopic title={topic?.title} finished={finished} />
        ) : (
          <ClassroomTopics
            classroomId={me.data?.kind === "student" ? undefined : info?.classroomId}
            listId={info?.classroomId}
            classroomName={info?.classroomName}
            activeId={activityId}
          />
        )
      }
    >
      {me.data ? (
        <DialogueView
          key={activityId}
          threadId={activityId}
          userId={me.data.id}
          title={topic?.title ?? t("dlg_title")}
          subtitle={info?.classroomName}
          statement={topic?.statement}
          prompts={topic?.prompts}
          closedNotice={activityQuery.isError ? t("common_error") : finished ? t("dlg_err_finished") : undefined}
          headerActions={
            finished ? (
              <Link
                to="/report/$id"
                params={{ id: activityId }}
                className="flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs text-ink-soft hover:border-ember hover:text-ink"
              >
                <ChartNoAxesColumn className="size-3.5" />
                <span className="hidden sm:inline">{t("classroom_view_report")}</span>
              </Link>
            ) : undefined
          }
          autoSend={q}
          onActivityFinished={activityRefetch}
          onAutoSent={() =>
            void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, q: undefined }), replace: true })
          }
          openTerm={term}
          onTermOpened={() =>
            void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, term: undefined }), replace: true })
          }
        />
      ) : (
        <div className="flex-1" aria-busy="true" />
      )}
    </ChatLayout>
  );
}

function ActivityTopic({ title, finished }: { title?: string; finished: boolean }) {
  const t = useT();
  return (
    <>
      <SidebarHeader title={t("nav_activity")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3">
        <h3 className="px-2 pb-1 text-[11.5px] text-ink-faint">{t("classroom_topics")}</h3>
        {title && (
          <div className="rounded-lg bg-ember-wash py-2 pr-2 pl-2.5 text-ink">
            <span className="block truncate text-[13.5px]">{title}</span>
            <span className="block text-[11.5px] text-ink-faint">
              {finished ? t("classroom_finished") : t("classroom_running")}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

function ClassroomTopics({
  classroomId,
  listId,
  classroomName,
  activeId,
}: {
  classroomId?: string;
  listId?: string;
  classroomName?: string;
  activeId: string;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  const activities = useQuery({
    queryKey: ["classroom", listId, "activities"],
    queryFn: () => api.classroomActivities(listId ?? ""),
    enabled: Boolean(listId),
  });
  return (
    <>
      <SidebarHeader title={t("classroom_topics")} />
      {classroomId && (
        <div className="shrink-0 border-b border-line px-3 pt-2 pb-3">
          <Link
            to="/classrooms/$classroomId"
            params={{ classroomId }}
            className="-ml-1.5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            {t("classroom_back_to_room")}
          </Link>
          <h2 className="mt-1 truncate font-serif text-[18px] leading-snug text-ink">
            {classroomName ?? t("nav_classrooms")}
          </h2>
        </div>
      )}
      <nav className="stream-scroll min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-3">
        {classroomId && <h3 className="px-2 pb-1 text-[11.5px] text-ink-faint">{t("classroom_topics")}</h3>}
        <ul>
          {(activities.data ?? []).map((activity) => {
            const active = activity.id === activeId;
            return (
              <li key={activity.id}>
                <Link
                  to="/dialogue"
                  search={{ activityId: activity.id }}
                  className={cn(
                    "block rounded-lg py-2 pr-2 pl-2.5 transition-colors",
                    active ? "bg-ember-wash text-ink" : "text-ink-soft hover:bg-paper-deep",
                  )}
                >
                  <span className="block truncate text-[13.5px]">{activity.topicTitle}</span>
                  <span className="block text-[11.5px] text-ink-faint">
                    {formatDate(activity.createdAt)} ·{" "}
                    {activity.finished ? t("classroom_finished") : t("classroom_running")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
