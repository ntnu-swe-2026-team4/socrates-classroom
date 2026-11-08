import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Checkbox, Field, Input, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/join/$code")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code } = Route.useParams();
  const { draft } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const info = useQuery({ queryKey: ["join", code], queryFn: () => api.joinByCode(code) });

  useEffect(() => {
    fetch("/socrates.glb", { priority: "low" }).catch(() => {});
  }, []);

  if (info.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (info.isError || !info.data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[15px] text-ink-soft">{t("join_invalid")}</p>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>
          {t("common_back")}
        </Button>
      </div>
    );
  }

  const topic = info.data.topic;
  const ready = name.trim().length > 0 && tos && !submitting;

  async function start() {
    setSubmitting(true);
    setFailed(false);
    try {
      const { activityId, user } = await api.joinAsGuest(code, name.trim());
      queryClient.setQueryData(["me"], user);
      await navigate({
        to: "/dialogue",
        search: { activityId, topic: topic.id, ...(draft ? { q: draft } : {}) },
      });
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-14">
      <p className="text-[13px] font-medium tracking-widest text-ink-faint">{t("join_title")}</p>
      <h1 className="mt-3 font-serif text-3xl font-semibold text-ink">{topic.title}</h1>
      <p className="mt-4 rounded-2xl border border-line bg-card p-4 text-[14.5px] leading-[1.85] text-ink-soft">
        {topic.summary}
      </p>
      <div className="mt-8 flex flex-col gap-5">
        {failed && <p className="text-[13px] text-ember">{t("join_failed")}</p>}
        <Field label={t("join_name_label")}>
          <Input
            value={name}
            placeholder={t("join_name_placeholder")}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
        <Button size="lg" disabled={!ready} onClick={start} className="mt-2 w-full">
          {submitting ? <Spinner /> : t("join_start")}
        </Button>
      </div>
    </div>
  );
}
