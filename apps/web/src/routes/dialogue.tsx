import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { readActivityId } from "@/api/local";
import { DialogueView } from "@/components/DialogueView";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dialogue")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { activityId?: string; q?: string; term?: string } => ({
    activityId: typeof search.activityId === "string" ? search.activityId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  beforeLoad: async ({ search, context }) => {
    const me = await context.queryClient.fetchQuery({
      queryKey: ["me"],
      queryFn: () => api.me(),
      staleTime: Infinity,
    });
    if (me?.role === "teacher") throw redirect({ to: "/t/setup" });
    if (!me) throw redirect({ to: "/join" });
    if (!(search.activityId || readActivityId())) throw redirect({ to: "/home" });
  },
  component: DialoguePage,
});

function DialoguePage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const { activityId: activityParam, q, term } = Route.useSearch();
  const activityId = activityParam ?? readActivityId() ?? "";
  const activityQuery = useQuery({
    queryKey: ["activity", activityId],
    queryFn: () => api.activityInfo(activityId),
    enabled: activityId !== "",
    staleTime: Infinity,
  });
  const topic = activityQuery.data?.topic;

  if (!me.data) return <div className="h-dvh" aria-busy="true" />;

  return (
    <DialogueView
      activityId={activityId}
      userId={me.data.id}
      eyebrow={topic?.title ? t("dlg_topic_eyebrow") : t("dlg_title")}
      title={topic?.title ?? t("dlg_title")}
      statement={topic?.statement}
      prompts={topic?.prompts}
      autoSend={q}
      onAutoSent={() =>
        void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, q: undefined }), replace: true })
      }
      openTerm={term}
      onTermOpened={() =>
        void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, term: undefined }), replace: true })
      }
    />
  );
}
