import { useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api, type SoloChat } from "@/api";
import { Button, Card, Input, Motif, PageHeader } from "@/components/ui";
import { useFormatDate, useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/home")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
    if (me?.preview && me.previewClassroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.previewClassroomId } });
    }
    if (me.guest || me.kind === "student") throw redirect({ to: "/classrooms" });
  },
  component: HomePage,
});

const SUGGESTIONS: MessageKey[] = ["chat_suggest_1", "chat_suggest_2", "chat_suggest_3"];

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
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const chats = useQuery({ queryKey: ["chats"], queryFn: () => api.listChats() });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const [q, setQ] = useState("");
  const start = useMutation({
    mutationFn: (question: string) => api.createChat(question),
    onSuccess: async (chat, question) => {
      queryClient.setQueryData<SoloChat[]>(["chats"], (list) => [chat, ...(list ?? [])]);
      await navigate({ to: "/chat/$chatId", params: { chatId: chat.id }, search: { q: question } });
    },
  });
  const chatList = chats.data ?? [];
  const roomList = classrooms.data ?? [];
  const last = chatList[0];
  const running = roomList.filter((room) => room.current && !room.current.finished);

  function ask(question: string) {
    if (!question.trim() || start.isPending) return;
    start.mutate(question.trim());
  }

  return (
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <PageHeader width="max-w-4xl" eyebrow={t("home_eyebrow")} title={t("nav_home")} />
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 md:px-6">
        <Card className="relative overflow-hidden p-6 md:p-7">
          <img
            src="/greek/hero.webp"
            alt=""
            decoding="async"
            className="pointer-events-none absolute right-0 bottom-0 h-[88%] max-md:hidden [[data-theme=dark]_&]:opacity-80"
          />
          <div className="relative min-w-0 md:max-w-[52%]">
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
                className="h-10"
              />
              <Button type="submit" className="h-10" disabled={!q.trim() || start.isPending}>
                {t("home_start")}
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={start.isPending}
                  onClick={() => ask(t(key))}
                  className="cursor-pointer rounded-lg border border-line-strong bg-paper px-4 py-1.5 text-[13px] text-ink-soft hover:border-ember hover:text-ink disabled:opacity-50"
                >
                  {t(key)}
                </button>
              ))}
            </div>
            {start.isError && <p className="mt-2 text-[12.5px] text-flag">{t("common_error")}</p>}
          </div>
        </Card>

        {last && (
          <Link to="/chat/$chatId" params={{ chatId: last.id }} className="block">
            <Card className="flex items-center gap-4 p-4 transition-colors hover:border-ember-deep">
              <span className="flex size-11 items-center justify-center rounded-full bg-ember-wash text-ink">
                <MessageSquare className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <small className="block text-xs text-ink-faint">{t("home_resume")}</small>
                <b className="block truncate font-serif text-base font-medium">{last.title}</b>
              </span>
              <span className="text-sm text-ember">{t("home_continue")}</span>
            </Card>
          </Link>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <Link to="/chat">
            <Card className="flex h-full items-center justify-between gap-4 p-5 transition-colors hover:border-ember-deep">
              <span>
                <b className="block font-serif text-4xl font-medium text-ink">{chatList.length}</b>
                <span className="mt-1 block text-sm">{t("home_stat_chats")}</span>
                <span className="text-xs text-ink-faint">{t("nav_chat")}</span>
              </span>
              <Motif name="lyre" className="h-16 text-ochre" />
            </Card>
          </Link>
          <Link to="/classrooms">
            <Card className="flex h-full items-center justify-between gap-4 p-5 transition-colors hover:border-ember-deep">
              <span>
                <b className="block font-serif text-4xl font-medium text-ink">{roomList.length}</b>
                <span className="mt-1 block text-sm">{t("home_stat_classrooms")}</span>
                <span className="text-xs text-ink-faint">{t("home_stat_running", { n: running.length })}</span>
              </span>
              <Motif name="temple" className="h-16 text-ochre" />
            </Card>
          </Link>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
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
                  <span className="text-xs text-ink-faint">{formatDate(chat.updatedAt)}</span>
                </span>
                <span className="text-ink-faint">›</span>
              </Link>
            ))}
            {chats.isSuccess && !chatList.length && <p className="text-sm text-ink-faint">{t("chat_empty")}</p>}
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
                        ? "shrink-0 rounded-lg bg-paper-deep px-2.5 py-0.5 text-[11.5px] text-ink-faint"
                        : "shrink-0 rounded-lg bg-moss-wash px-2.5 py-0.5 text-[11.5px] text-moss"
                    }
                  >
                    {room.current.finished ? t("classroom_finished") : t("classroom_running")}
                  </span>
                )}
              </Link>
            ))}
            {classrooms.isSuccess && !roomList.length && (
              <p className="text-sm text-ink-faint">{t("classrooms_empty")}</p>
            )}
          </Card>
        </section>

        <blockquote className="flex flex-col items-center gap-2 pt-6 pb-2 text-center">
          <Motif name="laurel" className="h-10 text-ochre" />
          <p className="max-w-md text-[15px] leading-relaxed text-ink-soft">“{t("home_quote")}”</p>
          <cite className="text-xs not-italic text-ink-faint">— {t("dlg_socrates")}</cite>
        </blockquote>
      </div>
    </div>
  );
}
