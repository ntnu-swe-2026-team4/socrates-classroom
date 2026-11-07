import { useCallback } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { readActivityId } from "@/api/local";
import { DialogueView } from "@/components/DialogueView";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dialogue")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { activityId?: string; topic?: string; q?: string; term?: string } => ({
    activityId: typeof search.activityId === "string" ? search.activityId : undefined,
    topic: typeof search.topic === "string" ? search.topic : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.activityId && !readActivityId()) throw redirect({ to: "/classrooms" });
  },
  component: ClassroomDialoguePage,
});

function ClassroomDialoguePage() {
  const t = useT();
  const navigate = useNavigate();
  const { activityId: activityParam, q, term } = Route.useSearch();
  const activityId = activityParam ?? readActivityId() ?? "";
  const activity = useQuery({
    queryKey: ["activity", activityId],
    queryFn: () => api.activityInfo(activityId),
    enabled: Boolean(activityId),
    staleTime: 10_000,
  });
  const history = useQuery({ queryKey: ["history", activityId], queryFn: () => api.dialogueHistory(activityId) });
  const topic = activity.data?.topic;
  const finished = Boolean(activity.data?.finishedAt);

  const clearQuery = useCallback(
    () => void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, q: undefined }), replace: true }),
    [navigate],
  );
  const clearTerm = useCallback(
    () => void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, term: undefined }), replace: true }),
    [navigate],
  );

  return (
    <DialogueView
      key={activityId}
      targetId={activityId}
      eyebrow={activity.data?.classroomName ?? t("dlg_eyebrow")}
      title={topic?.title ?? t("dlg_title")}
      statement={topic?.statement}
      prompts={topic?.prompts}
      history={history.data}
      historyPending={history.isPending}
      autoSend={finished ? undefined : q}
      onAutoSent={clearQuery}
      openTerm={term}
      onTermOpened={clearTerm}
      headerActions={
        activity.data && (
          <Link
            to="/classrooms/$classroomId"
            params={{ classroomId: activity.data.classroomId }}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            {t("classroom_back")}
          </Link>
        )
      }
      closedNotice={
        finished && (
          <span>
            {t("dlg_closed")}{" "}
            <Link to="/report/$id" params={{ id: activityId }} className="font-medium text-ember hover:underline">
              {t("classroom_view_report")}
            </Link>
          </span>
        )
      }
    />
  );
}
