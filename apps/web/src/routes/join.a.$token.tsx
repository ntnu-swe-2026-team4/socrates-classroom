import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api";
import { Button, Card, Checkbox, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/join/a/$token")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { draft } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.inviteInfo(token), retry: false });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });

  const topic = info.data?.topic;
  const needsName = me.isSuccess && me.data === null;
  const ready = tos && !submitting && (!needsName || name.trim().length > 0);

  async function start() {
    setSubmitting(true);
    setFailed(null);
    try {
      const joined = await api.joinByInvite(token, name.trim());
      await navigate({
        to: "/dialogue",
        search: { activityId: joined.activityId, ...(draft ? { q: draft } : {}) },
      });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      setFailed(
        code === "name_taken"
          ? t("join_err_name_taken")
          : code === "activity_finished"
            ? t("join_err_finished")
            : code === "invite_invalid" || code === "invite_expired" || code === "invite_revoked"
              ? t("invite_invalid")
              : t("join_failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        width="max-w-xl"
        eyebrow={t("invite_eyebrow")}
        title={info.data?.classroomName ?? t("invite_eyebrow")}
      />
      <div className="mx-auto w-full max-w-xl px-6 py-8">
        <Card className="p-7">
          {info.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : info.isError || !topic ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-[15px] text-ink-soft">{t("invite_invalid")}</p>
              <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
                {t("common_back")}
              </Button>
            </div>
          ) : info.data.finishedAt ? (
            <div className="flex flex-col items-start gap-4">
              <h2 className="font-serif text-2xl leading-snug">{t("invite_finished_title")}</h2>
              <p className="text-[15px] leading-relaxed text-ink-soft">{t("invite_finished_hint")}</p>
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
              {needsName && (
                <Field label={t("join_name_label")}>
                  <Input
                    value={name}
                    placeholder={t("join_name_placeholder")}
                    maxLength={24}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              )}
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
