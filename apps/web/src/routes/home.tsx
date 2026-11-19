import { meOf } from "@/api/me";
import { useState, type ReactNode } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api, type SoloChat } from "@/api";
import { DotField } from "@/components/DotField";
import { cn } from "@/components/ui";
import { useFormatDate, useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/home")({
  beforeLoad: async ({ context }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login" });
    if (me?.preview && me.previewClassroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.previewClassroomId } });
    }
    if (me.guest || me.kind === "student") throw redirect({ to: "/classrooms" });
  },
  component: HomePage,
});

const BOX = "border-[1.5px] border-ht-line bg-ht-surface";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion";
const ROW =
  "flex items-center justify-between gap-3 border-t-2 border-dotted border-ht-dotted py-[13px] first-of-type:border-t-0";

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
    <div className="relative flex min-h-full flex-col overflow-hidden bg-ht-ground font-comic-sans text-ht-ink">
      <DotField />
      <div className="relative mx-auto flex w-full max-w-[980px] flex-col gap-6 px-4 pt-16 pb-16 md:px-12 md:pt-11">
        <header>
          <p className="font-dot text-[13px] tracking-[0.18em] text-ht-soft">· · · {t("home_eyebrow")}</p>
          <h1 className="mt-1.5 font-comic-serif text-[32px] leading-[1.2] font-black md:text-[40px]">
            {t("nav_home")}
          </h1>
        </header>

        <section className="relative mr-2 sm:mr-3">
          <div
            aria-hidden
            className="absolute inset-[8px_-8px_-8px_8px] bg-[radial-gradient(var(--color-ht-halo)_1.6px,transparent_2px)] bg-size-[6px_6px] sm:inset-[12px_-12px_-12px_12px]"
          />
          <div className={cn(BOX, "relative grid gap-8 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_260px]")}>
            <div className="min-w-0">
              <p className="font-dot text-[13px] tracking-[0.12em] text-ht-greeting">
                {t("home_greeting", { greeting: t(greetingKey()), name: me.data?.name ?? "" })}
              </p>
              <h2 className="mt-2 font-comic-serif text-[26px] leading-[1.3] font-black sm:text-[34px]">
                {t("home_question")}
              </h2>
              <form
                className="mt-[22px] flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  ask(q);
                }}
              >
                <input
                  value={q}
                  maxLength={120}
                  placeholder={t("home_placeholder")}
                  aria-label={t("home_question")}
                  onChange={(event) => setQ(event.target.value)}
                  className={cn(
                    BOX,
                    "h-[46px] min-w-0 flex-1 rounded-none border-ht-field-line bg-ht-field px-3.5 text-[14px] text-ht-ink placeholder:text-ht-placeholder",
                    FOCUS,
                  )}
                />
                <button
                  type="submit"
                  disabled={!q.trim() || start.isPending}
                  className={cn(
                    BOX,
                    "inline-flex h-[46px] shrink-0 cursor-pointer items-center justify-between gap-[18px] border-ht-accent-line bg-ht-accent px-[18px] text-ht-on-accent text-[14.5px] font-bold whitespace-nowrap comic-sink disabled:cursor-not-allowed disabled:opacity-55",
                    FOCUS,
                  )}
                >
                  {t("home_start")}
                  <span aria-hidden className="font-dot">
                    →
                  </span>
                </button>
              </form>
              <div className="mt-3.5 flex flex-wrap gap-2">
                {SUGGESTIONS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={start.isPending}
                    onClick={() => ask(t(key))}
                    className={cn(
                      BOX,
                      "comic-sink inline-flex cursor-pointer items-center gap-2 border-ht-chip-line bg-ht-chip-bg px-3 py-[7px] text-[13px] disabled:opacity-50",
                      FOCUS,
                    )}
                  >
                    <i aria-hidden className="size-1.5 rounded-full bg-ht-chip-dot" />
                    {t(key)}
                  </button>
                ))}
              </div>
              {start.isError && <p className="mt-2 text-[12.5px] text-vermilion">{t("common_error")}</p>}
            </div>
            <blockquote className="flex flex-col justify-center gap-3.5 border-l-2 border-dotted border-ht-dotted pl-7 max-md:hidden">
              <p className="font-comic-serif text-[20px] leading-[1.7] font-bold">「{t("home_quote")}」</p>
              <cite className="font-dot text-[12.5px] tracking-[0.12em] text-ht-soft not-italic">
                — {t("dlg_socrates")}
              </cite>
            </blockquote>
          </div>
        </section>

        {last && (
          <Link
            to="/chat/$chatId"
            params={{ chatId: last.id }}
            className={cn(BOX, "comic-sink flex items-center gap-4 px-[18px] py-4", FOCUS)}
          >
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center bg-ht-solid text-ht-on-solid"
            >
              <MessageSquare className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <small className="block font-dot text-[12px] tracking-[0.1em] text-ht-soft">{t("home_resume")}</small>
              <b className="mt-0.5 block truncate text-[16px] font-bold">{last.title}</b>
            </span>
            <span
              className={cn(
                BOX,
                "shrink-0 border-ht-accent-line bg-ht-accent px-3.5 py-1.5 text-ht-on-accent text-[13.5px] font-bold max-sm:hidden",
              )}
            >
              {t("home_continue")}
            </span>
          </Link>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <StatLink to="/chat" label={t("home_stat_chats")} hint={t("nav_chat")} value={chatList.length} />
          <StatLink
            to="/classrooms"
            label={t("home_stat_classrooms")}
            hint={t("home_stat_running", { n: running.length })}
            value={roomList.length}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <ListBox title={t("home_recent_chats")} to="/chat" allLabel={t("home_all")}>
            {chatList.slice(0, 5).map((chat) => (
              <Link key={chat.id} to="/chat/$chatId" params={{ chatId: chat.id }} className={cn(ROW, FOCUS)}>
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{chat.title}</span>
                  <span className="font-dot text-[12px] text-ht-soft">{formatDate(chat.updatedAt)}</span>
                </span>
                <span aria-hidden>›</span>
              </Link>
            ))}
            {chats.isSuccess && !chatList.length && <p className="py-3 text-[13px] text-ht-soft">{t("chat_empty")}</p>}
          </ListBox>

          <ListBox title={t("home_classroom_feed")} to="/classrooms" allLabel={t("home_all")}>
            {roomList.slice(0, 5).map((room) => (
              <Link
                key={room.id}
                to="/classrooms/$classroomId"
                params={{ classroomId: room.id }}
                className={cn(ROW, FOCUS)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{room.name}</span>
                  <span className="block truncate text-[12.5px] text-ht-soft">
                    {room.current ? room.current.topicTitle : t("classroom_no_topic")}
                  </span>
                </span>
                {room.current &&
                  (room.current.finished ? (
                    <span className="shrink-0 border-[1.5px] border-ht-live-line bg-ht-badge-bg px-2 py-px font-dot text-[12px] text-ht-soft">
                      {t("classroom_finished")}
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 border-[1.5px] border-ht-live-line bg-ht-live px-[7.5px] py-[1.5px] font-dot text-[12px] text-ht-on-live">
                      <i aria-hidden className="size-1.5 rounded-full bg-ht-accent" />
                      {t("classroom_running")}
                    </span>
                  ))}
              </Link>
            ))}
            {classrooms.isSuccess && !roomList.length && (
              <p className="py-3 text-[13px] text-ht-soft">{t("classrooms_empty")}</p>
            )}
          </ListBox>
        </section>
      </div>
    </div>
  );
}

function StatLink({
  to,
  label,
  hint,
  value,
}: {
  to: "/chat" | "/classrooms";
  label: string;
  hint: string;
  value: number;
}) {
  return (
    <Link to={to} className={cn(BOX, "comic-sink flex items-end justify-between gap-3 px-[22px] py-5", FOCUS)}>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold">{label}</span>
        <span className="block truncate text-[12.5px] text-ht-soft">{hint}</span>
      </span>
      <b className="font-dot text-[52px] leading-none font-normal">{value}</b>
    </Link>
  );
}

function ListBox({
  title,
  to,
  allLabel,
  children,
}: {
  title: string;
  to: "/chat" | "/classrooms";
  allLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(BOX, "px-[22px] pt-5 pb-2")}>
      <div className="flex items-baseline justify-between border-b-[1.5px] border-ht-line pb-2.5">
        <h3 className="font-comic-serif text-[18px] font-black">{title}</h3>
        <Link to={to} className={cn("text-[12.5px] underline", FOCUS)}>
          {allLabel}
        </Link>
      </div>
      {children}
    </div>
  );
}
