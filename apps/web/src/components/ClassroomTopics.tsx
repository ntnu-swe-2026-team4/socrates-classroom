import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityMode, ActivityStarted, ClassroomSummary, Topic, TopicDraft } from "@socrates/shared";
import { api } from "@/api";
import {
  AxesEditor,
  axesOf,
  axesValid,
  draftOf,
  draftsOf,
  useReportAxes,
  useTopicWithAxes,
  type AxisDraft,
} from "@/components/AxesEditor";
import { Button, Card, Checkbox, Field, Input, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function useClassroomTopics(classroomId: string | null) {
  return useQuery({
    queryKey: ["classroomTopics", classroomId],
    queryFn: () => api.listClassroomTopics(classroomId as string),
    enabled: classroomId !== null,
  });
}

function invalidateTopics(queryClient: ReturnType<typeof useQueryClient>, classroomId: string) {
  return queryClient.invalidateQueries({ queryKey: ["classroomTopics", classroomId] });
}

export function TopicPicker({
  topics,
  picked,
  onPick,
  disabled,
}: {
  topics: Topic[];
  picked: string | null;
  onPick: (topicId: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const teacherAxes = useReportAxes() === "teacher";
  return (
    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-0.5">
      {topics.map((topic) => (
        <button
          type="button"
          key={topic.id}
          disabled={disabled}
          aria-pressed={picked === topic.id}
          onClick={() => onPick(topic.id)}
          className={cn(
            "flex w-full cursor-pointer flex-col items-start rounded-xl border p-3 text-left transition-colors disabled:cursor-default disabled:opacity-60",
            picked === topic.id ? "border-ember-deep bg-ember-wash" : "border-transparent hover:bg-paper-deep",
          )}
        >
          <b className="font-serif text-[15px] font-medium text-ink">{topic.title}</b>
          <span className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{topic.statement}</span>
          {teacherAxes &&
            topic.axes.map((axis) => (
              <span key={axis.name} className="mt-0.5 text-[12px] text-ink-faint">
                {axis.name}：{axis.left} ↔ {axis.right}
              </span>
            ))}
          {teacherAxes && topic.axes.length === 0 && (
            <span className="mt-0.5 text-[12px] text-flag">{t("topic_no_axes")}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function SystemTopicList({
  topics,
  picked,
  onPick,
}: {
  topics: Topic[];
  picked: string | null;
  onPick: (topicId: string) => void;
}) {
  const t = useT();
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-xs text-ink-soft">{t("setup_topic_system")}</p>
      <TopicPicker topics={topics} picked={picked} onPick={onPick} />
    </div>
  );
}

export function AddTopic({ classroomId }: { classroomId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"custom" | "ai">("custom");
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [direction, setDirection] = useState("");
  const [candidate, setCandidate] = useState<TopicDraft | null>(null);
  const [axes, setAxes] = useState<AxisDraft[]>(() => [draftOf()]);
  const reportAxes = useReportAxes();
  const teacherAxes = reportAxes === "teacher";
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const create = useMutation({
    mutationFn: (input: { title: string; statement: string; prompts: string[] }) =>
      api.createClassroomTopic(classroomId, { ...input, axes: teacherAxes ? axesOf(axes) : [] }),
    onSuccess: async () => {
      setTitle("");
      setStatement("");
      setCandidate(null);
      setAxes([draftOf()]);
      await invalidateTopics(queryClient, classroomId);
    },
  });
  const ready = reportAxes !== undefined && (!teacherAxes || axesValid(axes)) && !create.isPending;

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t("classroom_add_topic")}
        value={source}
        onChange={(value) => setSource(value)}
        items={[
          { value: "custom", label: t("setup_topic_custom") },
          { value: "ai", label: t("setup_topic_ai") },
        ]}
      />

      {source === "custom" ? (
        <div className="flex flex-col gap-3">
          <Field label={t("setup_topic_title")}>
            <Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={t("setup_topic_statement")}>
            <Input value={statement} maxLength={2000} onChange={(event) => setStatement(event.target.value)} />
          </Field>
          {teacherAxes && <AxesEditor axes={axes} onChange={setAxes} disabled={create.isPending} />}
          <Button
            className="self-start"
            disabled={!title.trim() || !statement.trim() || !ready}
            onClick={() => create.mutate({ title: title.trim(), statement: statement.trim(), prompts: [] })}
          >
            {create.isPending ? <Spinner /> : t("setup_topic_add")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={direction}
              placeholder={t("setup_topic_direction")}
              onChange={(event) => setDirection(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!direction.trim() || generated.isPending}
              onClick={() => {
                setCandidate(null);
                generated.mutate();
              }}
            >
              {generated.isPending ? <Spinner /> : t("setup_topic_generate")}
            </Button>
          </div>
          {generated.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
          <TopicPicker
            topics={(generated.data ?? []).map((draft) => ({ ...draft, classroomId: null }))}
            picked={candidate?.id ?? null}
            onPick={(id) => {
              if (candidate?.id === id) return; // keep the teacher's edits
              setCandidate(generated.data?.find((draft) => draft.id === id) ?? null);
              setAxes([draftOf()]);
            }}
          />
          {candidate && (
            <>
              {teacherAxes && <AxesEditor axes={axes} onChange={setAxes} disabled={create.isPending} />}
              <Button
                className="self-start"
                disabled={!ready}
                onClick={() =>
                  create.mutate({
                    title: candidate.title,
                    statement: candidate.statement,
                    prompts: candidate.prompts,
                  })
                }
              >
                {create.isPending ? <Spinner /> : t("setup_topic_add")}
              </Button>
            </>
          )}
        </div>
      )}
      {create.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
    </div>
  );
}

export function CopyTopic({ classroomId }: { classroomId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [sourceClassroom, setSourceClassroom] = useState("");
  const system = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const rooms = useQuery({ queryKey: ["classrooms"], queryFn: () => api.listClassrooms() });
  const others = (rooms.data ?? []).filter((room) => room.role === "teacher" && room.id !== classroomId);
  const otherTopics = useQuery({
    queryKey: ["classroomTopics", sourceClassroom],
    queryFn: () => api.listClassroomTopics(sourceClassroom),
    enabled: sourceClassroom !== "",
  });
  const copy = useMutation({
    mutationFn: (topicId: string) => api.copyTopic(topicId, classroomId),
    onSuccess: async () => {
      await invalidateTopics(queryClient, classroomId);
    },
  });

  return (
    <details className="group mt-4 rounded-2xl border border-line px-4 py-3">
      <summary className="cursor-pointer text-[13px] text-ember marker:content-none">
        {t("classroom_copy_from")}
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {(system.data ?? []).length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-xs text-ink-soft">{t("setup_topic_system")}</p>
            <div className="flex flex-col gap-1">
              {(system.data ?? []).map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 rounded-xl bg-paper-deep px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-serif text-[14px] text-ink">{topic.title}</span>
                  <Button size="sm" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate(topic.id)}>
                    {t("setup_topic_add")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs text-ink-soft">{t("classroom_copy_other_class")}</p>
          {others.length === 0 ? (
            <p className="px-1 text-[13px] text-ink-faint">{t("classroom_no_other_class")}</p>
          ) : (
            <>
              <select
                aria-label={t("classroom_pick_class")}
                value={sourceClassroom}
                onChange={(event) => setSourceClassroom(event.target.value)}
                className="h-10 w-full rounded-full border border-line-strong bg-paper-deep px-4 text-sm text-ink outline-none focus:border-ember"
              >
                <option value="">{t("classroom_pick_class")}</option>
                {others.map((room: ClassroomSummary) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              {otherTopics.data?.map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 rounded-xl bg-paper-deep px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-serif text-[14px] text-ink">{topic.title}</span>
                  <Button size="sm" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate(topic.id)}>
                    {t("setup_topic_add")}
                  </Button>
                </div>
              ))}
            </>
          )}
        </div>
        {copy.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
      </div>
    </details>
  );
}

export function StartActivity({
  classroomId,
  onStarted,
  allowTest,
}: {
  classroomId: string;
  onStarted: (started: ActivityStarted) => void;
  allowTest: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const classroomTopics = useClassroomTopics(classroomId);
  const systemTopics = useQuery({ queryKey: ["topics"], queryFn: () => api.listTopics(), staleTime: Infinity });
  const [picked, setPicked] = useState<string | null>(null);
  const [axes, setAxes] = useState<AxisDraft[]>(() => [draftOf()]);
  const [testMode, setTestMode] = useState(false);
  const topicWithAxes = useTopicWithAxes(classroomId);
  const reportAxes = useReportAxes();
  const teacherAxes = reportAxes === "teacher";
  const own = classroomTopics.data ?? [];
  const shared = (systemTopics.data ?? []).filter((topic) => topic.classroomId === null);
  const pickedTopic = [...own, ...shared].find((topic) => topic.id === picked) ?? null;
  const start = useMutation({
    mutationFn: async ({ topic, mode }: { topic: Topic; mode: ActivityMode }) =>
      // axes set by the model: the topic starts as it is
      api.startActivity(classroomId, teacherAxes ? await topicWithAxes(topic, axesOf(axes)) : topic.id, mode),
    onSuccess: async (started) => {
      setPicked(null);
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      await invalidateTopics(queryClient, classroomId);
      onStarted(started);
    },
  });
  const pick = (topicId: string) => {
    if (topicId === picked) return; // keep the teacher's edits
    setPicked(topicId);
    setAxes(draftsOf([...own, ...shared].find((topic) => topic.id === topicId)?.axes ?? []));
  };

  if (classroomTopics.isPending || systemTopics.isPending) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-[13px] leading-relaxed text-ink-soft">{t("setup_activity_hint")}</p>
      {own.length === 0 ? (
        <p className="text-[13px] text-ink-faint">{t("setup_topics_empty")}</p>
      ) : (
        <TopicPicker topics={own} picked={picked} onPick={pick} />
      )}
      <SystemTopicList topics={shared.slice(0, 6)} picked={picked} onPick={pick} />
      {pickedTopic && teacherAxes && <AxesEditor axes={axes} onChange={setAxes} disabled={start.isPending} />}
      {allowTest && (
        <div>
          <Checkbox label={t("classroom_mode_test")} checked={testMode} onCheckedChange={setTestMode} />
          {testMode && (
            <p className="mt-1.5 pl-8 text-[12px] leading-relaxed text-ink-faint">{t("classroom_mode_test_hint")}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {start.isError ? <p className="text-[12.5px] text-flag">{t("common_error")}</p> : <span />}
        <Button
          disabled={!pickedTopic || reportAxes === undefined || (teacherAxes && !axesValid(axes)) || start.isPending}
          onClick={() => pickedTopic && start.mutate({ topic: pickedTopic, mode: testMode ? "test" : "live" })}
        >
          {start.isPending ? <Spinner /> : testMode ? t("classroom_start_test") : t("setup_activity_start")}
        </Button>
      </div>
    </Card>
  );
}
