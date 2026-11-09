import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Checkbox, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { ApiError } from "@/api";
import { useT } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";

export const Route = createFileRoute("/join/$code")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code: rawCode } = Route.useParams();
  const code = normalizeJoinCode(rawCode);
  const { draft } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["join", code], queryFn: () => api.joinByCode(code) });

  useEffect(() => {
    fetch("/socrates.glb").catch(() => {});
  }, []);

  const topic = info.data?.topic;
  const ready = name.trim().length > 0 && tos && !submitting;

  async function start() {
    if (!topic) return;
    setSubmitting(true);
    setFailed(null);
    try {
      const { activityId, user } = await api.joinAsGuest(code, name.trim());
      queryClient.setQueryData(["me"], user);
      await navigate({
        to: "/dialogue",
        search: { activityId, ...(draft ? { q: draft } : {}) },
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      setFailed(
        code === "name_taken"
          ? t("join_err_name_taken")
          : code === "activity_finished"
            ? t("join_err_finished")
            : t("join_failed"),
      );
    } finally {
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
              <p className="text-[15px] text-ink-soft">
                {info.error instanceof ApiError && info.error.code === "rate_limited"
                  ? t("join_failed")
                  : info.error instanceof ApiError && info.error.code === "only_student"
                    ? t("join_only_student")
                    : t("join_invalid")}
              </p>
              <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
                {t("common_back")}
              </Button>
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
              {failed && (
                <p role="alert" className="text-[13px] text-flag">
                  {failed}
                </p>
              )}
              <Field label={t("join_name_label")}>
                <Input
                  value={name}
                  placeholder={t("join_name_placeholder")}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
              <Button size="lg" disabled={!ready} onClick={() => void start()}>
                {submitting ? <Spinner /> : t("join_start")}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
