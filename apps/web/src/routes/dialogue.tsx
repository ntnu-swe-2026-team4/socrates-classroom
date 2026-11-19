import { useCallback } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { readActivityId } from "@/api/local";
import { DialogueView } from "@/components/DialogueView";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dialogue")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { activityId?: string; slot?: string; q?: string; term?: string } => ({
    activityId: typeof search.activityId === "string" ? search.activityId : undefined,
    slot: typeof search.slot === "string" ? search.slot : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  beforeLoad: async ({ search, context }) => {
    const me = await context.queryClient.fetchQuery({
      queryKey: ["me"],
      queryFn: () => api.me(),
      staleTime: Infinity,
    });
    const activityId = search.activityId ?? readActivityId();
    if (!activityId) throw redirect({ to: me ? "/home" : "/join" });
  },
  component: DialoguePage,
});

function DialoguePage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const { activityId: activityParam, slot, q, term } = Route.useSearch();
  const activityId = activityParam ?? readActivityId() ?? "";
  const activityQuery = useQuery({
    queryKey: ["activity", activityId, slot ?? null],
    queryFn: () => api.activityInfo(activityId, slot),
    enabled: activityId !== "",
    staleTime: Infinity,
  });
  const activityRefetch = useCallback(() => void activityQuery.refetch(), [activityQuery.refetch]);
  const topic = activityQuery.data?.topic;

  if (me.isPending) return <div className="h-dvh" aria-busy="true" />;
  if (activityQuery.isPending) return <div className="h-dvh" aria-busy="true" />;
  const participantId = activityQuery.data?.participantId ?? "";

  return (
    <DialogueView
      key={`${activityId}:${participantId}`}
      threadId={activityId}
      userId={participantId}
      title={topic?.title ?? t("dlg_title")}
      subtitle={topic?.title ? t("dlg_topic_eyebrow") : t("dlg_title")}
      statement={topic?.statement}
      prompts={topic?.prompts}
      closedNotice={
        activityQuery.isError ? t("common_error") : activityQuery.data?.finishedAt ? t("dlg_err_finished") : undefined
      }
      autoSend={q}
      onActivityFinished={activityRefetch}
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
