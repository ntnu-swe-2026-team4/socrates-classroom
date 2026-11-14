import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChartNoAxesColumn,
  Copy,
  Eye,
  Pencil,
  MessageSquare,
  Plus,
  SquareActivity,
  Trash2,
  Users,
} from "lucide-react";
import { api, type ClassroomActivity, type ClassroomSummary } from "@/api";
import { QrBlock, absoluteUrl } from "@/components/QrBlock";
import { Button, ConfirmDialog, Field, FormDialog, Initial, Input, Spinner, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";
import { TopicPicker } from "@/components/TopicPicker";
import {
  AnnouncementsPanel,
  BoardPanel,
  MembersPanel,
  AddStudentsButton,
  ROOM_TABS,
  RoomTabs,
  roomPanelId,
  roomTabId,
  type RoomTab,
} from "@/components/ClassroomCommunity";

export const Route = createFileRoute("/classrooms/$classroomId")({
  validateSearch: (search: Record<string, unknown>): { tab?: RoomTab } => ({
    tab: ROOM_TABS.includes(search.tab as RoomTab) && search.tab !== "topics" ? (search.tab as RoomTab) : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
    if (me.guest && !me.preview && me.activityId) {
      throw redirect({ to: "/dialogue", search: { activityId: me.activityId } });
    }
  },
  component: ClassroomPage,
});

function ClassroomPage() {
  const t = useT();
  const { classroomId } = Route.useParams();
  const tab = Route.useSearch().tab ?? "topics";
  const navigate = Route.useNavigate();
  const room = useQuery({ queryKey: ["classroom", classroomId], queryFn: () => api.getClassroom(classroomId) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const activities = useQuery({
    queryKey: ["classroom", classroomId, "activities"],
    queryFn: () => api.classroomActivities(classroomId),
  });

  if (room.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (room.isError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] text-ink-soft">{t("classroom_missing")}</p>
        <Link to="/classrooms" className="text-sm text-ember">
          {t("classroom_back")}
        </Link>
      </div>
    );
  }

  const data = room.data;
  const list = activities.data ?? [];
  const selected =
    list.find((activity) => activity.id === selectedId) ??
    list.find((activity) => activity.id === data.current?.activityId) ??
    (data.current
      ? {
          id: data.current.activityId,
          topicId: data.current.topicId,
          topicTitle: data.current.topicTitle,
          topicStatement: data.current.topicStatement,
          createdAt: data.createdAt,
          finished: data.current.finished,
        }
      : null);
  const teacher = data.role === "teacher";
  const running = data.current && !data.current.finished;
  const bound = me.data?.kind === "student";

  return (
    <div className="min-h-full bg-paper-deep pb-10">
      <div className="mx-auto w-full max-w-6xl px-4 pt-14 md:px-6 md:pt-5">
        <header className="overflow-hidden rounded-xl border border-line bg-paper shadow-sm">
          <div className="relative flex min-h-[150px] flex-col justify-end gap-2 overflow-hidden bg-comic-night [&>:not(img):not(a)]:relative px-5 py-4 [--color-ink-faint:rgb(255_255_255/0.65)] [--color-ink-soft:rgb(255_255_255/0.8)] [--color-ink:#ffffff] [--color-paper-deep:rgb(255_255_255/0.14)] md:px-7 md:py-5">
            <img
              src="/greek/banner.webp"
              alt=""
              decoding="async"
              className="pointer-events-none absolute top-0 right-0 h-full max-sm:opacity-40"
            />
            <Link
              to="/classrooms"
              search={{ view: teacher ? "teacher" : "student" }}
              hidden={bound}
              className="absolute top-3 left-4 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink md:left-6"
            >
              <ArrowLeft className="size-3.5" />
              {teacher ? t("nav_classrooms") : t("nav_learning")}
            </Link>
            {teacher ? (
              <CourseName room={data} />
            ) : (
              <h1 className="min-w-0 truncate text-[26px] leading-tight font-semibold tracking-tight text-ink md:text-[30px]">
                {data.name}
              </h1>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
              <span>{t("classroom_teacher_is", { name: data.teacherName })}</span>
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {t("classroom_members", { n: data.memberCount })}
              </span>
              {data.current && (
                <span className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", running ? "bg-moss" : "bg-ink-faint")} />
                  {running ? t("classroom_running") : t("classroom_finished")}
                </span>
              )}
            </p>
          </div>
          <div className="flex h-12 items-stretch gap-2 px-3 md:px-5">
            <div className="flex min-w-0 flex-1 items-stretch">
              <RoomTabs
                value={tab}
                onChange={(next) =>
                  void navigate({
                    search: (prev) => ({ ...prev, tab: next === "topics" ? undefined : next }),
                    replace: true,
                  })
                }
              />
            </div>
            {teacher && (
              <div className="flex shrink-0 items-center gap-1">
                <PreviewButton room={data} />
                <DeleteClassroomButton room={data} />
              </div>
            )}
          </div>
        </header>
      </div>

      <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 pt-4 md:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 max-lg:order-2 lg:sticky lg:top-4 lg:self-start">
          {teacher && data.url && data.code ? (
            <>
              <InviteCard url={data.url} code={data.code} ready={Boolean(data.current)} />
              <Section title={t("students_card_title")}>
                <div className="flex flex-col gap-2 p-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("students_card_desc")}</p>
                  <AddStudentsButton classroomId={data.id} block />
                </div>
              </Section>
            </>
          ) : (
            <AboutCard room={data} />
          )}
        </aside>
        <div
          id={roomPanelId(tab)}
          role="tabpanel"
          aria-labelledby={roomTabId(tab)}
          className="flex min-w-0 flex-col gap-4"
        >
          {tab === "topics" && (
            <>
              {(selected || !teacher) && <SelectedTopic room={data} activity={selected} />}
              {(activities.isPending || (activities.data?.length ?? 0) > 0) && (
                <TopicHistory
                  activities={activities.data ?? []}
                  loading={activities.isPending}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              )}
              {teacher && <NewTopic room={data} />}
            </>
          )}
          {tab === "announcements" && <AnnouncementsPanel room={data} />}
          {tab === "board" && <BoardPanel room={data} />}
          {tab === "members" && <MembersPanel room={data} />}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-paper shadow-sm">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-[13.5px] font-medium text-ink">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function SelectedTopic({ room, activity }: { room: ClassroomSummary; activity: ClassroomActivity | null }) {
  const t = useT();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const teacher = room.role === "teacher";
  const isCurrent = activity?.id === room.current?.activityId;
  return (
    <Section
      title={isCurrent ? t("classroom_current") : t("classroom_selected_topic")}
      actions={
        activity && (
          <span
            className={cn(
              "rounded-lg px-2 py-0.5 text-[11px]",
              activity.finished ? "bg-paper-deep text-ink-faint" : "bg-moss-wash text-moss",
            )}
          >
            {activity.finished ? t("classroom_finished") : t("classroom_running")}
          </span>
        )
      }
    >
      {activity ? (
        <div className="px-3 pt-3 pb-3">
          <h3 className="font-serif text-[20px] leading-snug text-ink">{activity.topicTitle}</h3>
          <p className="mt-2 border-l-2 border-ember pl-3 font-serif text-[14.5px] leading-7 text-ink-soft">
            {activity.topicStatement}
          </p>
          <p className="mt-2 text-[12px] text-ink-faint">{formatDate(activity.createdAt)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!activity.finished &&
              (teacher ? (
                <Button onClick={() => void navigate({ to: "/t/live/$id", params: { id: activity.id } })}>
                  <SquareActivity className="size-4" />
                  {t("nav_live")}
                </Button>
              ) : (
                <Button onClick={() => void navigate({ to: "/dialogue", search: { activityId: activity.id } })}>
                  <MessageSquare className="size-4" />
                  {t("classroom_enter")}
                </Button>
              ))}
            {(teacher || activity.finished) && (
              <Button
                variant={activity.finished ? "primary" : "outline"}
                onClick={() => void navigate({ to: "/report/$id", params: { id: activity.id } })}
              >
                <ChartNoAxesColumn className="size-4" />
                {t("classroom_view_report")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="px-3 py-3 text-sm text-ink-faint">{t("classroom_no_topic")}</p>
      )}
    </Section>
  );
}

function TopicHistory({
  activities,
  loading,
  selectedId,
  onSelect,
}: {
  activities: ClassroomActivity[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  return (
    <Section title={t("classroom_topics")}>
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : activities.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-faint">{t("classroom_no_topic")}</p>
      ) : (
        <ol className="flex flex-col gap-1 p-1.5">
          {activities.map((activity, index) => {
            const active = activity.id === selectedId;
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(activity.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                    active ? "bg-ember-wash" : "hover:bg-paper-deep",
                  )}
                >
                  <span className="w-6 shrink-0 text-right font-mono text-[12px] text-ink-faint">
                    {activities.length - index}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{activity.topicTitle}</span>
                    <span className="block text-[11.5px] text-ink-faint">{formatDate(activity.createdAt)}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-lg px-2 py-0.5 text-[11px]",
                      activity.finished ? "bg-paper-deep text-ink-faint" : "bg-moss-wash text-moss",
                    )}
                  >
                    {activity.finished ? t("classroom_finished") : t("classroom_running")}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function PreviewButton({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const preview = useMutation({
    mutationFn: () => api.previewAsStudent(room.id),
    onSuccess: ({ activityId }) => {
      window.location.assign(`/dialogue?activityId=${encodeURIComponent(activityId)}`);
    },
  });
  if (!room.current) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={preview.isPending}
      onClick={() => preview.mutate()}
      className="h-7 px-2.5 text-[12px] font-normal"
    >
      {preview.isPending ? <Spinner /> : <Eye className="size-3.5" />}
      {t("preview_start")}
    </Button>
  );
}

function NewTopic({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const queryClient = useQueryClient();
  const first = !room.current;
  const [open, setOpen] = useState(first);
  return (
    <Section
      title={first ? t("classroom_first_topic") : t("classroom_new_topic")}
      actions={
        !first && (
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <Plus className="size-3.5" />
            {open ? t("common_cancel") : t("classroom_start_topic")}
          </Button>
        )
      }
    >
      {open || first ? (
        <div className="p-3">
          <p className="mb-2 text-[12.5px] leading-relaxed text-ink-soft">
            {first ? t("classroom_first_topic_hint") : t("classroom_new_topic_hint")}
          </p>
          <TopicPicker
            excludeId={room.current?.topicId}
            submitLabel={t("classroom_start_topic")}
            onPicked={async (topicId) => {
              await api.startActivity(room.id, topicId);
              setOpen(false);
              await queryClient.invalidateQueries({ queryKey: ["classroom", room.id] });
              await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
            }}
          />
        </div>
      ) : (
        <p className="px-3 py-2.5 text-[12.5px] text-ink-faint">{t("classroom_new_topic_hint")}</p>
      )}
    </Section>
  );
}

function InviteCard({ url, code, ready }: { url: string; code: string; ready: boolean }) {
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
    <Section title={t("setup_step_share")}>
      <div className="flex flex-col items-center gap-3 p-3 text-center">
        <QrBlock url={url} />
        <span className="font-mono text-2xl tracking-[0.3em] text-ink">{code}</span>
        <code className="w-full truncate rounded-lg bg-paper-deep px-3 py-1 font-mono text-[11.5px] text-ink-soft">
          {full}
        </code>
        <Button variant="outline" size="sm" className="w-full" onClick={() => void copy()}>
          <Copy className="size-3.5" />
          {copied ? t("setup_copied") : t("setup_copy")}
        </Button>
        <p className="text-[12px] leading-relaxed text-ink-faint">{t("setup_share_hint")}</p>
        {!ready && (
          <p className="rounded-xl bg-ember-wash px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
            {t("classroom_invite_needs_topic")}
          </p>
        )}
      </div>
    </Section>
  );
}

function AboutCard({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const formatDate = useFormatDate();
  return (
    <Section title={t("classroom_about")}>
      <div className="flex items-center gap-3 px-3 pt-3">
        <Initial name={room.teacherName} className="size-11 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-[14px] text-ink">{room.teacherName}</p>
          <p className="text-[12px] text-ink-faint">{t("classroom_teacher_label")}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 px-3 py-3 text-[12.5px]">
        <div className="rounded-xl bg-paper-deep px-3 py-2">
          <dt className="text-ink-faint">{t("classroom_members_label")}</dt>
          <dd className="font-serif text-[18px] text-ink">{room.memberCount}</dd>
        </div>
        <div className="rounded-xl bg-paper-deep px-3 py-2">
          <dt className="text-ink-faint">{t("classroom_created_label")}</dt>
          <dd className="font-serif text-[18px] text-ink">{formatDate(room.createdAt)}</dd>
        </div>
      </dl>
      <p className="border-t border-line px-3 py-3 text-[12.5px] leading-relaxed text-ink-soft">
        {t("classroom_student_hint")}
      </p>
    </Section>
  );
}

function DeleteClassroomButton({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteClassroom(room.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["classroom", room.id] });
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      await navigate({ to: "/classrooms", search: { view: "teacher" }, replace: true });
    },
  });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={remove.isPending}
        onClick={() => setConfirming(true)}
        aria-label={t("classroom_delete")}
        title={t("classroom_delete")}
        className="h-7 w-7 px-0 text-ink-faint hover:bg-flag-wash hover:text-flag"
      >
        {remove.isPending ? <Spinner /> : <Trash2 className="size-3.5" />}
      </Button>
      <ConfirmDialog
        open={confirming}
        danger
        title={t("classroom_delete_title")}
        body={t("classroom_delete_body", { name: room.name })}
        confirmLabel={t("classroom_delete")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate();
        }}
      />
    </>
  );
}

function CourseName({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(room.name);
  const rename = useMutation({
    mutationFn: () => api.renameClassroom(room.id, value.trim()),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["classroom", room.id] });
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="truncate text-[26px] leading-tight font-semibold tracking-tight text-ink md:text-[30px]">
        {room.name}
      </h1>
      <button
        type="button"
        aria-label={t("classroom_rename")}
        title={t("classroom_rename")}
        onClick={() => {
          setValue(room.name);
          setEditing(true);
        }}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-paper-deep hover:text-ink"
      >
        <Pencil className="size-3.5" />
      </button>
      <FormDialog
        open={editing}
        title={t("classroom_rename")}
        submitLabel={t("common_save")}
        cancelLabel={t("common_cancel")}
        canSubmit={value.trim().length > 0 && value.trim() !== room.name}
        submitting={rename.isPending}
        onCancel={() => setEditing(false)}
        onSubmit={() => rename.mutate()}
      >
        <Field label={t("classroom_name_label")}>
          <Input autoFocus value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} />
        </Field>
        {rename.isError && <p className="text-[12.5px] text-flag">{t("common_error")}</p>}
      </FormDialog>
    </div>
  );
}
