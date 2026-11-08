import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { api, type ClassroomSummary } from "@/api";
import { Button, Input, PageHeader, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";

export const Route = createFileRoute("/classrooms/")({
  component: ClassroomsPage,
});

function ClassroomsPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const [code, setCode] = useState("");
  const teacher = me.data?.role === "teacher";
  const list = classrooms.data ?? [];

  function join() {
    const normalized = normalizeJoinCode(code);
    if (normalized) void navigate({ to: "/join/$code", params: { code: normalized } });
  }

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        width="max-w-5xl"
        eyebrow={teacher ? t("eyebrow_teacher") : t("classrooms_eyebrow_student")}
        title={t("nav_classrooms")}
        description={teacher ? t("classrooms_intro_teacher") : t("classrooms_intro_student")}
        actions={
          teacher ? (
            <Button onClick={() => void navigate({ to: "/t/setup" })}>
              <Plus className="size-4" />
              {t("nav_setup")}
            </Button>
          ) : (
            <form
              className="flex w-full items-center gap-2 sm:w-auto"
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
                className="min-w-0 flex-1 font-mono tracking-[0.2em] sm:w-44 sm:flex-none"
              />
              <Button type="submit" disabled={!code.trim()}>
                {t("join_code_go")}
              </Button>
            </form>
          )
        }
      />
      <div className="mx-auto w-full max-w-5xl px-6 pt-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((room) => (
            <ClassroomCard key={room.id} room={room} />
          ))}
        </div>
        {!classrooms.isPending && !list.length && (
          <div className="rounded-3xl border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-faint">
            {teacher ? t("classrooms_empty_teacher") : t("classrooms_empty_student")}
          </div>
        )}
      </div>
    </div>
  );
}

function ClassroomCard({ room }: { room: ClassroomSummary }) {
  const t = useT();
  return (
    <Link
      to="/classrooms/$classroomId"
      params={{ classroomId: room.id }}
      className="group flex flex-col overflow-hidden rounded-3xl border border-line bg-card transition-all hover:-translate-y-0.5 hover:border-ember-deep hover:shadow-md"
    >
      <div className="bg-gradient-to-br from-ember-wash via-ember-wash/60 to-transparent px-5 pt-5 pb-4">
        <h3 className="truncate font-serif text-[19px] leading-snug text-ink">{room.name}</h3>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
          {room.role === "teacher" ? t("classroom_you_teach") : room.teacherName}
        </p>
      </div>
      <div className="flex flex-1 flex-col px-5 pt-3 pb-4">
        <p className="line-clamp-2 min-h-10 text-[13.5px] leading-relaxed text-ink">
          {room.current ? room.current.topicTitle : <span className="text-ink-faint">{t("classroom_no_topic")}</span>}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-faint">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {t("classroom_members", { n: room.memberCount })}
          </span>
          {room.current && (
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11.5px]",
                room.current.finished ? "bg-paper-deep text-ink-faint" : "bg-moss-wash text-moss",
              )}
            >
              {room.current.finished ? t("classroom_finished") : t("classroom_running")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
