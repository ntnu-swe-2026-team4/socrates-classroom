import { takeClassroomInvite } from "@/lib/classroomInvite";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { classroomsOptions, soloThreadsOptions } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { meQueryOptions } from "@/api/me";
import { meOf } from "@/api/me";
import { DotField } from "@/components/DotField";
import { Button, Card, PageHeader } from "@/components/ui";
import { useFormatDate, useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/home")({
  beforeLoad: async ({ context, preload }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login" });
    const invite = preload ? undefined : takeClassroomInvite();
    if (invite) throw redirect({ href: invite, replace: true });
  },
  component: HomePage,
});

function greetingKey(): MessageKey {
  const h = new Date().getHours();
  return h < 5
    ? "greet_night"
    : h < 11
      ? "greet_morning"
      : h < 14
        ? "greet_noon"
        : h < 18
          ? "greet_afternoon"
          : "greet_evening";
}

function StatCardHint({ label }: { label: string }) {
  return (
    <span className="absolute right-5 bottom-4 inline-flex items-center gap-1 text-xs text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
      {label}
      <ArrowRight aria-hidden className="size-3.5" />
    </span>
  );
}

function HomePage() {
  const t = useT();
  const me = useQuery(meQueryOptions);
  const classrooms = useQuery(classroomsOptions);
  const chats = useQuery({ ...soloThreadsOptions(me.data?.id ?? ""), enabled: Boolean(me.data) });
  const formatDate = useFormatDate();
  const chatList = chats.data ?? [];
  const canManage = Boolean(me.data);
  const roomList = classrooms.data ?? [];
  const running = roomList.filter((room) => room.current && !room.current.finished);
  const students = roomList.reduce((n, room) => n + room.memberCount, 0);
  const managesClassrooms = me.data?.isAdmin === true || roomList.some((room) => room.role === "teacher");

  return (
    <div className="relative isolate flex min-h-full flex-col">
      <DotField className="-z-10" />
      <PageHeader width="max-w-4xl" eyebrow={t("home_eyebrow")} title={t("nav_home")} />
      <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6">
        <Card className="grid gap-8 bg-linear-to-br from-ember-wash to-transparent p-8 md:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            <p className="text-xs text-ember">
              {t("home_greeting", { greeting: t(greetingKey()), name: me.data?.name ?? "" })}
            </p>
            <h2 className="mt-1 font-serif text-3xl">{t("home_question")}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/chat">
                <Button>{t("home_start")}</Button>
              </Link>
              {canManage ? (
                <Link to="/classrooms">
                  <Button variant="outline">{t("home_open_classroom")}</Button>
                </Link>
              ) : (
                <Link to="/classrooms">
                  <Button variant="outline">{t("home_enter_classroom")}</Button>
                </Link>
              )}
            </div>
          </div>
          <blockquote className="flex flex-col justify-center gap-3 border-line pl-8 max-md:hidden md:border-l">
            <p className="font-serif text-lg leading-relaxed">“{t("home_quote")}”</p>
            <cite className="text-xs not-italic text-ink-faint">— {t("dlg_socrates")}</cite>
          </blockquote>
        </Card>

        <section className="grid gap-4 sm:grid-cols-2">
          <Link to="/classrooms" className="group">
            <Card className="comic-lift relative h-full p-5 pb-9 hover:border-ember-deep">
              <span className="block text-sm">{t("home_stat_classrooms")}</span>
              <b className="mt-1 block font-serif text-4xl font-medium text-ember">{roomList.length}</b>
              <span className="text-xs text-ink-faint">
                {canManage ? t("home_stat_students", { n: students }) : t("home_stat_running", { n: running.length })}
              </span>
              <StatCardHint label={t(managesClassrooms ? "home_manage_classrooms" : "home_go_classrooms")} />
            </Card>
          </Link>
          <Link to="/chat" className="group">
            <Card className="comic-lift relative h-full p-5 pb-9 hover:border-ember-deep">
              <span className="block text-sm">{t("home_stat_chats")}</span>
              <b className="mt-1 block font-serif text-4xl font-medium text-ember">{chatList.length}</b>
              <span className="mt-1 block truncate text-xs text-ink-faint">
                {chatList[0]?.title ?? t("chat_empty")}
              </span>
              <StatCardHint label={t("home_go_chat")} />
            </Card>
          </Link>
        </section>

        <section>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-[15.5px]">{t("home_recent_chats")}</h3>
              <Link to="/chat" className="text-xs text-ember hover:underline">
                {t("home_all")}
              </Link>
            </div>
            {chatList.slice(0, 5).map((chat) => (
              <Link
                key={chat.id}
                to="/chat/$chatId"
                params={{ chatId: chat.id }}
                className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <span className="min-w-0 truncate text-sm">{chat.title}</span>
                <span className="shrink-0 text-xs text-ink-faint">{formatDate(chat.updatedAt)}</span>
              </Link>
            ))}
            {!chatList.length && <p className="text-sm text-ink-faint">{t("chat_empty")}</p>}
          </Card>
        </section>

        <section>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-[15.5px]">{t("home_classroom_feed")}</h3>
              <Link to="/classrooms" className="text-xs text-ember hover:underline">
                {t("home_all")}
              </Link>
            </div>
            {roomList.slice(0, 5).map((room) => (
              <Link
                key={room.id}
                to="/classrooms/$classroomId"
                params={{ classroomId: room.id }}
                className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{room.name}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {room.current ? room.current.topicTitle : t("classroom_no_topic")}
                  </span>
                </span>
                {room.current && (
                  <span
                    className={
                      room.current.finished
                        ? "shrink-0 rounded-full bg-paper-deep px-2.5 py-0.5 text-[11.5px] text-ink-faint"
                        : "shrink-0 rounded-full bg-moss-wash px-2.5 py-0.5 text-[11.5px] text-moss"
                    }
                  >
                    {room.current.finished ? t("classroom_finished") : t("classroom_running")}
                  </span>
                )}
              </Link>
            ))}
            {!roomList.length && (
              <p className="text-sm text-ink-faint">
                {canManage ? t("classrooms_empty_teacher") : t("classrooms_empty_student")}
              </p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
