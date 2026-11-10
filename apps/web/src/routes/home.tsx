import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, PageHeader } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/home")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login" });
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

function HomePage() {
  const t = useT();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const classrooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const teacher = me.data?.role === "teacher";
  const roomList = classrooms.data ?? [];
  const running = roomList.filter((room) => room.current && !room.current.finished);
  const students = roomList.reduce((n, room) => n + room.memberCount, 0);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-4xl" eyebrow={t("home_eyebrow")} title={t("nav_home")} />
      <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6">
        <Card className="grid gap-8 bg-gradient-to-br from-ember-wash to-transparent p-8 md:grid-cols-[1fr_240px]">
          <div className="min-w-0">
            <p className="text-xs text-ember">
              {t("home_greeting", { greeting: t(greetingKey()), name: me.data?.name ?? "" })}
            </p>
            <h2 className="mt-1 font-serif text-3xl">{t("home_question")}</h2>
            <div className="mt-4">
              {teacher ? (
                <Link to="/t/setup">
                  <Button>{t("home_open_classroom")}</Button>
                </Link>
              ) : (
                <Link to="/classrooms">
                  <Button>{t("home_enter_classroom")}</Button>
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

        <section>
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
