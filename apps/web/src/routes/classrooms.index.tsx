import { useId, useState } from "react";
import { classroomsOptions, myReportsOptions } from "@/api/queries";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumn, ChevronDown, Plus, Users } from "lucide-react";
import type { ClassroomSummary } from "@socrates/shared";

import { meQueryOptions } from "@/api/me";
import { meOf } from "@/api/me";
import { EmptyPanel, LoadMore, PanelState } from "@/components/ClassroomCommunity";
import { Button, Input, PageHeader, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";

export const Route = createFileRoute("/classrooms/")({
  beforeLoad: async ({ context, location }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { next: location.href }, replace: true });
  },
  component: ClassroomsPage,
});

function ClassroomsPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery(meQueryOptions);
  const classrooms = useQuery(classroomsOptions);
  const [code, setCode] = useState("");
  const canManage = Boolean(me.data);
  const list = classrooms.data ?? [];

  function join() {
    const normalized = normalizeJoinCode(code);
    if (normalized) void navigate({ to: "/join/$code", params: { code: normalized } });
  }

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        width="max-w-5xl"
        eyebrow={canManage ? t("eyebrow_teacher") : t("classrooms_eyebrow_student")}
        title={t("nav_classrooms")}
        description={canManage ? t("classrooms_intro_teacher") : t("classrooms_intro_student")}
        actions={
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <form
              className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
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
            {canManage && (
              <Button onClick={() => void navigate({ to: "/t/setup" })}>
                <Plus className="size-4" />
                {t("nav_setup")}
              </Button>
            )}
          </div>
        }
      />
      <div className="mx-auto w-full max-w-5xl px-6 pt-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((room) => (
            <ClassroomCard key={room.id} room={room} />
          ))}
        </div>
        {classrooms.isError && (
          <div role="alert" className="rounded-3xl border border-line-strong px-6 py-14 text-center text-sm text-flag">
            {t("common_error")}
          </div>
        )}
        {!classrooms.isPending && !classrooms.isError && !list.length && (
          <div className="rounded-3xl border border-dashed border-line-strong px-6 py-14 text-center text-sm text-ink-faint">
            {canManage ? t("classrooms_empty_teacher") : t("classrooms_empty_student")}
          </div>
        )}
        {me.data && <PersonalReports key={me.data.id} userId={me.data.id} />}
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

function PersonalReports({ userId }: { userId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section className="mt-8 border-t border-line pt-4">
      <h2 className="font-serif text-xl text-ink">
        <Button
          variant="ghost"
          className="h-auto px-2 py-2 font-serif text-xl"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
        >
          <ChartNoAxesColumn className="size-5" aria-hidden />
          {t("room_my_reports")}
          <ChevronDown className={cn("size-4", open && "rotate-180")} aria-hidden />
        </Button>
      </h2>
      <div id={contentId} hidden={!open} className="mt-2">
        {open && <PersonalReportList userId={userId} />}
      </div>
    </section>
  );
}

function PersonalReportList({ userId }: { userId: string }) {
  const t = useT();
  const formatDate = useFormatDate();
  const reports = useInfiniteQuery(myReportsOptions(userId));
  const items = reports.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-3">
      <PanelState pending={reports.isPending} error={reports.isError} retry={() => void reports.refetch()} />
      {reports.isSuccess && !items.length && <EmptyPanel>{t("room_my_reports_empty")}</EmptyPanel>}
      {items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {items.map((report) => (
            <li key={report.activityId}>
              <Link
                to="/report/$id"
                params={{ id: report.activityId }}
                className="block px-4 py-3 outline-none hover:bg-paper-deep focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ember"
              >
                <p className="break-words font-serif text-base text-ink">{report.topicTitle}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                  <span className="break-words">{report.classroomName}</span>
                  {report.finishedAt && <time dateTime={report.finishedAt}>{formatDate(report.finishedAt)}</time>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {reports.hasNextPage && (
        <LoadMore pending={reports.isFetchingNextPage} onClick={() => void reports.fetchNextPage()} />
      )}
    </div>
  );
}
