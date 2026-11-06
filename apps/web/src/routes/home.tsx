import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api } from "@/api";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";
import { SUGGESTION_KEYS, useStartChat } from "@/hooks/useStartChat";
import { openAccountSheet } from "@/lib/accountSheet";
import { isDefaultGuestName } from "@/lib/guestName";

export const Route = createFileRoute("/home")({
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

function HomePage() {
  const t = useT();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const chats = useQuery({ queryKey: ["soloChats"], queryFn: () => api.listSoloChats() });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const start = useStartChat();
  const [q, setQ] = useState("");
  const teacher = me.data?.role === "teacher";
  const chatList = chats.data ?? [];
  const roomList = classrooms.data ?? [];
  const last = chatList[0];
  const running = roomList.filter((room) => room.current && !room.current.finished);
  const students = roomList.reduce((n, room) => n + room.memberCount, 0);

  function ask(title: string) {
    if (!title.trim() || start.isPending) return;
    start.mutate(title);
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-4xl" eyebrow={t("home_eyebrow")} title={t("nav_home")} />
      <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6">
        {isDefaultGuestName(me.data?.name) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-5 py-3 text-[13px] text-ink-soft">
            <span>{t("home_guest_name", { name: me.data?.name ?? "" })}</span>
            <button
              type="button"
              onClick={openAccountSheet}
              className="cursor-pointer rounded-full bg-ember px-3.5 py-1.5 text-xs font-semibold text-on-ember"
            >
              {t("account_change_name")}
            </button>
          </div>
        )}
        <Card className="grid gap-8 bg-gradient-to-br from-ember-wash to-transparent p-8 md:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            <p className="text-xs text-ember">
              {t("home_greeting", { greeting: t(greetingKey()), name: me.data?.name ?? "" })}
            </p>
            <h2 className="mt-1 font-serif text-3xl">{t("home_question")}</h2>
            <form
              className="mt-4 flex gap-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                ask(q);
              }}
            >
              <Input
                value={q}
                maxLength={120}
                placeholder={t("home_placeholder")}
                aria-label={t("home_question")}
                onChange={(event) => setQ(event.target.value)}
              />
              <Button type="submit" disabled={!q.trim() || start.isPending}>
                {t("home_start")}
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={start.isPending}
                  onClick={() => ask(t(key))}
                  className="cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ink-soft hover:border-ember hover:text-ink"
                >
                  {t(key)}
                </button>
              ))}
            </div>
            {start.isError && <p className="mt-2 text-[12.5px] text-flag">{t("common_error")}</p>}
          </div>
          <blockquote className="flex flex-col justify-center gap-3 border-line pl-8 max-md:hidden md:border-l">
            <p className="font-serif text-lg leading-relaxed">“{t("home_quote")}”</p>
            <cite className="text-xs not-italic text-ink-faint">— {t("dlg_socrates")}</cite>
          </blockquote>
        </Card>

        {last && (
          <Link to="/chat/$chatId" params={{ chatId: last.id }} className="block">
            <Card className="flex items-center gap-4 p-5 transition-colors hover:border-ember-deep">
              <span className="flex size-11 items-center justify-center rounded-full bg-ember-wash text-ember">
                <MessageSquare className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <small className="block text-xs text-ink-faint">{t("home_resume")}</small>
                <b className="block truncate font-serif text-base font-medium">{last.title}</b>
                <em className="text-xs not-italic text-ink-faint">{t("live_rounds", { n: last.rounds })}</em>
              </span>
              <span className="text-sm text-ember">{t("home_continue")}</span>
            </Card>
          </Link>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <Link to="/chat">
            <Card className="h-full p-5 transition-colors hover:border-ember-deep">
              <b className="block font-serif text-4xl font-medium text-ember">{chatList.length}</b>
              <span className="mt-1 block text-sm">{t("home_stat_chats")}</span>
              <span className="text-xs text-ink-faint">{t("nav_chat")}</span>
            </Card>
          </Link>
          <Link to="/classrooms">
            <Card className="h-full p-5 transition-colors hover:border-ember-deep">
              <b className="block font-serif text-4xl font-medium text-ember">{roomList.length}</b>
              <span className="mt-1 block text-sm">{t("home_stat_classrooms")}</span>
              <span className="text-xs text-ink-faint">
                {teacher ? t("home_stat_students", { n: students }) : t("home_stat_running", { n: running.length })}
              </span>
            </Card>
          </Link>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-[15.5px]">{t("home_recent_chats")}</h3>
              <Link to="/chat" className="text-xs text-ember">
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
                <span className="min-w-0">
                  <span className="block truncate text-sm">{chat.title}</span>
                  <span className="text-xs text-ink-faint">
                    {new Date(chat.updatedAt).toLocaleDateString()} · {t("live_rounds", { n: chat.rounds })}
                  </span>
                </span>
                <span className="text-ink-faint">›</span>
              </Link>
            ))}
            {!chatList.length && <p className="text-sm text-ink-faint">{t("home_no_chats")}</p>}
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-[15.5px]">{t("home_classroom_feed")}</h3>
              <Link to="/classrooms" className="text-xs text-ember">
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
                {teacher ? t("classrooms_empty_teacher") : t("classrooms_empty_student")}
              </p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
