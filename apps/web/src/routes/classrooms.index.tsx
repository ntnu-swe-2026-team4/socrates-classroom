import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { api, ApiError, type ClassroomSummary } from "@/api";
import { Button, ConfirmDialog, Initial, Input, PageHeader, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";

type View = "student" | "teacher";

export const Route = createFileRoute("/classrooms/")({
  validateSearch: (search: Record<string, unknown>): { view?: View } => ({
    view: search.view === "teacher" ? "teacher" : search.view === "student" ? "student" : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
    if (me?.preview && me.previewClassroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.previewClassroomId } });
    }
    if (me.guest && !me.preview && me.activityId)
      throw redirect({ to: "/dialogue", search: { activityId: me.activityId } });
    if (me.kind === "student" && me.classroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.classroomId } });
    }
  },
  component: ClassroomsPage,
});

function ClassroomsPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const teacherMode = me.data?.teacherMode === true;
  const { view } = Route.useSearch();
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const [code, setCode] = useState("");
  const [needAccount, setNeedAccount] = useState(false);
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.createClassroom(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      await navigate({ to: "/classrooms/$classroomId", params: { classroomId: created.classroomId } });
    },
  });
  const owned = (classrooms.data ?? []).filter((room) => room.role === "teacher");
  const joined = (classrooms.data ?? []).filter((room) => room.role !== "teacher");
  const guest = me.data?.guest ?? true;
  const canTeach = me.data?.kind === "member" && !guest;
  const teaching = view === "teacher" && canTeach && teacherMode;
  const startCreate = () => (guest ? setNeedAccount(true) : create.mutate());

  function join() {
    const normalized = normalizeJoinCode(code);
    if (normalized) void navigate({ to: "/join/$code", params: { code: normalized } });
  }

  return (
    <div className="min-h-full bg-paper-deep pb-10">
      <ConfirmDialog
        open={needAccount}
        title={t("account_required_title")}
        body={t("account_required_body")}
        confirmLabel={t("account_required_register")}
        cancelLabel={t("account_required_later")}
        onCancel={() => setNeedAccount(false)}
        onConfirm={() => {
          setNeedAccount(false);
          void navigate({ to: "/login", search: { mode: "register", next: "/classrooms?view=teacher" } });
        }}
      />
      <PageHeader
        width="max-w-none"
        title={teaching ? t("nav_classrooms") : t("nav_learning")}
        description={teaching ? t("classrooms_teaching_intro") : t("classrooms_learning_intro")}
        actions={
          teaching ? (
            <Button disabled={create.isPending} onClick={startCreate}>
              {create.isPending ? <Spinner /> : <Plus className="size-4" />}
              {t("nav_setup")}
            </Button>
          ) : (
            <form
              className="flex w-full min-w-0 items-center gap-2 sm:w-auto"
              onSubmit={(event) => {
                event.preventDefault();
                join();
              }}
            >
              <Input
                value={code}
                aria-label={t("join_code_label")}
                placeholder={t("join_code_placeholder")}
                onChange={(event) => setCode(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 font-mono tracking-[0.2em] sm:w-40 sm:flex-none"
              />
              <Button type="submit" disabled={!code.trim()}>
                {t("join_code_go")}
              </Button>
            </form>
          )
        }
      />
      <div className="w-full px-4 pt-5 md:px-6">
        {create.isError && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-flag/40 bg-flag-wash px-4 py-3 text-[13px] text-flag"
          >
            {create.error instanceof ApiError && create.error.code === "trial_limit"
              ? create.error.message
              : t("common_error")}
          </p>
        )}
        {classrooms.isError && (
          <div role="alert" className="rounded-xl border border-line-strong px-4 py-8 text-center text-sm text-flag">
            {t("common_error")}
          </div>
        )}
        {teaching ? (
          <RoomGroup title={null} rooms={owned} empty={t("classrooms_teaching_empty")} />
        ) : (
          <RoomGroup title={null} rooms={joined} empty={t("classrooms_learning_empty")} />
        )}
      </div>
    </div>
  );
}

function RoomGroup({ title, rooms, empty }: { title: string | null; rooms: ClassroomSummary[]; empty: string }) {
  return (
    <section className="mb-7">
      {title && <h2 className="mb-3 font-serif text-[16px] text-ink">{title}</h2>}
      {rooms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {rooms.map((room) => (
            <ClassroomCard key={room.id} room={room} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-faint">
          {empty}
        </div>
      )}
    </section>
  );
}

const COVER_TONES = [
  "bg-ember-wash text-ember",
  "bg-moss-wash text-moss",
  "bg-flag-wash text-flag",
  "bg-paper-deep text-ink-soft",
] as const;

function toneOf(id: string): (typeof COVER_TONES)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVER_TONES[hash % COVER_TONES.length]!;
}

function ClassroomCard({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const teacher = room.role === "teacher";
  const running = room.current && !room.current.finished;
  return (
    <Link
      to="/classrooms/$classroomId"
      params={{ classroomId: room.id }}
      className="group flex flex-col rounded-xl border border-line bg-card transition-shadow hover:shadow-md"
    >
      <div className={cn("relative aspect-[16/9] rounded-t-2xl", toneOf(room.id))}>
        <div className="absolute inset-0 overflow-hidden rounded-t-2xl">
          <svg
            aria-hidden
            viewBox="0 0 160 90"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 size-full"
          >
            <g fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.8">
              <circle cx="132" cy="18" r="34" />
              <circle cx="132" cy="18" r="22" />
              <path d="M0 70 C40 50 70 88 110 66 S160 58 160 58" />
              <path d="M0 80 C40 60 70 98 110 76 S160 68 160 68" />
            </g>
          </svg>
          <span
            aria-hidden
            className="absolute top-3 left-4 font-serif text-[56px] leading-none opacity-40 select-none"
          >
            {room.name.slice(0, 1)}
          </span>
        </div>
        {room.current && (
          <span
            className={cn(
              "absolute top-3 right-3 rounded-lg px-2 py-0.5 text-[11px] font-medium",
              running ? "bg-moss text-paper" : "bg-paper/80 text-ink-faint",
            )}
          >
            {running ? t("classroom_running") : t("classroom_finished")}
          </span>
        )}
        <div className="absolute right-3 bottom-0 z-10 flex translate-y-1/2 items-center">
          <Initial name={room.teacherName} className="size-10 border-2 border-card text-[15px]" />
          {room.memberCount > 0 && (
            <span className="-ml-2 flex size-10 items-center justify-center rounded-full border-2 border-card bg-paper-deep text-[11.5px] text-ink-soft">
              +{room.memberCount}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-4 pt-4 pb-4">
        <h3 className="line-clamp-2 pr-20 font-serif text-[18px] leading-snug text-ember group-hover:underline">
          {room.name}
        </h3>
        {!teacher && (
          <p className="text-[12px] text-ink-faint">{t("classroom_teacher_is", { name: room.teacherName })}</p>
        )}
        {room.current ? (
          <>
            <p className="mt-1 text-[13.5px] font-medium text-ink">{room.current.topicTitle}</p>
            <p className="line-clamp-4 text-[13px] leading-relaxed text-ink-soft">{room.current.topicStatement}</p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-faint">{t("classroom_no_topic")}</p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-3 text-[12px] text-ink-faint">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {t("classroom_members", { n: room.memberCount })}
          </span>
        </div>
      </div>
    </Link>
  );
}
