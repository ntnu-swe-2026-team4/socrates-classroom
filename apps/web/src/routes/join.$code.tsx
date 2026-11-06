import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Checkbox, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";
import { openAccountSheet } from "@/lib/accountSheet";

export const Route = createFileRoute("/join/$code")({
  component: JoinPage,
});

function JoinPage() {
  const { code: rawCode } = Route.useParams();
  const code = normalizeJoinCode(rawCode);
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const info = useQuery({ queryKey: ["join", code], queryFn: () => api.joinByCode(code) });
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const teacher = me.data?.role === "teacher";
  const topic = info.data?.topic;

  async function join() {
    if (!topic || !me.data || !tos || submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const { activityId } = await api.joinAsGuest(code, me.data.name);
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      await navigate({ to: "/dialogue", search: { activityId, topic: topic.id } });
    } catch {
      setFailed(true);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-xl" eyebrow={t("hero_chip_join")} title={info.data?.classroomName ?? t("join_title")} />
      <div className="mx-auto w-full max-w-xl px-6 py-8">
        <Card className="p-7">
          {info.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : info.isError || !topic ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-[15px] text-ink-soft">{t("join_invalid")}</p>
              <Link to="/classrooms" className="text-sm text-ember">
                {t("classroom_back")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs tracking-wider text-ink-faint">{t("join_title")}</p>
                <h2 className="mt-1 font-serif text-2xl leading-snug">{topic.title}</h2>
                <p className="mt-4 border-l-2 border-ember-deep pl-4 font-serif text-[15px] leading-8 text-ink-soft">
                  {topic.summary ?? topic.statement}
                </p>
              </div>
              {teacher ? (
                <p className="rounded-2xl bg-paper-deep px-4 py-3 text-[13px] text-ink-soft">{t("join_teacher")}</p>
              ) : (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                    {t("join_as", { name: me.data?.name ?? "" })}
                    <button
                      type="button"
                      onClick={openAccountSheet}
                      className="cursor-pointer text-ember hover:underline"
                    >
                      {t("account_change_name")}
                    </button>
                  </p>
                  <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
                  {failed && <p className="text-[13px] text-flag">{t("join_failed")}</p>}
                  <Button size="lg" disabled={!tos || submitting} onClick={() => void join()}>
                    {submitting ? <Spinner /> : t("join_confirm")}
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
