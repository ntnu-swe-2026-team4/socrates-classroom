import { useId, useState } from "react";
import { classroomTopicsOptions, classroomsOptions, clientConfigOptions, topicsOptions } from "@/api/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityMode, ActivityStarted, ClassroomSummary, ReportAxes, Topic } from "@socrates/shared";
import { ApiError, api } from "@/api";
import { AxesEditor, axesOf, axesValid, draftsOf, type AxisDraft } from "./AxesEditor";
import { Button, Card, Checkbox, Field, Input, Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function useClassroomTopics(classroomId: string | null) {
  return useQuery(classroomTopicsOptions(classroomId));
}

function invalidateTopics(queryClient: ReturnType<typeof useQueryClient>, classroomId: string) {
  return queryClient.invalidateQueries({ queryKey: classroomTopicsOptions(classroomId).queryKey });
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
          <span
            className={cn("mt-0.5 text-[13px] leading-relaxed", picked === topic.id ? "text-ink" : "text-ink-soft")}
          >
            {topic.statement}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SystemTopicList({
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
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-xs text-ink-soft">{t("setup_topic_system")}</p>
      <TopicPicker topics={topics} picked={picked} onPick={onPick} disabled={disabled} />
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
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [customAxes, setCustomAxes] = useState<AxisDraft[]>([]);
  const [generatedAxes, setGeneratedAxes] = useState<AxisDraft[]>([]);
  const config = useQuery(clientConfigOptions);
  const policy = config.data?.reportAxes;
  const axes = source === "custom" ? customAxes : generatedAxes;
  const setAxes = source === "custom" ? setCustomAxes : setGeneratedAxes;
  const generated = useMutation({ mutationFn: () => api.generateTopics(direction) });
  const candidate = generated.data?.find(({ id }) => id === candidateId);
  const create = useMutation({
    mutationFn: (input: { title: string; statement: string; prompts: string[] }) =>
      api.createClassroomTopic(classroomId, { ...input, axes: policy === "ai" ? [] : axesOf(axes) }),
    onSuccess: async () => {
      if (source === "custom") {
        setTitle("");
        setStatement("");
        setCustomAxes([]);
      } else {
        setCandidateId(null);
        setGeneratedAxes([]);
      }
      await invalidateTopics(queryClient, classroomId);
    },
  });
  const canSave = policy !== undefined && (policy === "ai" || axesValid(axes, policy === "both")) && !create.isPending;
  const editor = (policy === "teacher" || policy === "both") && (
    <AxesEditor axes={axes} onChange={setAxes} disabled={create.isPending} optional={policy === "both"} />
  );

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t("classroom_add_topic")}
        value={source}
        onChange={(value) => {
          if (!create.isPending) setSource(value);
        }}
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
          {editor}
          <Button
            className="self-start"
            disabled={!title.trim() || !statement.trim() || !canSave}
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
              disabled={!direction.trim() || generated.isPending || create.isPending}
              onClick={() => {
                setCandidateId(null);
                setGeneratedAxes([]);
                generated.mutate();
              }}
            >
              {generated.isPending ? <Spinner /> : t("setup_topic_generate")}
            </Button>
          </div>
          {generated.isError && <p className="text-[13px] text-flag">{t("common_error")}</p>}
          {generated.data && (
            <TopicPicker
              topics={generated.data.map((draft) => ({ ...draft, classroomId: null }))}
              picked={candidateId}
              disabled={create.isPending || generated.isPending}
              onPick={(id) => {
                if (id === candidateId) return;
                setCandidateId(id);
                setGeneratedAxes([]);
              }}
            />
          )}
          {candidate && (
            <>
              {editor}
              <Button
                className="self-start"
                disabled={!canSave}
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
      {config.isError && !policy && (
        <Button variant="outline" className="self-start" onClick={() => void config.refetch()}>
          {t("room_retry")}
        </Button>
      )}
    </div>
  );
}

export function CopyTopic({ classroomId }: { classroomId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [sourceClassroom, setSourceClassroom] = useState("");
  const system = useQuery(topicsOptions);
  const rooms = useQuery(classroomsOptions);
  const others = (rooms.data ?? []).filter((room) => room.role === "teacher" && room.id !== classroomId);
  const otherTopics = useQuery({ ...classroomTopicsOptions(sourceClassroom), enabled: sourceClassroom !== "" });
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

function isAxesPolicyError(error: unknown): boolean {
  return error != null && error instanceof ApiError && error.code === "report_axes_not_allowed";
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
  const systemTopics = useQuery(topicsOptions);
  const config = useQuery(clientConfigOptions);
  const [picked, setPicked] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [axes, setAxes] = useState<AxisDraft[]>([]);
  const [chosen, setChosen] = useState<ReportAxes>("teacher");
  const reportAxesName = useId();
  const policy = config.data?.reportAxes;
  const reportAxes = policy === "both" ? chosen : policy;
  const teacherAxes = reportAxes === "teacher";
  const own = classroomTopics.data ?? [];
  const shared = (systemTopics.data ?? []).filter((topic) => topic.classroomId === null);
  const topics = [...own, ...shared];
  const pickedTopic = topics.find(({ id }) => id === picked);
  const start = useMutation({
    mutationFn: (input: { topic: Topic; mode: ActivityMode; reportAxes: ReportAxes; axes: AxisDraft[] }) => {
      const edited = axesOf(input.axes);
      const topicAxes =
        input.reportAxes === "teacher" && JSON.stringify(edited) !== JSON.stringify(input.topic.axes)
          ? edited
          : undefined;
      return api.startActivity(classroomId, input.topic.id, input.mode, input.reportAxes, topicAxes);
    },
    onSuccess: async (started) => {
      setPicked(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: classroomsOptions.queryKey }),
        invalidateTopics(queryClient, classroomId),
      ]);
      onStarted(started);
    },
    onError: async (error) => {
      if (isAxesPolicyError(error)) await config.refetch();
    },
  });
  const policyChanged = isAxesPolicyError(start.error);
  const needsPolicyRefresh = policyChanged && (config.isError || config.isFetching);
  const pick = (topicId: string) => {
    if (topicId === picked || start.isPending) return;
    setPicked(topicId);
    setAxes(draftsOf(topics.find(({ id }) => id === topicId)?.axes ?? []));
  };

  if (classroomTopics.isPending || systemTopics.isPending || config.isPending) {
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
        <TopicPicker topics={own} picked={picked} onPick={pick} disabled={start.isPending} />
      )}
      <SystemTopicList topics={shared.slice(0, 6)} picked={picked} onPick={pick} disabled={start.isPending} />
      {policy === "both" && (
        <fieldset disabled={start.isPending} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <legend className="mb-2 text-[13px] font-medium text-ink">{t("setup_axes_mode")}</legend>
          {(["teacher", "ai"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="radio"
                name={reportAxesName}
                checked={chosen === mode}
                onChange={() => setChosen(mode)}
                className="accent-ember"
              />
              {t(mode === "teacher" ? "setup_axes_mode_teacher" : "setup_axes_mode_ai")}
            </label>
          ))}
        </fieldset>
      )}
      {pickedTopic && teacherAxes && <AxesEditor axes={axes} onChange={setAxes} disabled={start.isPending} />}
      {config.isError && (!policy || policyChanged) && (
        <Button
          variant="outline"
          className="self-start"
          disabled={config.isFetching}
          onClick={() => void config.refetch()}
        >
          {t("room_retry")}
        </Button>
      )}
      {allowTest && (
        <div>
          <Checkbox label={t("classroom_mode_test")} checked={testMode} onCheckedChange={setTestMode} />
          {testMode && (
            <p className="mt-1.5 pl-8 text-[12px] leading-relaxed text-ink-faint">{t("classroom_mode_test_hint")}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {start.isError ? (
          <p role="alert" className="text-[12.5px] text-flag">
            {t(policyChanged ? "setup_axes_policy_changed" : "common_error")}
            {policyChanged && !needsPolicyRefresh && policy && policy !== "both" && (
              <span className="block text-ink-soft">
                {t("setup_axes_mode")} · {t(policy === "teacher" ? "setup_axes_mode_teacher" : "setup_axes_mode_ai")}
              </span>
            )}
          </p>
        ) : (
          <span />
        )}
        <Button
          disabled={
            !pickedTopic || !reportAxes || start.isPending || needsPolicyRefresh || (teacherAxes && !axesValid(axes))
          }
          onClick={() => {
            if (pickedTopic && reportAxes)
              start.mutate({ topic: pickedTopic, mode: testMode ? "test" : "live", reportAxes, axes });
          }}
        >
          {start.isPending ? <Spinner /> : testMode ? t("classroom_start_test") : t("setup_activity_start")}
        </Button>
      </div>
    </Card>
  );
}
