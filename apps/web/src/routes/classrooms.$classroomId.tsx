import { useCallback } from "react";
import type { ClassroomSummary } from "@socrates/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, ChartNoAxesColumn, Megaphone, MessageSquare, SquareActivity, Users } from "lucide-react";
import { subscribeToClassroom } from "@/api/classroom-events";
import { meOf } from "@/api/me";
import { classroomActivitiesOptions, classroomsOptions } from "@/api/queries";
import { ClassroomFeed, EmptyPanel, LoadMore, PanelState } from "@/components/ClassroomCommunity";
import { ClassroomPeople } from "@/components/ClassroomPeople";
import { AddTopic, CopyTopic, StartActivity, useClassroomTopics } from "@/components/ClassroomTopics";
import { Button, Card, SectionTitle, buttonStyles, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

const channels = {
  topics: { label: "room_tab_topics", icon: BookOpen },
  announcements: { label: "room_tab_announcements", icon: Megaphone },
  board: { label: "room_tab_board", icon: MessageSquare },
  members: { label: "room_tab_members", icon: Users },
} as const;

type Tab = keyof typeof channels;
const tabs = Object.keys(channels) as Tab[];

export const Route = createFileRoute("/classrooms/$classroomId")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: typeof search.tab === "string" && Object.hasOwn(channels, search.tab) ? (search.tab as Tab) : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login" });
    return { viewerId: me.id };
  },
  component: ClassroomPage,
});

function ClassroomPage() {
  const t = useT();
  const { classroomId } = Route.useParams();
  const { viewerId } = Route.useRouteContext();
  const { tab = "topics" } = Route.useSearch();
  const classrooms = useQuery(classroomsOptions);
  const room = classrooms.data?.find((entry) => entry.id === classroomId);

  if (classrooms.isPending || classrooms.isError) {
    return (
      <div className="mx-auto max-w-5xl px-6 pt-20 md:pt-8">
        <PanelState pending={classrooms.isPending} error={classrooms.isError} retry={() => void classrooms.refetch()} />
      </div>
    );
  }
  if (!room) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[15px] text-ink-soft">{t("classroom_missing")}</p>
        <Link to="/classrooms" className={buttonStyles({ variant: "outline" })}>
          {t("classroom_back")}
        </Link>
      </div>
    );
  }
  return <ClassroomView key={room.id} room={room} rooms={classrooms.data} viewerId={viewerId} tab={tab} />;
}

function ClassroomView({
  room,
  rooms,
  viewerId,
  tab,
}: {
  room: ClassroomSummary;
  rooms: ClassroomSummary[];
  viewerId: string;
  tab: Tab;
}) {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const teacher = room.role === "teacher";
  const connect = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) return subscribeToClassroom(client, room.id);
    },
    [client, room.id],
  );
  const ChannelIcon = channels[tab].icon;

  return (
    <div ref={connect} className="mx-auto min-h-full w-full max-w-6xl px-4 pt-18 pb-12 sm:px-6 md:pt-8">
      <Link
        to="/classrooms"
        activeOptions={{ exact: true }}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("nav_classrooms")}
      </Link>
      <header className="mt-3 min-w-0 border-y border-line py-5 sm:py-6">
        <h1 className="break-words font-serif text-3xl leading-tight text-ink sm:text-4xl">{room.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <p>{teacher ? t("classroom_you_teach") : t("classroom_teacher_is", { name: room.teacherName })}</p>
          <p className="flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {t("classroom_members", { n: room.memberCount })}
          </p>
        </div>
      </header>
      <div className="mt-4 grid min-w-0 items-start gap-4 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
        <aside className="min-w-0 rounded-xl border border-line bg-card p-2 md:sticky md:top-6">
          {rooms.length > 1 && (
            <select
              aria-label={t("classroom_pick_class")}
              value={room.id}
              onChange={(event) =>
                void navigate({
                  to: "/classrooms/$classroomId",
                  params: { classroomId: event.target.value },
                  search: {},
                })
              }
              className="mb-2 h-10 w-full truncate rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ember/60"
            >
              {rooms.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
          <nav aria-label={t("room_tabs")} className="grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-1">
            {tabs.map((entry) => {
              const channel = channels[entry];
              const Icon = channel.icon;
              return (
                <Link
                  key={entry}
                  to="/classrooms/$classroomId"
                  params={{ classroomId: room.id }}
                  search={entry === "topics" ? {} : { tab: entry }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-lg border-l-2 px-2.5 py-2.5 text-sm leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ember/60",
                    tab === entry
                      ? "border-ember bg-paper-deep font-semibold text-ink"
                      : "border-transparent text-ink-soft hover:bg-paper-deep hover:text-ink",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{t(channel.label)}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">
          <h2 className="mb-4 flex items-center gap-2 border-b border-line pb-3 font-serif text-xl text-ink">
            <ChannelIcon className="size-5 shrink-0 text-ember" aria-hidden />
            {t(channels[tab].label)}
          </h2>
          {tab === "topics" && (
            <div className="space-y-6">
              <CurrentTopic room={room} />
              <ActivityHistory room={room} />
              {teacher && <NewActivity room={room} />}
              {teacher && <Topics room={room} />}
            </div>
          )}
          {tab === "announcements" && (
            <ClassroomFeed key={tab} id={room.id} viewerId={viewerId} teacher={teacher} kind="announcements" />
          )}
          {tab === "board" && (
            <ClassroomFeed key={tab} id={room.id} viewerId={viewerId} teacher={teacher} kind="posts" />
          )}
          {tab === "members" && (
            <ClassroomPeople
              id={room.id}
              viewerId={viewerId}
              teacher={teacher}
              onLeave={() => void navigate({ to: "/classrooms" })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityHistory({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const formatDate = useFormatDate();
  const options = classroomActivitiesOptions(room.id);
  const history = useInfiniteQuery(options);
  const teacher = room.role === "teacher";
  const activities =
    history.data?.pages
      .flatMap((page) => page.items)
      .filter((activity) => (teacher || activity.mode === "live") && activity.id !== room.current?.activityId) ?? [];
  return (
    <section className="space-y-3">
      <SectionTitle>{t("room_activity_history")}</SectionTitle>
      <PanelState pending={history.isPending} error={history.isError} retry={() => void history.refetch()} />
      {history.isSuccess && !activities.length && <EmptyPanel>{t("room_activity_empty")}</EmptyPanel>}
      {activities.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {activities.map((activity) => (
            <li key={activity.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words font-serif text-base text-ink">{activity.topicTitle}</p>
                <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-soft">
                  <time dateTime={activity.createdAt}>{formatDate(activity.createdAt)}</time>
                  {activity.mode === "test" && <span>{t("room_activity_test")}</span>}
                  <span>{t(activity.finishedAt ? "classroom_finished" : "classroom_running")}</span>
                </div>
              </div>
              {activity.finishedAt ? (
                <Link
                  to="/report/$id"
                  params={{ id: activity.id }}
                  className={buttonStyles({ variant: "outline", size: "sm" })}
                >
                  {t("classroom_view_report")}
                </Link>
              ) : teacher ? (
                <Link
                  to="/t/live/$id"
                  params={{ id: activity.id }}
                  className={buttonStyles({ variant: "outline", size: "sm" })}
                >
                  {t("nav_live")}
                </Link>
              ) : (
                <Link
                  to="/dialogue"
                  search={{ activityId: activity.id }}
                  className={buttonStyles({ variant: "outline", size: "sm" })}
                >
                  {t("classroom_enter")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <LoadMore pending={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} />
      )}
    </section>
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
  const client = useQueryClient();
  return (
    <section>
      <SectionTitle>{t("classroom_new_topic")}</SectionTitle>
      <StartActivity
        classroomId={room.id}
        allowTest
        onStarted={(started) => {
          void client.invalidateQueries({ queryKey: classroomActivitiesOptions(room.id).queryKey });
          if (started.mode === "test") void navigate({ to: "/t/live/$id", params: { id: started.activityId } });
        }}
      />
    </section>
  );
}
